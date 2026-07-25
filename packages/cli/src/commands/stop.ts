import { extractRun, readActiveSession, type Result, SessionStateError, stopSession } from '@perftracker/core'
import type { CliContext } from '../context.js'
import { formatSummary } from '../format/summary.js'

export async function runStop(ctx: CliContext, opts: { offline: boolean }): Promise<string> {
  const session = await readActiveSession(ctx.serial)
  if (session === null) {
    throw new SessionStateError(`기기 ${ctx.serial} 에 실행 중인 세션이 없습니다.`)
  }

  const { runDir, state } = await stopSession(ctx, session, new Date())

  // 여기까지 왔으면 원본은 이미 안전하다. extract 가 실패해도(trace_processor 미확보 등)
  // 사용자가 나중에 다시 돌릴 수 있도록 run 디렉토리를 반드시 알려준다.
  let result: Result
  try {
    result = await extractRun(runDir, { offline: opts.offline })
  } catch (e) {
    throw new SessionStateError(
      `원본은 회수했지만 result.json 산출에 실패했습니다.\n` +
        `  run 디렉토리  ${runDir}\n` +
        `perftracker extract ${runDir} 로 언제든 다시 산출할 수 있습니다.\n\n` +
        `원인: ${(e as Error).message}`,
    )
  }

  const header = state === 'aborted' ? '세션이 중단된 상태로 종료되었습니다.\n\n' : ''
  return `${header}${formatSummary(result)}\n\n→ ${runDir}/result.json`
}
