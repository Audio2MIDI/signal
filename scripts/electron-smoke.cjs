// Run only with Electron, after building the main/preload and desktop renderer.
const { app } = require("electron")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "audio2midi-electron-smoke-"),
)
for (const name of ["userData", "sessionData", "logs"]) {
  const dir = path.join(profile, name)
  fs.mkdirSync(dir)
  app.setPath(name, dir)
}
app.setName("Audio2MIDI Isolated Smoke")
process.argv = [process.argv[0], __filename]
Object.defineProperty(app, "isPackaged", { value: true })
const fixtures = path.join(profile, "soundfonts")
fs.mkdirSync(fixtures)
fs.writeFileSync(path.join(fixtures, "fixture.sf2"), "")
fs.writeFileSync(path.join(fixtures, "ignore.txt"), "")
fs.mkdirSync(path.join(fixtures, "directory.sf2"))
const timer = setTimeout(
  () => finish(new Error("Desktop smoke timed out")),
  30000,
)
let finished = false
function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  if (error) console.error(error)
  else
    console.log(
      JSON.stringify({
        status: "passed",
        electron: process.versions.electron,
        isolatedProfile: profile,
      }),
    )
  app.exit(error ? 1 : 0)
}
process.on("uncaughtException", finish)
process.on("unhandledRejection", finish)
app.on("browser-window-created", (_, win) => {
  win.hide()
  win.webContents.on("render-process-gone", (_, details) =>
    finish(new Error(JSON.stringify(details))),
  )
  win.webContents.on("preload-error", (_, __, error) => finish(error))
  win.webContents.on(
    "did-fail-load",
    (_, code, description, url, mainFrame) => {
      if (mainFrame) finish(new Error(`${code} ${description} ${url}`))
    },
  )
  win.webContents.once("did-finish-load", async () => {
    try {
      assert.equal(app.getPath("userData"), path.join(profile, "userData"))
      let state
      for (let n = 0; n < 100; n++) {
        state = await win.webContents.executeJavaScript(
          "({ text: document.body.innerText, bridge: typeof window.electronAPI })",
        )
        if (state.text.includes("Track 1") && state.bridge === "object") break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(state.text.includes("Track 1"), state.text)
      assert.equal(state.bridge, "object")
      const files = await win.webContents.executeJavaScript(
        `window.electronAPI.searchSoundFonts(${JSON.stringify(fixtures)})`,
      )
      assert.deepEqual(files, [path.join(fixtures, "fixture.sf2")])
      finish()
    } catch (error) {
      finish(error)
    }
  })
})
require("../electron/dist/index.js")
