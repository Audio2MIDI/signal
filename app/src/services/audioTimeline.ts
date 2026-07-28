import Song from "../song/Song"

const DEFAULT_MICROSECONDS_PER_BEAT = 500000

interface TempoPoint {
  tick: number
  microsecondsPerBeat: number
}

function tempoPoints(song: Song): TempoPoint[] {
  return (song.conductorTrack?.events ?? [])
    .filter(
      (event): event is typeof event & TempoPoint =>
        event.type === "meta" && event.subtype === "setTempo",
    )
    .map((event) => ({
      tick: event.tick,
      microsecondsPerBeat: event.microsecondsPerBeat,
    }))
    .sort((left, right) => left.tick - right.tick)
}

export function tickToSeconds(song: Song, requestedTick: number): number {
  const targetTick = Math.max(0, requestedTick)
  let elapsedSeconds = 0
  let previousTick = 0
  let microsecondsPerBeat = DEFAULT_MICROSECONDS_PER_BEAT

  for (const point of tempoPoints(song)) {
    if (point.tick > targetTick) {
      break
    }
    elapsedSeconds +=
      ((point.tick - previousTick) / song.timebase) *
      (microsecondsPerBeat / 1_000_000)
    previousTick = point.tick
    microsecondsPerBeat = point.microsecondsPerBeat
  }
  return (
    elapsedSeconds +
    ((targetTick - previousTick) / song.timebase) *
      (microsecondsPerBeat / 1_000_000)
  )
}

export function secondsToTick(song: Song, requestedSeconds: number): number {
  let remainingSeconds = Math.max(0, requestedSeconds)
  let previousTick = 0
  let microsecondsPerBeat = DEFAULT_MICROSECONDS_PER_BEAT

  for (const point of tempoPoints(song)) {
    const segmentSeconds =
      ((point.tick - previousTick) / song.timebase) *
      (microsecondsPerBeat / 1_000_000)
    if (remainingSeconds < segmentSeconds) {
      return Math.round(
        previousTick +
          (remainingSeconds * 1_000_000 * song.timebase) / microsecondsPerBeat,
      )
    }
    remainingSeconds -= segmentSeconds
    previousTick = point.tick
    microsecondsPerBeat = point.microsecondsPerBeat
  }
  return Math.round(
    previousTick +
      (remainingSeconds * 1_000_000 * song.timebase) / microsecondsPerBeat,
  )
}
