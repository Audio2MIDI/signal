import styled from "@emotion/styled"
import { FC, useEffect, useMemo, useRef, useState } from "react"
import { useAudio2MidiEditor } from "../../hooks/useAudio2MidiEditor"
import { usePlayer } from "../../hooks/usePlayer"
import { useRouter } from "../../hooks/useRouter"
import { useSong } from "../../hooks/useSong"
import { useCurrentLanguage } from "../../localize/useLocalization"
import { secondsToTick, tickToSeconds } from "../../services/audioTimeline"

const Shell = styled.header`
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 0.8rem;
  align-items: center;
  min-height: 4.25rem;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #f7f7f7;
  background:
    radial-gradient(
      circle at 18% -80%,
      rgba(245, 158, 11, 0.18),
      transparent 52%
    ),
    radial-gradient(
      circle at 84% 0%,
      rgba(56, 189, 248, 0.12),
      transparent 42%
    ),
    #050507;

  @media (max-width: 820px) {
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 3.5rem;
  }
`

const Identity = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.8rem;

  a {
    color: #f4f4f5;
    font-family: Georgia, serif;
    font-size: 1rem;
    text-decoration: none;
  }

  div {
    min-width: 0;
  }

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 0.78rem;
  }

  small {
    margin-top: 0.18rem;
    color: #71717a;
    font-size: 0.58rem;
  }
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;

  button,
  select {
    min-height: 2.1rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    color: #d4d4d8;
    background: rgba(255, 255, 255, 0.04);
    font: inherit;
    font-size: 0.66rem;
  }

  button {
    padding: 0 0.75rem;
    cursor: pointer;
  }

  button[data-active="true"] {
    border-color: rgba(147, 197, 253, 0.42);
    color: #dbeafe;
    background: rgba(29, 78, 216, 0.18);
  }

  @media (max-width: 820px) {
    &:first-of-type {
      display: none;
    }
  }
`

const Status = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #a1a1aa;
  font-size: 0.6rem;

  &::before {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 50%;
    background: currentColor;
    content: "";
  }
`

const PublishButton = styled.button`
  border-color: rgba(134, 239, 172, 0.28) !important;
  color: #dcfce7 !important;
  background: rgba(22, 163, 74, 0.12) !important;

  &:disabled {
    cursor: wait;
    opacity: 0.55;
  }
`

const ConflictPanel = styled.div`
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 0.55rem;
  color: #fef3c7;
  background: rgba(146, 64, 14, 0.22);

  div:first-of-type {
    min-width: 0;
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: 0.72rem;
  }

  small {
    margin-top: 0.15rem;
    color: #d6d3d1;
    font-size: 0.6rem;
  }

  div:last-of-type {
    display: flex;
    flex: 0 0 auto;
    gap: 0.4rem;
  }

  button {
    min-height: 1.9rem;
    padding: 0 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 0.42rem;
    color: #f4f4f5;
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
    font: inherit;
    font-size: 0.61rem;
  }

  button[data-primary="true"] {
    border-color: rgba(251, 191, 36, 0.38);
    color: #fffbeb;
    background: rgba(180, 83, 9, 0.35);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  @media (max-width: 820px) {
    align-items: stretch;
    flex-direction: column;

    div:last-of-type {
      overflow-x: auto;
    }

    button {
      flex: 0 0 auto;
    }
  }
`

const AudioBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;

  audio {
    width: 170px;
    height: 2rem;
  }

  select {
    max-width: 8rem;
    padding: 0 0.4rem;
  }

  button {
    min-height: 2rem;
    padding: 0 0.5rem;
    white-space: nowrap;
  }

  @media (max-width: 1050px) {
    audio {
      display: none;
    }
  }

  @media (max-width: 820px) {
    display: none;
  }
`

export const Audio2MidiEditorHeader: FC = () => {
  const editor = useAudio2MidiEditor()
  const { setPath } = useRouter()
  const { position, setPosition } = usePlayer()
  const { getSong } = useSong()
  const language = useCurrentLanguage()
  const ru = language === "ru"
  const statusLabel = ru
    ? {
        loading: "Загрузка",
        saved: "Сохранено",
        saving: "Сохраняем…",
        offline: "Локальная копия",
        conflict: "Конфликт версий",
        error: "Ошибка синхронизации",
        published: "Версия создана",
      }
    : {
        loading: "Loading",
        saved: "Saved",
        saving: "Saving…",
        offline: "Local backup",
        conflict: "Version conflict",
        error: "Sync error",
        published: "Version created",
      }
  const [audioKind, setAudioKind] = useState("generated")
  const [publishError, setPublishError] = useState("")
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const selectedAudio = useMemo(
    () =>
      editor.referenceAudio.find((item) => item.kind === audioKind) ??
      editor.referenceAudio[0],
    [audioKind, editor.referenceAudio],
  )

  useEffect(() => {
    if (
      editor.referenceAudio.length > 0 &&
      !editor.referenceAudio.some((item) => item.kind === audioKind)
    ) {
      setAudioKind(editor.referenceAudio[0].kind)
    }
  }, [audioKind, editor.referenceAudio])

  if (!editor.isEditorRoute) {
    return null
  }

  const publish = async () => {
    setPublishError("")
    try {
      await editor.publishVersion()
    } catch (error) {
      setPublishError((error as Error).message)
    }
  }

  const alignReferenceAudio = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = tickToSeconds(getSong(), position)
    }
  }

  const keepLocalConflict = async () => {
    setResolvingConflict(true)
    try {
      await editor.overwriteRemoteConflict()
    } finally {
      setResolvingConflict(false)
    }
  }

  const useServerConflict = async () => {
    setResolvingConflict(true)
    try {
      await editor.discardLocalConflict()
      window.location.reload()
    } finally {
      setResolvingConflict(false)
    }
  }

  const openInBrowser = async () => {
    if (!editor.projectId || browserBusy) {
      return
    }
    setBrowserBusy(true)
    setPublishError("")
    try {
      const response = await fetch("/api/v1/me/browser-handoffs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: editor.projectId }),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const body = (await response.json()) as { handoff_url: string }
      const target = new URL(
        body.handoff_url,
        window.location.origin,
      ).toString()
      const telegram = (
        window as typeof window & {
          Telegram?: { WebApp?: { openLink?: (url: string) => void } }
        }
      ).Telegram?.WebApp
      if (telegram?.openLink) {
        telegram.openLink(target)
      } else {
        window.open(target, "_blank", "noopener,noreferrer")
      }
    } catch {
      setPublishError(
        ru
          ? "Не удалось открыть полную версию"
          : "Could not open the full editor",
      )
    } finally {
      setBrowserBusy(false)
    }
  }

  return (
    <Shell title={publishError || editor.lastError}>
      <Identity>
        <a href="/">Audio2MIDI</a>
        <div>
          <strong>{editor.title}</strong>
          <small>
            <Status>{statusLabel[editor.status]}</Status>
            {editor.revision > 0
              ? ` · ${ru ? "черновик" : "draft"} r${editor.revision}`
              : ""}
          </small>
        </div>
      </Identity>

      <Controls>
        {editor.referenceAudio.length > 0 && (
          <AudioBar>
            <select
              aria-label={ru ? "Дорожка для сравнения" : "Reference track"}
              onChange={(event) => setAudioKind(event.target.value)}
              value={selectedAudio?.kind}
            >
              {editor.referenceAudio.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.kind === "source"
                    ? ru
                      ? "Оригинал"
                      : "Original"
                    : ru
                      ? "Результат"
                      : "Generated"}
                </option>
              ))}
            </select>
            {selectedAudio && (
              <>
                <audio
                  controls
                  onLoadedMetadata={alignReferenceAudio}
                  onSeeked={(event) =>
                    setPosition(
                      secondsToTick(getSong(), event.currentTarget.currentTime),
                    )
                  }
                  preload="metadata"
                  ref={audioRef}
                  src={selectedAudio.url}
                />
                <button onClick={alignReferenceAudio}>
                  {ru ? "К позиции" : "Sync position"}
                </button>
              </>
            )}
          </AudioBar>
        )}
      </Controls>

      <Controls>
        <button
          data-active={editor.mode === "simple"}
          onClick={() => {
            editor.setMode("simple")
            setPath("/track")
          }}
        >
          {ru ? "Простой" : "Simple"}
        </button>
        {!editor.compactTelegram && (
          <button
            data-active={editor.mode === "pro"}
            onClick={() => editor.setMode("pro")}
          >
            {ru ? "Профи" : "Pro"}
          </button>
        )}
        {editor.compactTelegram && (
          <button disabled={browserBusy} onClick={() => void openInBrowser()}>
            {browserBusy
              ? ru
                ? "Открываем…"
                : "Opening…"
              : ru
                ? "Полная версия ↗"
                : "Full editor ↗"}
          </button>
        )}
        <PublishButton
          disabled={
            editor.status === "loading" ||
            editor.status === "saving" ||
            editor.status === "conflict"
          }
          onClick={() => void publish()}
        >
          {ru ? "Сохранить версию" : "Save version"}
        </PublishButton>
      </Controls>
      {editor.status === "conflict" && (
        <ConflictPanel role="alert">
          <div>
            <strong>
              {ru ? "Две версии черновика" : "Two draft versions"}
            </strong>
            <small>
              {editor.lastError ||
                (ru
                  ? "Ваши локальные правки сохранены и не будут потеряны."
                  : "Your local edits are preserved and will not be lost.")}
            </small>
          </div>
          <div>
            <button
              disabled={resolvingConflict}
              onClick={editor.downloadConflictCopy}
            >
              {ru ? "Скачать мою копию" : "Download my copy"}
            </button>
            <button
              data-primary="true"
              disabled={resolvingConflict}
              onClick={() => void keepLocalConflict()}
            >
              {ru ? "Оставить мою версию" : "Keep my version"}
            </button>
            <button
              disabled={resolvingConflict}
              onClick={() => void useServerConflict()}
            >
              {ru ? "Загрузить серверную" : "Load server copy"}
            </button>
          </div>
        </ConflictPanel>
      )}
    </Shell>
  )
}
