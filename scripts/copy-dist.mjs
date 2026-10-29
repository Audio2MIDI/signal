import { cpSync, rmSync } from "node:fs"

const target = process.argv[2]
if (!["dist", "electron/dist_renderer"].includes(target)) {
  throw new Error("Expected dist or electron/dist_renderer")
}
rmSync(target, { recursive: true, force: true })
cpSync("app/dist", target, { recursive: true })
