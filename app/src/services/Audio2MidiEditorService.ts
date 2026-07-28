import { action, makeObservable, observable, runInAction } from "mobx"
import { base64ToUint8Array, uint8ArrayToBase64 } from "../helpers/base64"
import { downloadBlob } from "../helpers/Downloader"
import { songFromArrayBuffer } from "../actions/file"
import { songToMidi } from "../midi/midiConversion"
import Song from "../song/Song"
import { SongStore } from "../stores/SongStore"

export type EditorMode = "simple" | "pro"
export type EditorSaveStatus =
  | "loading"
  | "saved"
  | "saving"
  | "offline"
  | "conflict"
  | "error"
  | "published"

interface EditorArtifact {
  id: string
  role: string
  mime_type: string
  stream_url: string
}

interface EditorManifest {
  project: {
    id: string
    title: string
  }
  version: {
    id: string
  }
  artifacts: EditorArtifact[]
  draft: {
    base_version_id: string
    revision: number
    download_url: string
    updated_at: string
  } | null
  reference_audio: Array<{
    kind: "source" | "generated"
    label: string
    url: string
    mime_type: string | null
  }>
}

interface LocalBackup {
  projectId: string
  baseVersionId: string
  revision: number
  midiData: string
  timestamp: number
}

const SAVE_DEBOUNCE_MS = 2000
const SAVE_THROTTLE_MS = 10000

function uiText(ru: string, en: string) {
  try {
    const settings = JSON.parse(localStorage.getItem("SettingStore") ?? "{}")
    if (settings.language) {
      return settings.language === "ru" ? ru : en
    }
  } catch {
    // Fall back to the browser locale when persisted settings are malformed.
  }
  return navigator.language.toLowerCase().startsWith("ru") ? ru : en
}

function projectIdFromLocation(): string | null {
  const match = window.location.pathname.match(
    /^\/editor\/([0-9a-f]{8}-[0-9a-f-]{27,})\/?$/i,
  )
  return match?.[1] ?? null
}

export function editorLoginUrl(
  location: Pick<Location, "pathname" | "search"> = window.location,
) {
  const next = location.pathname
  return `/?login=1&next=${encodeURIComponent(next)}`
}

function backupKey(projectId: string) {
  return `audio2midi_editor_backup:${projectId}`
}

const BACKUP_DATABASE = "audio2midi-editor"
const BACKUP_STORE = "drafts"

function openBackupDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"))
      return
    }
    const request = indexedDB.open(BACKUP_DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKUP_STORE)) {
        request.result.createObjectStore(BACKUP_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open editor backup"))
  })
}

async function readIndexedBackup(key: string): Promise<LocalBackup | null> {
  const database = await openBackupDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(BACKUP_STORE, "readonly")
        .objectStore(BACKUP_STORE)
        .get(key)
      request.onsuccess = () =>
        resolve((request.result as LocalBackup | undefined) ?? null)
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read editor backup"))
    })
  } finally {
    database.close()
  }
}

async function writeIndexedBackup(key: string, backup: LocalBackup) {
  const database = await openBackupDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKUP_STORE, "readwrite")
      transaction.objectStore(BACKUP_STORE).put(backup, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not save editor backup"))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Editor backup was aborted"))
    })
  } finally {
    database.close()
  }
}

async function deleteIndexedBackup(key: string) {
  const database = await openBackupDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKUP_STORE, "readwrite")
      transaction.objectStore(BACKUP_STORE).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not delete editor backup"))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Editor backup was aborted"))
    })
  } finally {
    database.close()
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const absolute = new URL(url, window.location.origin)
  const response = await fetch(absolute, {
    credentials:
      absolute.origin === window.location.origin ? "include" : "omit",
  })
  if (!response.ok) {
    throw new Error(
      `${uiText("Не удалось загрузить MIDI", "MIDI download failed")}: HTTP ${response.status}`,
    )
  }
  return response.arrayBuffer()
}

export class Audio2MidiEditorService {
  readonly projectId = projectIdFromLocation()
  title = "Audio2MIDI"
  mode: EditorMode =
    localStorage.getItem("audio2midi_editor_mode") === "pro" ? "pro" : "simple"
  status: EditorSaveStatus = "loading"
  revision = 0
  baseVersionId: string | null = null
  referenceAudio: EditorManifest["reference_audio"] = []
  lastError = ""

  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private lastRemoteSaveAt = 0
  private changeGeneration = 0
  private savedGeneration = 0
  private activeSave: Promise<void> | null = null
  private documentReady = false
  private restoredLocalNeedsSync = false

  constructor(private readonly songStore: SongStore) {
    makeObservable(this, {
      title: observable,
      mode: observable,
      status: observable,
      revision: observable,
      baseVersionId: observable,
      referenceAudio: observable.ref,
      lastError: observable,
      setMode: action.bound,
    })
  }

  get isEditorRoute() {
    return this.projectId !== null
  }

  setMode(mode: EditorMode) {
    this.mode = mode
    localStorage.setItem("audio2midi_editor_mode", mode)
  }

  async loadProject(): Promise<Song> {
    if (!this.projectId) {
      throw new Error(
        uiText(
          "Не указан проект Audio2MIDI",
          "Audio2MIDI project id is missing",
        ),
      )
    }
    runInAction(() => {
      this.status = "loading"
    })
    let manifest: EditorManifest
    try {
      const response = await fetch(
        `/api/v1/me/projects/${this.projectId}/editor`,
        { credentials: "include" },
      )
      if (response.status === 401) {
        window.location.assign(editorLoginUrl())
        throw new Error(
          uiText(
            "Войдите в кабинет, чтобы открыть редактор",
            "Sign in to open the editor",
          ),
        )
      }
      if (response.status === 403) {
        throw new Error(
          uiText(
            "Редактор пока недоступен для этого аккаунта",
            "The editor is not enabled for this account yet",
          ),
        )
      }
      if (!response.ok) {
        throw new Error(
          `${uiText("Не удалось открыть проект", "Could not open project")}: HTTP ${response.status}`,
        )
      }
      manifest = (await response.json()) as EditorManifest
    } catch (error) {
      const local = await this.readLocalBackup()
      if (local && navigator.onLine === false) {
        return runInAction(() => {
          this.baseVersionId = local.baseVersionId
          this.revision = local.revision
          this.restoredLocalNeedsSync = true
          this.status = "offline"
          return songFromArrayBuffer(
            base64ToUint8Array(local.midiData).buffer,
            undefined,
            uiText("Локальная копия.mid", "Local backup.mid"),
          )
        })
      }
      throw error
    }

    runInAction(() => {
      this.title =
        manifest.project.title || uiText("Транскрипция", "Transcription")
      this.referenceAudio = manifest.reference_audio
      this.baseVersionId =
        manifest.draft?.base_version_id ?? manifest.version.id
      this.revision = manifest.draft?.revision ?? 0
    })

    const local = await this.readLocalBackup()
    const remoteUpdatedAt = manifest.draft
      ? new Date(manifest.draft.updated_at).getTime()
      : 0
    const remoteRevision = manifest.draft?.revision ?? 0
    const localMatchesBase =
      local !== null && local.baseVersionId === this.baseVersionId
    const canRestoreLocal =
      localMatchesBase &&
      local.revision === remoteRevision &&
      local.timestamp > remoteUpdatedAt
    const hasLocalConflict =
      local !== null && (!localMatchesBase || local.revision !== remoteRevision)

    let buffer: ArrayBuffer
    if (hasLocalConflict) {
      buffer = base64ToUint8Array(local.midiData).buffer
      runInAction(() => {
        this.revision = local.revision
        this.status = "conflict"
        this.lastError = uiText(
          "На сервере есть другой черновик. Выберите, какую копию оставить.",
          "The server has a different draft. Choose which copy to keep.",
        )
      })
    } else if (canRestoreLocal) {
      buffer = base64ToUint8Array(local.midiData).buffer
      runInAction(() => {
        this.revision = local.revision
      })
      this.restoredLocalNeedsSync = true
    } else {
      const midi = manifest.artifacts.find((item) => item.role === "midi")
      const url = manifest.draft?.download_url ?? midi?.stream_url
      if (!url) {
        throw new Error(
          uiText(
            "В проекте нет MIDI для редактирования",
            "This project has no editable MIDI",
          ),
        )
      }
      buffer = await fetchBytes(url)
    }
    return runInAction(() => {
      const song = songFromArrayBuffer(buffer, undefined, `${this.title}.mid`)
      song.name = this.title
      song.isSaved = true
      if (this.status !== "conflict") {
        this.status = navigator.onLine ? "saved" : "offline"
      }
      return song
    })
  }

  onSongChanged = () => {
    if (!this.projectId || !this.documentReady) {
      return
    }
    this.changeGeneration += 1
    this.scheduleSave()
  }

  markDocumentReady() {
    this.documentReady = true
    if (this.restoredLocalNeedsSync) {
      this.restoredLocalNeedsSync = false
      this.changeGeneration += 1
      this.scheduleSave()
    }
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    const throttleRemaining = Math.max(
      0,
      SAVE_THROTTLE_MS - (Date.now() - this.lastRemoteSaveAt),
    )
    this.saveTimer = setTimeout(
      () => void this.saveNow(),
      Math.max(SAVE_DEBOUNCE_MS, throttleRemaining),
    )
  }

  saveNow(): Promise<void> {
    if (this.activeSave) {
      return this.activeSave
    }
    const generationAtStart = this.changeGeneration
    const operation = this.performSave()
    this.activeSave = operation
    return operation.finally(() => {
      if (this.activeSave === operation) {
        this.activeSave = null
      }
      if (
        this.changeGeneration > generationAtStart &&
        this.saveTimer === null
      ) {
        this.scheduleSave()
      }
    })
  }

  private async performSave(): Promise<void> {
    if (!this.projectId || !this.baseVersionId) {
      return
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.changeGeneration <= this.savedGeneration) {
      return
    }
    const snapshotGeneration = this.changeGeneration
    const bytes = songToMidi(this.songStore.song)
    await this.writeLocalBackup(bytes)
    if (this.status === "conflict") {
      this.savedGeneration = Math.max(this.savedGeneration, snapshotGeneration)
      return
    }
    if (!navigator.onLine) {
      runInAction(() => {
        this.status = "offline"
      })
      return
    }

    runInAction(() => {
      this.status = "saving"
      this.lastError = ""
    })
    try {
      const checksum = await sha256Hex(bytes)
      const response = await fetch(
        `/api/v1/me/projects/${this.projectId}/editor/draft`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "audio/midi",
            "If-Match": `"${this.revision}"`,
            "X-Base-Version": this.baseVersionId,
            "X-Audio-Sha256": checksum,
          },
          body: bytes,
        },
      )
      if (response.status === 409) {
        runInAction(() => {
          this.status = "conflict"
          this.lastError = uiText(
            "На другом устройстве появился более новый черновик. Выберите, какую копию оставить.",
            "A newer draft exists on another device. Choose which copy to keep.",
          )
        })
        return
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = (await response.json()) as {
        draft: { revision: number; base_version_id: string }
      }
      runInAction(() => {
        this.revision = payload.draft.revision
        this.baseVersionId = payload.draft.base_version_id
        this.lastRemoteSaveAt = Date.now()
        this.savedGeneration = Math.max(
          this.savedGeneration,
          snapshotGeneration,
        )
      })
      await this.writeLocalBackup(
        snapshotGeneration === this.changeGeneration
          ? bytes
          : songToMidi(this.songStore.song),
      )
      if (snapshotGeneration === this.changeGeneration) {
        runInAction(() => {
          this.songStore.song.isSaved = true
          this.status = "saved"
        })
      } else {
        this.scheduleSave()
      }
    } catch (error) {
      runInAction(() => {
        this.status = navigator.onLine ? "error" : "offline"
        this.lastError = `${uiText(
          "Черновик сохранён локально",
          "Draft saved locally",
        )}: ${(error as Error).message}`
      })
    }
  }

  async publishVersion(): Promise<void> {
    if (!this.projectId) {
      return
    }
    if (this.status === "conflict") {
      throw new Error(
        this.lastError ||
          uiText(
            "Сначала разрешите конфликт черновиков",
            "Resolve the draft conflict first",
          ),
      )
    }
    while (this.savedGeneration < this.changeGeneration) {
      await this.saveNow()
      if (
        (["conflict", "offline", "error"] as EditorSaveStatus[]).includes(
          this.status,
        )
      ) {
        throw new Error(
          this.lastError ||
            uiText(
              "Сначала синхронизируйте черновик",
              "Sync the draft before publishing",
            ),
        )
      }
    }
    if (this.revision < 1) {
      throw new Error(
        uiText(
          "Нет изменений для публикации",
          "There are no changes to publish",
        ),
      )
    }
    const sessionKey = `audio2midi_publish_key:${this.projectId}:${this.revision}`
    const idempotencyKey =
      sessionStorage.getItem(sessionKey) ?? crypto.randomUUID()
    sessionStorage.setItem(sessionKey, idempotencyKey)
    const response = await fetch(
      `/api/v1/me/projects/${this.projectId}/editor/versions`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ revision: this.revision }),
      },
    )
    if (!response.ok) {
      throw new Error(
        `${uiText(
          "Не удалось сохранить версию",
          "Could not save version",
        )}: HTTP ${response.status}`,
      )
    }
    const payload = (await response.json()) as {
      version: { id: string }
    }
    sessionStorage.removeItem(sessionKey)
    runInAction(() => {
      this.baseVersionId = payload.version.id
      this.revision = 0
      this.savedGeneration = this.changeGeneration
      this.status = "published"
      this.songStore.song.isSaved = true
    })
    await this.removeLocalBackup()
  }

  downloadConflictCopy() {
    if (this.status !== "conflict") {
      return
    }
    const bytes = songToMidi(this.songStore.song)
    const safeTitle =
      this.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "Audio2MIDI"
    downloadBlob(
      new Blob([bytes], { type: "audio/midi" }),
      `${safeTitle} — локальная копия.mid`,
    )
  }

  async discardLocalConflict(): Promise<void> {
    if (this.status !== "conflict") {
      return
    }
    await this.removeLocalBackup()
  }

  async overwriteRemoteConflict(): Promise<void> {
    if (!this.projectId || this.status !== "conflict") {
      return
    }
    const bytes = songToMidi(this.songStore.song)
    await this.writeLocalBackup(bytes)
    try {
      const manifestResponse = await fetch(
        `/api/v1/me/projects/${this.projectId}/editor`,
        { credentials: "include" },
      )
      if (!manifestResponse.ok) {
        throw new Error(`HTTP ${manifestResponse.status}`)
      }
      const manifest = (await manifestResponse.json()) as EditorManifest
      const remoteRevision = manifest.draft?.revision ?? 0
      const remoteBaseVersion =
        manifest.draft?.base_version_id ?? manifest.version.id
      const checksum = await sha256Hex(bytes)
      const response = await fetch(
        `/api/v1/me/projects/${this.projectId}/editor/draft`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "audio/midi",
            "If-Match": `"${remoteRevision}"`,
            "X-Base-Version": remoteBaseVersion,
            "X-Audio-Sha256": checksum,
          },
          body: bytes,
        },
      )
      if (response.status === 409) {
        runInAction(() => {
          this.lastError = uiText(
            "Черновик снова изменился на другом устройстве. Попробуйте ещё раз или загрузите серверную копию.",
            "The draft changed again on another device. Try again or load the server copy.",
          )
        })
        return
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = (await response.json()) as {
        draft: { revision: number; base_version_id: string }
      }
      runInAction(() => {
        this.revision = payload.draft.revision
        this.baseVersionId = payload.draft.base_version_id
        this.savedGeneration = this.changeGeneration
        this.lastRemoteSaveAt = Date.now()
        this.status = "saved"
        this.lastError = ""
        this.songStore.song.isSaved = true
      })
      await this.writeLocalBackup(bytes)
    } catch (error) {
      runInAction(() => {
        this.status = "conflict"
        this.lastError = `${uiText(
          "Не удалось разрешить конфликт",
          "Could not resolve the conflict",
        )}: ${(error as Error).message}`
      })
    }
  }

  private async writeLocalBackup(bytes: Uint8Array) {
    if (!this.projectId || !this.baseVersionId) {
      return
    }
    const backup: LocalBackup = {
      projectId: this.projectId,
      baseVersionId: this.baseVersionId,
      revision: this.revision,
      midiData: uint8ArrayToBase64(bytes),
      timestamp: Date.now(),
    }
    const key = backupKey(this.projectId)
    try {
      await writeIndexedBackup(key, backup)
      localStorage.removeItem(key)
      return
    } catch {
      try {
        localStorage.setItem(key, JSON.stringify(backup))
        return
      } catch (error) {
        console.warn("Audio2MIDI local backup failed", error)
      }
    }
  }

  private async readLocalBackup(): Promise<LocalBackup | null> {
    if (!this.projectId) {
      return null
    }
    const key = backupKey(this.projectId)
    try {
      const indexed = await readIndexedBackup(key)
      if (indexed) {
        return indexed
      }
    } catch {
      // Older browsers and privacy modes may not expose IndexedDB.
    }
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as LocalBackup) : null
    } catch {
      return null
    }
  }

  private async removeLocalBackup() {
    if (!this.projectId) {
      return
    }
    const key = backupKey(this.projectId)
    localStorage.removeItem(key)
    try {
      await deleteIndexedBackup(key)
    } catch {
      // The remote version was published; an unavailable IndexedDB is harmless.
    }
  }
}
