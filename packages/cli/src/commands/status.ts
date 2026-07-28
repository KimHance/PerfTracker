import {
  type ActiveSession,
  computeStatus,
  formatElapsed,
  listActiveSessions,
  readActiveSession,
  sortedMarks,
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
  const marks = sortedMarks(session)
  const violations = session.adbCommandsDuringSession ?? 0

  const lines = [
    `Session   ${session.name}  (${session.id})`,
    `App       ${session.packageName}`,
    `Elapsed   ${formatElapsed(status.elapsedMs)}`,
    `Run dir   ${session.runDir}`,
  ]

  // 마킹은 이 순간의 사실이고 세션이 끝나야 result.json 으로 간다.
  if (marks.length > 0) {
    lines.push(`Marks     ${marks.length}개 · 마지막 ${formatElapsed(marks[marks.length - 1]!.offsetMs)}`)
  }

  /**
   * **누적 adb 위반 횟수.** 포인터에 이미 쌓여 있는데 보여주지 않아 왔다 — 거짓말은 아니지만,
   * 세션이 이미 오염된 것을 `stop` 뒤 `result.json` 을 열어야 아는 것은 그때까지의 조작을
   * 통째로 버리게 만든다. 지금 알면 지금 다시 시작할 수 있다.
   *
   * 0 은 감춘다: "0 회 위반" 은 정상이고, 정상을 매번 보고하면 진짜 신호가 묻힌다.
   */
  if (violations > 0) {
    lines.push(
      '',
      `⚠ 측정 창 안에서 adb 호출이 ${violations}번 차단됐습니다. 이 세션의 데이터는 오염됐습니다.`,
      `  차단됐으므로 기기에 나가지는 않았지만, 무언가가 측정 중에 기기를 만지려 했습니다.`,
      `  다시 재려면 perftracker stop 후 start 하세요.`,
    )
  }

  if (status.durationExceeded) {
    lines.push(
      '',
      `설정된 최대 측정 시간(${formatElapsed(session.configuredDurationMs)})을 넘었습니다. ` +
        `트레이스 버퍼가 넘쳤을 수 있으며, 실제 여부는 stop 후 result.json 에 기록됩니다.`,
    )
  }

  return lines.join('\n')
}
