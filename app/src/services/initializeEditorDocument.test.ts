import { initializeEditorDocument } from "./initializeEditorDocument"

test("loads the document while the sound bank never responds", async () => {
  const audioReady = jest.fn()
  const document = await initializeEditorDocument(
    () => new Promise<void>(() => {}),
    async () => "midi",
    audioReady,
    jest.fn(),
  )
  expect(document).toBe("midi")
  expect(audioReady).not.toHaveBeenCalled()
})

test("audio failure reports a warning without discarding the document", async () => {
  const warning = jest.fn()
  await expect(
    initializeEditorDocument(
      async () => {
        throw new Error("offline")
      },
      async () => "midi",
      jest.fn(),
      warning,
    ),
  ).resolves.toBe("midi")
  await Promise.resolve()
  expect(warning).toHaveBeenCalledTimes(1)
})
