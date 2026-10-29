import { useProgress } from "dialog-hooks"
import { FC, useEffect, useState } from "react"
import { useSetSong } from "../../actions"
import { songFromArrayBuffer } from "../../actions/file"
import { initializeEditorDocument } from "../../services/initializeEditorDocument"
import { useAutoSave } from "../../hooks/useAutoSave"
import { useStores } from "../../hooks/useStores"
import { useLocalization } from "../../localize/useLocalization"
import { AutoSaveDialog } from "../AutoSaveDialog/AutoSaveDialog"
import { InitializeErrorDialog } from "./InitializeErrorDialog"

export const OnInit: FC = () => {
  const rootStore = useStores()
  const setSong = useSetSong()

  const [audioStatus, setAudioStatus] = useState("")
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isAutoSaveDialogOpen, setIsAutoSaveDialogOpen] = useState(false)
  const { show: showProgress } = useProgress()
  const localized = useLocalization()
  const { shouldShowAutoSaveDialog } = useAutoSave()

  const init = async () => {
    const closeProgress = showProgress(localized["initializing"])
    try {
      await rootStore.init()
    } catch (e) {
      setIsErrorDialogOpen(true)
      setErrorMessage((e as Error).message)
    } finally {
      closeProgress()
    }
  }

  const loadExternalMidiIfNeeded = async () => {
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get("open")

    if (openParam) {
      const closeProgress = showProgress(localized["loading-external-midi"])
      try {
        const response = await fetch(openParam, { credentials: "omit" })
        if (!response.ok) {
          throw new Error(`MIDI download failed: HTTP ${response.status}`)
        }
        const song = songFromArrayBuffer(
          await response.arrayBuffer(),
          undefined,
          "Audio2MIDI.mid",
        )
        setSong(song)
      } catch (e) {
        setIsErrorDialogOpen(true)
        setErrorMessage((e as Error).message)
      } finally {
        closeProgress()
      }
    }
  }

  const checkAutoSave = async () => {
    if (rootStore.audio2MidiEditorService.isEditorRoute) {
      return
    }
    // Skip auto save restore if external file loading is present
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get("open")
    if (openParam) {
      return
    }

    // Check for auto save restore
    if (shouldShowAutoSaveDialog()) {
      setIsAutoSaveDialogOpen(true)
    }
  }

  useEffect(() => {
    ;(async () => {
      if (rootStore.audio2MidiEditorService.isEditorRoute) {
        // Editing and cloud saves must not depend on an external sound bank.
        setAudioStatus(
          "Звук загружается. Редактирование и сохранение уже доступны.",
        )
        try {
          const song = await initializeEditorDocument(
            () => rootStore.init(),
            () => rootStore.audio2MidiEditorService.loadProject(),
            () => setAudioStatus(""),
            () =>
              setAudioStatus(
                "Звук недоступен. Редактирование и сохранение работают; перезагрузите страницу, чтобы повторить загрузку звука.",
              ),
          )
          setSong(song)
          rootStore.audio2MidiEditorService.markDocumentReady()
        } catch (e) {
          setIsErrorDialogOpen(true)
          setErrorMessage((e as Error).message)
        }
        return
      }
      await init()
      await loadExternalMidiIfNeeded()
      await checkAutoSave()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {audioStatus && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 8,
            left: 8,
            zIndex: 100,
            padding: "6px 10px",
            background: "#18181b",
            color: "#e4e4e7",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {audioStatus}
        </div>
      )}
      <InitializeErrorDialog
        open={isErrorDialogOpen}
        message={errorMessage}
        onClose={() => setIsErrorDialogOpen(false)}
      />
      <AutoSaveDialog
        open={isAutoSaveDialogOpen}
        onClose={() => setIsAutoSaveDialogOpen(false)}
      />
    </>
  )
}
