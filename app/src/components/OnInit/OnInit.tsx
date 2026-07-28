import { useProgress } from "dialog-hooks"
import { FC, useEffect, useState } from "react"
import { useSetSong } from "../../actions"
import { songFromArrayBuffer } from "../../actions/file"
import { useAutoSave } from "../../hooks/useAutoSave"
import { useStores } from "../../hooks/useStores"
import { useLocalization } from "../../localize/useLocalization"
import { AutoSaveDialog } from "../AutoSaveDialog/AutoSaveDialog"
import { InitializeErrorDialog } from "./InitializeErrorDialog"

export const OnInit: FC = () => {
  const rootStore = useStores()
  const setSong = useSetSong()

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
      await init()
      if (rootStore.audio2MidiEditorService.isEditorRoute) {
        try {
          const song = await rootStore.audio2MidiEditorService.loadProject()
          setSong(song)
          rootStore.audio2MidiEditorService.markDocumentReady()
        } catch (e) {
          setIsErrorDialogOpen(true)
          setErrorMessage((e as Error).message)
        }
        return
      }
      await loadExternalMidiIfNeeded()
      await checkAutoSave()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
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
