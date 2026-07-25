import {
  type ActiveSession,
  computeStatus,
  formatElapsed,
  listActiveSessions,
  readActiveSession,
} from '@perftracker/core'

/**
 * serial 을 명시하면 그 기기만 본다. 생략하면 활성 세션 포인터를 열거해서:
 *   - 0개면 "없다"
 *   - 정확히 1개면 그 세션
 *   - 2개 이상이면 -d 로 지정하라고 안내 (모든 serial 을 이름과 함께 보여준다)
 * 어느 경로도 adb 를 부르지 않는다 — 기기에 접촉하지 않는다 (규칙 1).
 */
export async function runStatus(serial?: string, home?: string): Promise<string> {
  let session: ActiveSession | null
  if (serial !== undefined) {
    session = await readActiveSession(serial, home)
  } else {
    const active = await listActiveSessions(home)
    if (active.length > 1) {
      return [
        '실행 중인 세션이 여러 기기에 있습니다:',
        ...active.map((s) => `  ${s.serial}  ${s.name} (${s.id})`),
        '',
        '-d <serial> 로 대상 기기를 지정하세요.',
      ].join('\n')
    }
    session = active[0] ?? null
  }

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
