import { extractRun, readActiveSession, SessionStateError, stopSession } from '@perftracker/core'
import type { CliContext } from '../context.js'

export async function runStop(ctx: CliContext, opts: { offline: boolean }): Promise<string> {
  const session = await readActiveSession(ctx.serial)
  if (session === null) {
    throw new SessionStateError(`기기 ${ctx.serial} 에 실행 중인 세션이 없습니다.`)
  }

  const { runDir, state } = await stopSession(ctx, session, new Date())

  // 여기까지 왔으면 원본은 이미 안전하다. extract 가 실패해도(trace_processor 미확보 등)
  // 사용자가 나중에 다시 돌릴 수 있도록 run 디렉토리를 반드시 알려준다.
  try {
    await extractRun(runDir, { offline: opts.offline })
  } catch (e) {
    throw new SessionStateError(
      `원본은 회수했지만 result.json 산출에 실패했습니다.\n` +
        `  run 디렉토리  ${runDir}\n` +
        `perftracker extract ${runDir} 로 언제든 다시 산출할 수 있습니다.\n\n` +
        `원인: ${(e as Error).message}`,
    )
  }

  // 값을 터미널에 요약하지 않는다 — 이 도구의 산출물은 result.json 하나이고, 무엇이 중요한지
  // 고르는 일(어느 지표를 앞에 둘지, 어떤 기준선과 비교할지)은 그것을 읽는 쪽의 몫이다.
  // 사람에게 남기는 것은 다음에 무엇을 열어야 하는가 하나뿐이다.
  const header = state === 'aborted' ? '세션이 중단된 상태로 종료되었습니다.\n' : ''
  return `${header}→ ${runDir}/result.json`
}
