import * as fs from "fs"
import {
  AnyEvent,
  ControllerEvent,
  SetTempoEvent,
  TimeSignatureEvent,
} from "midifile-ts"
import * as path from "path"
import { serialize } from "serializr"
import { emptySong } from "../song/SongFactory"
import { isNoteEvent, NoteEvent, TrackEventOf } from "../track"
import Track from "../track/Track"
import {
  noteOffMidiEvent,
  noteOnMidiEvent,
  setTempoMidiEvent,
  timeSignatureMidiEvent,
} from "./MidiEvent"
import {
  createConductorTrackIfNeeded,
  songFromMidi,
  songToMidi,
  songToMidiEvents,
} from "./midiConversion"

// id for each event will not be serialized in midi file
// we change ids sorted by order in events array
const reassignIDs = (track: Track) => {
  track.events.forEach((e, i) => {
    track.events[i].id = i
  })
}

describe("SongFile", () => {
  it("write and read", () => {
    const song = emptySong()
    song.tracks[1].addEvent<NoteEvent>({
      type: "channel",
      subtype: "note",
      noteNumber: 57,
      tick: 960,
      velocity: 127,
      duration: 240,
    })
    song.tracks.forEach(reassignIDs)
    const bytes = songToMidi(song)
    const song2 = songFromMidi(bytes)
    song2.filepath = song.filepath // filepath will not be serialized
    expect(serialize(song2)).toStrictEqual(serialize(song))
  })
  describe("songToMidiEvents", () => {
    const expectEveryTrackHaveEndOfTrackEvent = (tracks: AnyEvent[][]) => {
      for (const track of tracks) {
        expect(
          track.findIndex(
            (e) => e.type === "meta" && e.subtype === "endOfTrack",
          ),
        ).toBe(track.length - 1)
      }
    }

    const openFile = (fileName: string): AnyEvent[][] => {
      const song = songFromMidi(
        fs.readFileSync(path.join(__dirname, "../../testdata/", fileName))
          .buffer,
      )
      return songToMidiEvents(song)
    }

    describe("format 1", () => {
      const rawTracks = openFile("tracks.mid")

      it("every tracks have endOfTrack event", () => {
        expect(rawTracks.length).toBe(18)
        expectEveryTrackHaveEndOfTrackEvent(rawTracks)
      })
    })

    describe("format 0", () => {
      const rawTracks = openFile("format0.mid")

      it("every tracks have endOfTrack event", () => {
        expect(rawTracks.length).toBe(17)
        expectEveryTrackHaveEndOfTrackEvent(rawTracks)
      })
    })
  })

  describe("signal events", () => {
    it("should save the track color", () => {
      const song = emptySong()
      song.tracks[1].setColor({
        red: 12,
        green: 34,
        blue: 56,
        alpha: 78,
      })
      const bytes = songToMidi(song)
      const song2 = songFromMidi(bytes)
      expect(song2.tracks[1].color).toMatchObject({
        red: 12,
        green: 34,
        blue: 56,
        alpha: 78,
      })
    })
  })
  describe("editor round trip", () => {
    it("preserves tempo, time signature, CC and 10,000 notes", () => {
      const song = emptySong()
      song.tracks[0].addEvent<TrackEventOf<SetTempoEvent>>({
        type: "meta",
        subtype: "setTempo",
        tick: 0,
        microsecondsPerBeat: 600000,
      })
      song.tracks[0].addEvent<TrackEventOf<TimeSignatureEvent>>({
        type: "meta",
        subtype: "timeSignature",
        tick: 0,
        numerator: 3,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
      })
      song.tracks[1].addEvent<TrackEventOf<ControllerEvent>>({
        type: "channel",
        subtype: "controller",
        tick: 240,
        controllerType: 64,
        value: 127,
      })
      for (let index = 0; index < 10000; index += 1) {
        song.tracks[1].addEvent<NoteEvent>({
          type: "channel",
          subtype: "note",
          noteNumber: 36 + (index % 60),
          tick: index * 30,
          velocity: 40 + (index % 80),
          duration: 120,
        })
      }

      const restored = songFromMidi(songToMidi(song))
      const conductorEvents = restored.tracks[0].events
      const musicEvents = restored.tracks[1].events

      expect(
        conductorEvents.find(
          (event) =>
            event.type === "meta" &&
            event.subtype === "setTempo" &&
            event.microsecondsPerBeat === 600000,
        ),
      ).toMatchObject({ microsecondsPerBeat: 600000 })
      expect(
        conductorEvents.find(
          (event) =>
            event.type === "meta" &&
            event.subtype === "timeSignature" &&
            event.numerator === 3,
        ),
      ).toMatchObject({ numerator: 3, denominator: 4 })
      expect(
        musicEvents.find(
          (event) =>
            event.type === "channel" &&
            event.subtype === "controller" &&
            event.controllerType === 64,
        ),
      ).toMatchObject({ tick: 240, value: 127 })
      expect(musicEvents.filter(isNoteEvent)).toHaveLength(10000)
    })
  })
  describe("createConductorTrackIfNeeded", () => {
    it("should not create the conductor track", () => {
      const tracks: AnyEvent[][] = [
        [timeSignatureMidiEvent(0, 4, 4), setTempoMidiEvent(120, 500000)],
        [noteOnMidiEvent(0, 1, 60, 100), noteOffMidiEvent(120, 1, 60, 0)],
      ]
      const result = createConductorTrackIfNeeded(tracks)
      expect(result).toStrictEqual([
        [timeSignatureMidiEvent(0, 4, 4), setTempoMidiEvent(120, 500000)],
        [noteOnMidiEvent(0, 1, 60, 100), noteOffMidiEvent(120, 1, 60, 0)],
      ])
    })
    it("should create the conductor track", () => {
      const tracks: AnyEvent[][] = [
        [
          timeSignatureMidiEvent(0, 4, 4),
          setTempoMidiEvent(120, 500000),
          noteOnMidiEvent(120, 5, 60, 100),
          noteOffMidiEvent(120, 5, 60, 0),
        ],
        [noteOnMidiEvent(0, 2, 60, 100), noteOffMidiEvent(120, 2, 60, 0)],
      ]
      const result = createConductorTrackIfNeeded(tracks)
      expect(result).toStrictEqual([
        [timeSignatureMidiEvent(0, 4, 4), setTempoMidiEvent(120, 500000)],
        [noteOnMidiEvent(240, 5, 60, 100), noteOffMidiEvent(120, 5, 60, 0)],
        [noteOnMidiEvent(0, 2, 60, 100), noteOffMidiEvent(120, 2, 60, 0)],
      ])
    })
  })
})
