import styled from "@emotion/styled"
import { FC, useCallback } from "react"
import { useAudio2MidiEditor } from "../../hooks/useAudio2MidiEditor"
import { useHistory } from "../../hooks/useHistory"
import { usePianoRoll, usePianoRollQuantizer } from "../../hooks/usePianoRoll"
import { useSong } from "../../hooks/useSong"
import { useTrack } from "../../hooks/useTrack"
import { useCurrentLanguage } from "../../localize/useLocalization"
import { emptyTrack } from "../../track/TrackFactory"
import { NoteEvent, isNoteEvent } from "../../track"

const Bar = styled.div`
  display: flex;
  min-height: 2.45rem;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  border-bottom: 1px solid var(--color-divider);
  background: #09090b;

  span {
    margin-right: 0.25rem;
    color: #71717a;
    font-size: 0.61rem;
  }

  button {
    min-height: 1.75rem;
    padding: 0 0.58rem;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 0.38rem;
    color: #d4d4d8;
    background: rgba(255, 255, 255, 0.035);
    cursor: pointer;
    font: inherit;
    font-size: 0.61rem;
  }

  button:hover {
    border-color: rgba(147, 197, 253, 0.36);
    color: #fff;
    background: rgba(29, 78, 216, 0.1);
  }

  @media (max-width: 600px) {
    overflow-x: auto;
    flex-wrap: nowrap;

    span {
      display: none;
    }

    button {
      flex: 0 0 auto;
    }
  }
`

function withoutId(note: NoteEvent): Omit<NoteEvent, "id"> {
  const { id: _id, ...copy } = note
  return copy
}

export const QuickActions: FC = () => {
  const editor = useAudio2MidiEditor()
  const { selectedTrackId } = usePianoRoll()
  const { enabledQuantizer: quantizer } = usePianoRollQuantizer()
  const track = useTrack(selectedTrackId)
  const song = useSong()
  const { pushHistory } = useHistory()
  const ru = useCurrentLanguage() === "ru"

  const notes = useCallback(
    () => track.getEvents().filter(isNoteEvent),
    [track],
  )

  const quantize = useCallback(() => {
    const source = notes()
    if (!source.length) return
    const changes = source.filter(
      (note) => quantizer.round(note.tick) !== note.tick,
    )
    if (!changes.length) return
    if (
      !window.confirm(
        ru
          ? `Выровнять по сетке ${changes.length} нот? Действие можно отменить.`
          : `Quantize ${changes.length} notes? You can undo this action.`,
      )
    ) {
      return
    }
    pushHistory()
    track.updateEvents(
      changes.map((note) => ({
        id: note.id,
        tick: quantizer.round(note.tick),
      })),
    )
  }, [notes, pushHistory, quantizer, ru, track])

  const mergeRepeats = useCallback(() => {
    const source = [...notes()].sort(
      (left, right) =>
        left.noteNumber - right.noteNumber || left.tick - right.tick,
    )
    const updates: Array<Partial<NoteEvent> & { id: number }> = []
    const removals: number[] = []
    const lastByPitch = new Map<number, NoteEvent>()
    const bpm = song.tracks[0]?.getTempo(0) ?? 120
    const thresholdTicks = Math.max(
      1,
      Math.round((80 / (60000 / bpm)) * song.timebase),
    )
    for (const note of source) {
      const previous = lastByPitch.get(note.noteNumber)
      if (
        previous &&
        note.tick - (previous.tick + previous.duration) < thresholdTicks
      ) {
        const duration =
          Math.max(
            previous.tick + previous.duration,
            note.tick + note.duration,
          ) - previous.tick
        previous.duration = duration
        updates.push({ id: previous.id, duration })
        removals.push(note.id)
      } else {
        lastByPitch.set(note.noteNumber, { ...note })
      }
    }
    if (!removals.length) {
      window.alert(
        ru
          ? "Повторных нот с интервалом меньше 80 мс не найдено."
          : "No repeated notes less than 80 ms apart were found.",
      )
      return
    }
    if (
      !window.confirm(
        ru
          ? `Объединить ${removals.length} повторных нот? Действие можно отменить.`
          : `Merge ${removals.length} repeated notes? You can undo this action.`,
      )
    ) {
      return
    }
    pushHistory()
    track.updateEvents(updates)
    track.removeEvents(removals)
  }, [notes, pushHistory, ru, song.timebase, song.tracks, track])

  const limitPolyphony = useCallback(() => {
    const requested = Number(
      window.prompt(ru ? "Максимальная полифония" : "Maximum polyphony", "8"),
    )
    if (!Number.isInteger(requested) || requested < 1 || requested > 32) {
      return
    }
    const source = [...notes()].sort((left, right) => left.tick - right.tick)
    let active: NoteEvent[] = []
    const removals = new Set<number>()
    for (const note of source) {
      active = active.filter(
        (item) =>
          !removals.has(item.id) && item.tick + item.duration > note.tick,
      )
      const candidates = [...active, note]
      if (candidates.length > requested) {
        const quietest = candidates.reduce((current, item) =>
          item.velocity < current.velocity ? item : current,
        )
        removals.add(quietest.id)
        active = candidates.filter((item) => item.id !== quietest.id)
      } else {
        active = candidates
      }
    }
    if (!removals.size) {
      window.alert(
        ru
          ? "Текущая полифония уже укладывается в это ограничение."
          : "The current polyphony is already within this limit.",
      )
      return
    }
    if (
      !window.confirm(
        ru
          ? `Preview: будут удалены ${removals.size} самых тихих пересекающихся нот. Продолжить?`
          : `Preview: ${removals.size} quietest overlapping notes will be removed. Continue?`,
      )
    ) {
      return
    }
    pushHistory()
    track.removeEvents([...removals])
  }, [notes, pushHistory, ru, track])

  const splitHands = useCallback(() => {
    const boundary = Number(
      window.prompt(
        ru
          ? "Граница рук (MIDI note, C4 = 60)"
          : "Hand split point (MIDI note, C4 = 60)",
        "60",
      ),
    )
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > 127) {
      return
    }
    const lower = notes().filter((note) => note.noteNumber < boundary)
    if (!lower.length) {
      window.alert(
        ru
          ? "Ниже выбранной границы нот нет."
          : "There are no notes below the selected split point.",
      )
      return
    }
    if (
      !window.confirm(
        ru
          ? `Перенести ${lower.length} нот ниже ${boundary} в отдельную дорожку левой руки?`
          : `Move ${lower.length} notes below ${boundary} to a separate left-hand track?`,
      )
    ) {
      return
    }
    pushHistory()
    const handTrack = emptyTrack(track.channel ?? 0)
    handTrack.setName(ru ? "Левая рука" : "Left hand")
    handTrack.setProgramNumber(track.programNumber)
    handTrack.addEvents(lower.map(withoutId))
    track.removeEvents(lower.map((note) => note.id))
    song.addTrack(handTrack)
  }, [notes, pushHistory, ru, song, track])

  const humanize = useCallback(() => {
    const source = notes()
    if (!source.length) return
    if (
      !window.confirm(
        ru
          ? "Добавить лёгкое случайное смещение времени и velocity? Действие можно отменить."
          : "Add subtle random timing and velocity variation? You can undo this action.",
      )
    ) {
      return
    }
    pushHistory()
    const tickSpread = Math.max(1, Math.round(song.timebase / 48))
    track.updateEvents(
      source.map((note) => ({
        id: note.id,
        tick: Math.max(
          0,
          note.tick + Math.round((Math.random() * 2 - 1) * tickSpread),
        ),
        velocity: Math.max(
          1,
          Math.min(
            127,
            note.velocity + Math.round((Math.random() * 2 - 1) * 5),
          ),
        ),
      })),
    )
  }, [notes, pushHistory, ru, song.timebase, track])

  if (!editor.isEditorRoute) {
    return null
  }

  return (
    <Bar>
      <span>{ru ? "Быстрые правки" : "Quick edits"}</span>
      <button onClick={quantize}>Quantize</button>
      <button onClick={mergeRepeats}>
        {ru ? "Убрать повторы <80 мс" : "Merge repeats <80 ms"}
      </button>
      <button onClick={limitPolyphony}>
        {ru ? "Ограничить полифонию" : "Limit polyphony"}
      </button>
      <button onClick={splitHands}>
        {ru ? "Разделить руки · C4" : "Split hands · C4"}
      </button>
      {editor.mode === "pro" && <button onClick={humanize}>Humanize</button>}
    </Bar>
  )
}
