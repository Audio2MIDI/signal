import { useCallback } from "react"
import { EditorMode } from "../services/Audio2MidiEditorService"
import { useMobxGetter } from "./useMobxSelector"
import { useStores } from "./useStores"

export function useAudio2MidiEditor() {
  const { audio2MidiEditorService: service } = useStores()
  const title = useMobxGetter(service, "title")
  const mode = useMobxGetter(service, "mode")
  const status = useMobxGetter(service, "status")
  const revision = useMobxGetter(service, "revision")
  const referenceAudio = useMobxGetter(service, "referenceAudio")
  const lastError = useMobxGetter(service, "lastError")

  return {
    projectId: service.projectId,
    isEditorRoute: service.isEditorRoute,
    title,
    mode,
    status,
    revision,
    referenceAudio,
    lastError,
    setMode: useCallback(
      (mode: EditorMode) => service.setMode(mode),
      [service],
    ),
    saveNow: useCallback(() => service.saveNow(), [service]),
    publishVersion: useCallback(() => service.publishVersion(), [service]),
    downloadConflictCopy: useCallback(
      () => service.downloadConflictCopy(),
      [service],
    ),
    discardLocalConflict: useCallback(
      () => service.discardLocalConflict(),
      [service],
    ),
    overwriteRemoteConflict: useCallback(
      () => service.overwriteRemoteConflict(),
      [service],
    ),
  }
}
