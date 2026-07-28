import { emptySong } from "../song/SongFactory"
import { TrackEventOf } from "../track"
import { SetTempoEvent } from "midifile-ts"
import { secondsToTick, tickToSeconds } from "./audioTimeline"

describe("editor reference-audio timeline", () => {
  it("converts ticks across tempo changes in both directions", () => {
    const song = emptySong()
    song.tracks[0].addEvent<TrackEventOf<SetTempoEvent>>({
      type: "meta",
      subtype: "setTempo",
      tick: 480,
      microsecondsPerBeat: 1_000_000,
    })

    expect(tickToSeconds(song, 480)).toBeCloseTo(0.5)
    expect(tickToSeconds(song, 960)).toBeCloseTo(1.5)
    expect(secondsToTick(song, 1.5)).toBe(960)
  })

  it("clamps negative audio and MIDI positions to zero", () => {
    const song = emptySong()

    expect(tickToSeconds(song, -100)).toBe(0)
    expect(secondsToTick(song, -1)).toBe(0)
  })
})
