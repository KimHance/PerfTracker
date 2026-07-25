import { beginStart, resolveTargetApp, startSession } from '@perftracker/core'
import type { CliContext } from '../context.js'

/**
 * 앱 해석과 세션 시작은 core 가 한다 (resolveTargetApp / startSession).
 * 여기 남은 것은 옵션을 넘기고 결과를 사람이 읽는 문장으로 바꾸는 일이다.
 */
export async function runStart(
  ctx: CliContext,
  opts: { app?: string; name?: string; launch: boolean; video: boolean; out: string; force: boolean },
): Promise<string> {
  // 앱 해석은 기기 접촉이다. 활성 세션이 있으면 측정 창이 열려 있으므로, 여기서 먼저 걸러야
  // 사용자가 MeasurementWindowViolationError 대신 "이미 세션이 있습니다" 를 본다.
  await beginStart(ctx, { force: opts.force })

  const app = await resolveTargetApp(ctx, opts.app)
  const now = new Date()

  const session = await startSession(ctx, app, {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    launch: opts.launch,
    video: opts.video,
    outDir: opts.out,
    force: opts.force,
    now,
  })

  const startup =
    session.startup !== null && session.startup.totalTimeMs !== null
      ? `\nStartup   TotalTime ${session.startup.totalTimeMs}ms · ${session.startup.launchState ?? '-'}`
      : ''

  return (
    `측정을 시작했습니다.\n` +
    `Session   ${session.name}  (${session.id})\n` +
    `App       ${app.label}  ${app.package}\n` +
    `Run dir   ${session.runDir}${startup}\n\n` +
    `기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.\n` +
    `측정 중에는 기기에 어떤 명령도 보내지 않습니다.`
  )
}
