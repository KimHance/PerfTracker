import type { ActiveSession } from './state.js'

export interface SessionStatus {
  session: ActiveSession
  elapsedMs: number
  durationExceeded: boolean
}

/** 기기에 묻지 않고 로컬 상태 파일만으로 계산한다 (규칙 1). */
export function computeStatus(session: ActiveSession, now: Date): SessionStatus {
  const elapsedMs = now.getTime() - new Date(session.startedAt).getTime()
  return {
    session,
    elapsedMs,
    durationExceeded: elapsedMs > session.configuredDurationMs,
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number): string => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}
