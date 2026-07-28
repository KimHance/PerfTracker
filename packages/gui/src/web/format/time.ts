/** 시간 표기. 순수 함수만 둔다 — 화면 어디서든 같은 문자열이 나와야 한다. */

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 경과 시간. 1시간을 넘기면 `h:mm:ss`, 아니면 `mm:ss`.
 * 음수는 0 으로 본다 — 시계가 뒤로 가는 경우(서버 시각 보정)에 `-1:59` 를 보여 줄 이유가 없다.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const tail = `${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${tail}` : tail
}

/** `HH:MM:SS` — CLI 로그와 세션 시작 시각에 쓴다. */
export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/**
 * 기록 목록의 `MM/DD HH:MM`.
 * ISO 문자열을 `Date` 로 되돌리지 않고 문자열로 자른다 — 서버가 준 시각은 이미 기기가 있던
 * 자리의 시각이고, 브라우저 타임존으로 옮기면 같은 세션이 다른 시각으로 보인다.
 */
export function formatRunAt(iso: string): string {
  const [date, time] = iso.split('T')
  if (!date || !time) return iso
  const [, month, day] = date.split('-')
  if (!month || !day) return iso
  return `${month}/${day} ${time.slice(0, 5)}`
}
