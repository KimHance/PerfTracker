import { CLI_VERSION } from '../version.js'
import { dirname, resolve } from 'node:path'
import { extractRun, readActiveSession, SessionStateError, stopSession } from '@perftracker/core'
import type { CliContext } from '../context.js'
import { revertLines } from './compile.js'
import { writeStandaloneReport } from './report.js'

export async function runStop(
  ctx: CliContext,
  opts: { offline: boolean; report?: boolean; browser?: boolean },
): Promise<string> {
  const session = await readActiveSession(ctx.serial)
  if (session === null) {
    throw new SessionStateError(`기기 ${ctx.serial} 에 실행 중인 세션이 없습니다.`)
  }

  const { runDir, state } = await stopSession(ctx, session, new Date())

  // 여기까지 왔으면 원본은 이미 안전하다. extract 가 실패해도(trace_processor 미확보 등)
  // 사용자가 나중에 다시 돌릴 수 있도록 run 디렉토리를 반드시 알려준다.
  try {
    await extractRun(runDir, { offline: opts.offline, toolVersion: CLI_VERSION })
  } catch (e) {
    throw new SessionStateError(
      `원본은 회수했지만 result.json 산출에 실패했습니다.\n` +
        `  run 디렉토리  ${runDir}\n` +
        `perftracker extract ${runDir} 로 언제든 다시 산출할 수 있습니다.\n\n` +
        `원인: ${(e as Error).message}`,
    )
  }

  let reportPath: string | null = null
  if (opts.report === true) {
    try {
      reportPath = await writeStandaloneReport(runDir, `${session.name} · PerfTracker`, {
        browser: opts.browser !== false,
      })
    } catch (e) {
      // **보고서 실패가 측정 결과를 가리지 않게 한다.** 여기까지 왔으면 재는 일도 산출도
      // 이미 끝났고, 그 경로를 잃으면 방금 잰 것을 사람이 손으로 찾아야 한다.
      throw new SessionStateError(
        `result.json 은 산출됐지만 보고서 생성에 실패했습니다.\n` +
          `  ${runDir}/result.json\n` +
          `${reportCommand(session.id, runDir)} 로 다시 시도할 수 있습니다.\n\n` +
          `원인: ${(e as Error).message}`,
      )
    }
  }

  // `--compile` 세션이면 되돌림 줄 (BP-5 · plan B9) — 바꾸기 전 상태는 세션 기록에 있다. 기기 명령은 그대로.
  const revert =
    session.compile === undefined
      ? undefined
      : revertLines(session.compile.compile_state_before, session.serial, session.packageName)
  return formatStopResult({ runDir, id: session.id, state, reportPath, ...(revert ? { revert } : {}) })
}

/**
 * `stop` 이 마지막에 내는 문장.
 *
 * **값 요약은 여전히 없다** — 어느 지표를 앞에 둘지, 무엇을 굵게 쓸지 자체가 이미 판단이고
 * 산출물은 `result.json` 하나다. 다만 *다음에 무엇을 열면 되는가* 는 판단이 아니라 안내다.
 * 그 한 줄이 없던 동안 사람은 `report` 라는 명령이 있다는 것도, 자기 기록의 id 가 무엇인지도
 * 스스로 찾아야 했다 — 도구가 방금 만든 것을 도구가 안 알려준 셈이다.
 */
export function formatStopResult(input: {
  runDir: string
  id: string
  state: 'completed' | 'aborted'
  /** `--report` 로 이미 만든 보고서. 없으면 그 자리에 **만드는 법**이 온다. */
  reportPath: string | null
  /** `--compile` 세션의 되돌림 줄 (BP-5). 없으면 출력이 이 기능 전과 같다. */
  revert?: readonly string[]
}): string {
  const lines = input.state === 'aborted' ? ['세션이 중단된 상태로 종료되었습니다.'] : []
  lines.push(`→ ${input.runDir}/result.json`)
  lines.push(
    input.reportPath === null
      ? `  ${reportCommand(input.id, input.runDir)} 로 보고서를 엽니다`
      : `→ ${input.reportPath}`,
  )
  // 요약이 아니라 다음에 칠 명령이다 — 값을 찍지 않는다는 규칙 밖 (기능 문서 baseline-profile `### 안 바뀔 것`).
  if (input.revert !== undefined) lines.push('', ...input.revert)
  return lines.join('\n')
}

/**
 * 안내할 명령 한 줄. **`-o` 를 언제 붙일지가 요점이다.**
 *
 * `report` 의 `-o` 기본값은 `runs` 라, `start -o <다른 곳>` 으로 잰 기록을 그냥
 * `perftracker report <id>` 로 안내하면 그대로 쳤을 때 "기록을 찾지 못했습니다" 가 난다.
 * **안내한 명령이 실패하는 것은 안내가 없는 것보다 나쁘다** — 사람은 도구가 아니라 자기
 * 기록을 의심하게 된다.
 */
function reportCommand(id: string, runDir: string): string {
  const out = dirname(runDir)
  return `perftracker report ${id}${out === resolve('runs') ? '' : ` -o ${out}`}`
}
