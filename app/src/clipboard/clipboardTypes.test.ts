import {
  ArrangeNotesClipboardDataSchema,
  ControlEventsClipboardDataSchema,
  PianoNotesClipboardDataSchema,
  TempoEventsClipboardDataSchema,
} from "./clipboardTypes"

test("clipboard schemas preserve existing event payloads after Zod upgrade", () => {
  const events = [{ type: "note", noteNumber: 60, tick: 120, duration: 240 }]
  for (const [schema, value] of [
    [PianoNotesClipboardDataSchema, { type: "piano_notes", notes: events }],
    [ControlEventsClipboardDataSchema, { type: "control_events", events }],
    [TempoEventsClipboardDataSchema, { type: "tempo_events", events }],
    [
      ArrangeNotesClipboardDataSchema,
      {
        type: "arrange_notes",
        notes: { "0": events, "12": [] },
        selectedTrackIndex: 0,
      },
    ],
  ] as const) {
    expect(schema.parse(value)).toEqual(value)
  }
})

test("clipboard schemas reject malformed event containers", () => {
  expect(
    PianoNotesClipboardDataSchema.safeParse({ type: "piano_notes", notes: {} })
      .success,
  ).toBe(false)
  expect(
    ArrangeNotesClipboardDataSchema.safeParse({
      type: "arrange_notes",
      notes: { "0": "invalid" },
      selectedTrackIndex: 0,
    }).success,
  ).toBe(false)
  expect(
    ControlEventsClipboardDataSchema.safeParse({
      type: "tempo_events",
      events: [],
    }).success,
  ).toBe(false)
})
