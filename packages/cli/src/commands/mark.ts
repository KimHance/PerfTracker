import { appendMark, computeStatus, formatElapsed, resolveMarkSession } from '@perftracker/core'

/**
 * 측정 중인 세션에 마킹 하나를 남긴다.
 *
 * **기기에 아무것도 보내지 않는다.** 활성 세션 포인터(호스트의 파일)만 고치므로 측정 창
 * 안에서 불려도 규칙 1 이 깨지지 않는다 — `createContext` 를 부르지 않는 것이 그 증거다.
 * 다른 명령과 달리 이 파일이 `AdbContext` 를 받지 않는 이유가 그것이다.
 */
export async function runMark(
  label: string,
  opts: { session?: string; device?: string },
  now: Date = new Date(),
): Promise<string> {
  const session = await resolveMarkSession({ sessionId: opts.session, serial: opts.device })
  const { mark, total } = await appendMark(session, label, now)

  const elapsed = formatElapsed(computeStatus(session, now).elapsedMs)

  return (
    `마킹 ${formatElapsed(mark.offsetMs)}  ${mark.label}\n` +
    `Session   ${session.name}  (${session.id})  ${session.serial}\n` +
    `경과      ${elapsed} · 마킹 ${total}개\n` +
    `기기에는 아무것도 보내지 않았습니다. 정지하면 result.json 의 session.marks[] 로 들어갑니다.`
  )
}
