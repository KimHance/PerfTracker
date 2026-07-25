import { computeStatus, formatElapsed, readActiveSession } from '@perftracker/core'

/** 기기에 접촉하지 않는다 — 로컬 상태 파일만 읽는다 (규칙 1). */
export async function runStatus(serial: string): Promise<string> {
  const session = await readActiveSession(serial)
  if (session === null) return '실행 중인 세션이 없습니다.'

  const status = computeStatus(session, new Date())
  const lines = [
    `Session   ${session.name}  (${session.id})`,
    `App       ${session.packageName}`,
    `Elapsed   ${formatElapsed(status.elapsedMs)}`,
    `Run dir   ${session.runDir}`,
  ]

  if (status.durationExceeded) {
    lines.push(
      '',
      `설정된 최대 측정 시간(${formatElapsed(session.configuredDurationMs)})을 넘었습니다. ` +
        `트레이스 버퍼가 넘쳤을 수 있으며, 실제 여부는 stop 후 result.json 에 기록됩니다.`,
    )
  }

  return lines.join('\n')
}
