import {
  type ActiveSession,
  type CompileSummary,
  computeStatus,
  formatElapsed,
  listActiveSessions,
  readActiveSession,
  sortedMarks,
  summarizeCompile,
} from '@perftracker/core'
import { DIAGNOSE_CLI_COPY } from '../copy/diagnose.js'
import { compileLine, readStateAfter } from './compile.js'

/**
 * serial 을 명시하면 그 기기만 본다. 생략하면 활성 세션 포인터를 열거해서:
 *   - 0개면 "없다"
 *   - 정확히 1개면 그 세션
 *   - 2개 이상이면 -d 로 지정하라고 안내 (모든 serial 을 이름과 함께 보여준다)
 * 어느 경로도 adb 를 부르지 않는다 — 기기에 접촉하지 않는다 (규칙 1).
 */
/**
 * 어느 세션을 볼 것인가. **텍스트와 `--json` 이 같은 규칙을 쓰도록** 여기 한 번만 적는다 —
 * 두 곳에 적으면 사람이 보는 답과 기계가 받는 답이 갈리는 날이 온다.
 */
async function pick(
  serial?: string,
  home?: string,
): Promise<{ session: ActiveSession | null; ambiguous: ActiveSession[] }> {
  if (serial !== undefined) return { session: await readActiveSession(serial, home), ambiguous: [] }

  const active = await listActiveSessions(home)
  if (active.length > 1) return { session: null, ambiguous: active }
  return { session: active[0] ?? null, ambiguous: [] }
}

/**
 * `--compile` 세션의 표시 (BP-6) — 텍스트 `Compile` 줄과 `--json` 의 `compile` 키가 같은 값에서 나온다.
 * 바꾼 뒤 상태는 호스트의 `capture.json` 에서 읽는다 — 기기를 건드리지 않는다. 그 세션이 아니면 null.
 */
async function compileOf(session: ActiveSession): Promise<CompileSummary | null> {
  if (session.compile === undefined) return null
  return summarizeCompile(session.compile, await readStateAfter(session.runDir))
}

/**
 * `--json` 이 내는 모양. 세션이 없으면 `session: null` 이다 — 빈 객체가 아니다.
 * `compile` 은 `--compile` 세션에만 있다 (BP-6) — 평소 세션 JSON 은 이 기능 전과 키까지 같다.
 */
export async function statusData(
  serial?: string,
  home?: string,
): Promise<{
  session: ActiveSession | null
  elapsedMs: number | null
  durationExceeded: boolean | null
  marks: { offsetMs: number; label: string }[]
  adbCommandsDuringSession: number
  ambiguous: { serial: string; id: string; name: string }[]
  compile?: CompileSummary
}> {
  const { session, ambiguous } = await pick(serial, home)
  if (session === null) {
    return {
      session: null,
      elapsedMs: null,
      durationExceeded: null,
      marks: [],
      adbCommandsDuringSession: 0,
      ambiguous: ambiguous.map((s) => ({ serial: s.serial, id: s.id, name: s.name })),
    }
  }
  const status = computeStatus(session, new Date())
  const compile = await compileOf(session)
  return {
    session,
    elapsedMs: status.elapsedMs,
    durationExceeded: status.durationExceeded,
    marks: sortedMarks(session),
    adbCommandsDuringSession: session.adbCommandsDuringSession ?? 0,
    ambiguous: [],
    ...(compile !== null ? { compile } : {}),
  }
}

export async function runStatus(serial?: string, home?: string): Promise<string> {
  const { session, ambiguous } = await pick(serial, home)
  if (ambiguous.length > 0) {
    return [
      '실행 중인 세션이 여러 기기에 있습니다:',
      ...ambiguous.map((s) => `  ${s.serial}  ${s.name} (${s.id})`),
      '',
      '-d <serial> 로 대상 기기를 지정하세요.',
    ].join('\n')
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

  // 진단 세션이면 무엇을 켰는지 — start 가 찍은 줄과 같다 (DM-11). 평소 세션에는 줄이 없다.
  if (session.options.diagnose === true) lines.push(DIAGNOSE_CLI_COPY.labelLine)

  // `--compile` 세션이면 start 가 찍은 컴파일 줄과 같은 줄 (BP-6). 평소 세션에는 줄이 없다.
  const compile = await compileOf(session)
  if (compile !== null) lines.push(compileLine(compile))

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
