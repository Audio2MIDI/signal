import { midiDownloadFileName } from "./midiConversion"

test("names project MIDI downloads after the composition", () => {
  expect(midiDownloadFileName({ filepath: "", name: "Тест редактора" })).toBe(
    "Тест редактора.mid",
  )
  expect(midiDownloadFileName({ filepath: "demo.mid", name: "Other" })).toBe(
    "demo.mid",
  )
})

test("sanitizes filenames and provides a useful empty fallback", () => {
  expect(midiDownloadFileName({ filepath: "", name: "test/part:1" })).toBe(
    "test_part_1.mid",
  )
  expect(midiDownloadFileName({ filepath: "", name: "" })).toBe(
    "Audio2MIDI.mid",
  )
})
