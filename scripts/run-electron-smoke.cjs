const path = require("node:path")
const { createRequire } = require("node:module")
const { spawnSync } = require("node:child_process")
const root = path.resolve(__dirname, "..")
const electronRequire = createRequire(path.join(root, "electron/package.json"))
const args = []
// Chromium checks the SUID sandbox before loading any app JavaScript.
if (process.env.CI && process.platform === "linux") args.push("--no-sandbox")
args.push(path.join(__dirname, "electron-smoke.cjs"))
const result = spawnSync(electronRequire("electron"), args, {
  stdio: "inherit",
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
