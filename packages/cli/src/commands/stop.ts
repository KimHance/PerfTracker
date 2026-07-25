import { extractRun, readActiveSession, SessionStateError, stopSession } from '@perftracker/core'
import type { CliContext } from '../context.js'
import { formatSummary } from '../format/summary.js'

export async function runStop(ctx: CliContext, opts: { offline: boolean }): Promise<string> {
  const session = await readActiveSession(ctx.serial)
  if (session === null) {
    throw new SessionStateError(`기기 ${ctx.serial} 에 실행 중인 세션이 없습니다.`)
  }

  const { runDir, state } = await stopSession(ctx, session, new Date())
  const result = await extractRun(runDir, { offline: opts.offline })

  const header = state === 'aborted' ? '세션이 중단된 상태로 종료되었습니다.\n\n' : ''
  return `${header}${formatSummary(result)}\n\n→ ${runDir}/result.json`
}
