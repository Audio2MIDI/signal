/**
 * @jest-environment jsdom
 */

import { webcrypto } from "crypto"
import { songToMidi } from "../midi/midiConversion"
import { uint8ArrayToBase64 } from "../helpers/base64"
import { emptySong } from "../song/SongFactory"
import { NoteEvent } from "../track"
import { SongStore } from "../stores/SongStore"
import { Audio2MidiEditorService } from "./Audio2MidiEditorService"

const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const VERSION_ID = "22222222-2222-4222-8222-222222222222"

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function midiResponse(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

function editableMidi() {
  const song = emptySong()
  song.tracks[1].addEvent<NoteEvent>({
    type: "channel",
    subtype: "note",
    tick: 0,
    duration: 480,
    noteNumber: 60,
    velocity: 96,
  })
  return songToMidi(song)
}

describe("Audio2MidiEditorService", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/editor/${PROJECT_ID}`)
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    })
  })

  it("flushes edits made during an active save before publishing", async () => {
    const midi = editableMidi()
    let finishFirstSave: (() => void) | undefined
    const firstSaveGate = new Promise<void>((resolve) => {
      finishFirstSave = resolve
    })
    let draftSaveCount = 0
    const fetchMock = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith(`/projects/${PROJECT_ID}/editor`) && !init?.method) {
          return jsonResponse(200, {
            project: { id: PROJECT_ID, title: "Test song" },
            version: { id: VERSION_ID },
            artifacts: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                role: "midi",
                mime_type: "audio/midi",
                stream_url: "/test.mid",
              },
            ],
            draft: null,
            reference_audio: [],
          })
        }
        if (url.endsWith("/test.mid")) {
          return midiResponse(midi)
        }
        if (url.endsWith("/editor/draft") && init?.method === "PUT") {
          draftSaveCount += 1
          if (draftSaveCount === 1) {
            await firstSaveGate
          }
          return jsonResponse(200, {
            draft: {
              revision: draftSaveCount,
              base_version_id: VERSION_ID,
            },
          })
        }
        if (url.endsWith("/editor/versions") && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual({ revision: 2 })
          return jsonResponse(200, {
            version: { id: "44444444-4444-4444-8444-444444444444" },
          })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      },
    )
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    const songStore = new SongStore()
    const service = new Audio2MidiEditorService(songStore)
    songStore.song = await service.loadProject()
    service.markDocumentReady()

    songStore.song.tracks[1].updateEvent<NoteEvent>(0, { noteNumber: 61 })
    service.onSongChanged()
    const firstSave = service.saveNow()

    songStore.song.tracks[1].updateEvent<NoteEvent>(0, { velocity: 82 })
    service.onSongChanged()
    finishFirstSave?.()
    await firstSave
    await service.publishVersion()

    expect(draftSaveCount).toBe(2)
    expect(service.status).toBe("published")
    expect(service.revision).toBe(0)
  })

  it("restores the local MIDI backup while offline", async () => {
    const midi = editableMidi()
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    localStorage.setItem(
      `audio2midi_editor_backup:${PROJECT_ID}`,
      JSON.stringify({
        projectId: PROJECT_ID,
        baseVersionId: VERSION_ID,
        revision: 3,
        midiData: uint8ArrayToBase64(midi),
        timestamp: Date.now(),
      }),
    )
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn(async () => {
        throw new TypeError("offline")
      }),
    })

    const songStore = new SongStore()
    const service = new Audio2MidiEditorService(songStore)
    songStore.song = await service.loadProject()

    expect(service.status).toBe("offline")
    expect(service.revision).toBe(3)
    expect(
      songStore.song.tracks[1].events.some((event) => event.type === "channel"),
    ).toBe(true)
  })
})
