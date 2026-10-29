/**
 * @jest-environment jsdom
 */

import { webcrypto } from "crypto"
import { runInAction } from "mobx"
import { songFromMidi, songToMidi } from "../midi/midiConversion"
import { uint8ArrayToBase64 } from "../helpers/base64"
import { emptySong } from "../song/SongFactory"
import { isNoteEvent, NoteEvent } from "../track"
import { SongStore } from "../stores/SongStore"
import {
  Audio2MidiEditorService,
  editorLoginUrl,
} from "./Audio2MidiEditorService"

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

function manifestWithDraft(revision: number, updatedAt: string) {
  return {
    project: { id: PROJECT_ID, title: "Test song" },
    version: { id: VERSION_ID },
    artifacts: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        role: "midi",
        mime_type: "audio/midi",
        stream_url: "/remote.mid",
      },
    ],
    draft: {
      base_version_id: VERSION_ID,
      revision,
      download_url: "/remote-draft.mid",
      updated_at: updatedAt,
    },
    reference_audio: [],
  }
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

  it("preserves edits made while the version POST is in flight", async () => {
    const newVersion = "44444444-4444-4444-8444-444444444444"
    let releasePublish!: () => void
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    let postStarted!: () => void
    const postGate = new Promise<void>((resolve) => {
      postStarted = resolve
    })
    const draftWrites: RequestInit[] = []
    const fetchMock = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith(`/projects/${PROJECT_ID}/editor`) && !init?.method) {
          return jsonResponse(200, manifestWithDraft(1, "2026-01-01T00:00:00Z"))
        }
        if (url.endsWith("/remote-draft.mid"))
          return midiResponse(editableMidi())
        if (url.endsWith("/editor/versions")) {
          postStarted()
          await publishGate
          return jsonResponse(200, { version: { id: newVersion } })
        }
        if (url.endsWith("/editor/draft") && init?.method === "PUT") {
          draftWrites.push(init)
          return jsonResponse(200, {
            draft: { revision: 1, base_version_id: newVersion },
          })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      },
    )
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })
    const store = new SongStore()
    const service = new Audio2MidiEditorService(store)
    store.song = await service.loadProject()
    service.markDocumentReady()
    const publishing = service.publishVersion()
    await postGate
    const note = store.song.tracks[1].events.find(isNoteEvent)!
    store.song.tracks[1].updateEvent<NoteEvent>(note.id, { noteNumber: 65 })
    service.onSongChanged()
    const concurrentSave = service.saveNow()
    expect(draftWrites).toHaveLength(0)
    releasePublish()
    await publishing
    await concurrentSave
    expect(draftWrites).toHaveLength(1)
    expect(draftWrites[0].headers).toMatchObject({
      "If-Match": '"0"',
      "X-Base-Version": newVersion,
    })
    const saved = runInAction(() =>
      songFromMidi(new Uint8Array(draftWrites[0].body as Uint8Array)),
    )
    expect(saved.tracks[1].events.find(isNoteEvent)?.noteNumber).toBe(65)
    expect(service.revision).toBe(1)
    expect(service.status).toBe("saved")
  })

  it("saves newer edits when the pending version request fails", async () => {
    let rejectPublish!: (error: Error) => void
    const publishGate = new Promise<void>((_resolve, reject) => {
      rejectPublish = reject
    })
    let postStarted!: () => void
    const postGate = new Promise<void>((resolve) => {
      postStarted = resolve
    })
    const draftWrites: RequestInit[] = []
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith(`/projects/${PROJECT_ID}/editor`) && !init?.method)
          return jsonResponse(200, manifestWithDraft(1, "2026-01-01T00:00:00Z"))
        if (url.endsWith("/remote-draft.mid"))
          return midiResponse(editableMidi())
        if (url.endsWith("/editor/versions")) {
          postStarted()
          await publishGate
        }
        if (url.endsWith("/editor/draft") && init?.method === "PUT") {
          draftWrites.push(init)
          return jsonResponse(200, {
            draft: { revision: 2, base_version_id: VERSION_ID },
          })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    })
    const store = new SongStore()
    const service = new Audio2MidiEditorService(store)
    store.song = await service.loadProject()
    service.markDocumentReady()
    const publishing = service.publishVersion()
    const failure = expect(publishing).rejects.toThrow("connection interrupted")
    await postGate
    const note = store.song.tracks[1].events.find(isNoteEvent)!
    store.song.tracks[1].updateEvent<NoteEvent>(note.id, { noteNumber: 67 })
    service.onSongChanged()
    const saving = service.saveNow()
    rejectPublish(new Error("connection interrupted"))
    await failure
    await saving
    expect(draftWrites).toHaveLength(1)
    expect(draftWrites[0].headers).toMatchObject({
      "If-Match": '\"1\"',
      "X-Base-Version": VERSION_ID,
    })
    const saved = runInAction(() =>
      songFromMidi(new Uint8Array(draftWrites[0].body as Uint8Array)),
    )
    expect(saved.tracks[1].events.find(isNoteEvent)?.noteNumber).toBe(67)
    expect(service.revision).toBe(2)
    expect(service.status).toBe("saved")
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

  it("keeps a mismatched local revision in conflict without retrying it", async () => {
    const midi = editableMidi()
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
    const fetchMock = jest.fn(async () =>
      jsonResponse(
        200,
        manifestWithDraft(4, new Date(Date.now() + 60_000).toISOString()),
      ),
    )
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    const songStore = new SongStore()
    const service = new Audio2MidiEditorService(songStore)
    songStore.song = await service.loadProject()
    service.markDocumentReady()

    expect(service.status).toBe("conflict")
    expect(service.revision).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    songStore.song.tracks[1].updateEvent<NoteEvent>(0, { velocity: 77 })
    service.onSongChanged()
    await service.saveNow()

    expect(service.status).toBe("conflict")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("explicitly overwrites the latest remote draft after a conflict", async () => {
    const midi = editableMidi()
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
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          expect(new Headers(init.headers).get("If-Match")).toBe('"4"')
          expect(new Headers(init.headers).get("X-Base-Version")).toBe(
            VERSION_ID,
          )
          return jsonResponse(200, {
            draft: {
              revision: 5,
              base_version_id: VERSION_ID,
            },
          })
        }
        return jsonResponse(
          200,
          manifestWithDraft(4, new Date(Date.now() - 1000).toISOString()),
        )
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
    await service.overwriteRemoteConflict()

    expect(service.status).toBe("saved")
    expect(service.revision).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("preserves the local copy when the remote draft changes again", async () => {
    const midi = editableMidi()
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
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return jsonResponse(409, { detail: "draft_revision_conflict" })
        }
        return jsonResponse(
          200,
          manifestWithDraft(4, new Date(Date.now() - 1000).toISOString()),
        )
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
    await service.overwriteRemoteConflict()

    expect(service.status).toBe("conflict")
    expect(service.revision).toBe(3)
    expect(service.lastError).toMatch(/снова изменился|changed again/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(
      localStorage.getItem(`audio2midi_editor_backup:${PROJECT_ID}`),
    ).not.toBeNull()
  })

  it("removes the local conflict backup before loading the server copy", async () => {
    localStorage.setItem(
      `audio2midi_editor_backup:${PROJECT_ID}`,
      JSON.stringify({
        projectId: PROJECT_ID,
        baseVersionId: VERSION_ID,
        revision: 1,
        midiData: "",
        timestamp: Date.now(),
      }),
    )
    const service = new Audio2MidiEditorService(new SongStore())
    runInAction(() => {
      service.status = "conflict"
    })

    await service.discardLocalConflict()

    expect(
      localStorage.getItem(`audio2midi_editor_backup:${PROJECT_ID}`),
    ).toBeNull()
  })

  it("preserves the editor route in the login return URL", () => {
    expect(
      editorLoginUrl({
        pathname: `/editor/${PROJECT_ID}`,
        search: "?version=2",
      }),
    ).toBe(`/?login=1&next=${encodeURIComponent(`/editor/${PROJECT_ID}`)}`)
  })
})
