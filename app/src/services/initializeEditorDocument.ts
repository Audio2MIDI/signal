/** Start optional audio without delaying the owned MIDI document. */
export async function initializeEditorDocument<T>(
  initializeAudio: () => Promise<void>,
  loadDocument: () => Promise<T>,
  onAudioReady: () => void,
  onAudioError: () => void,
): Promise<T> {
  void Promise.resolve().then(initializeAudio).then(onAudioReady, onAudioError)
  return loadDocument()
}
