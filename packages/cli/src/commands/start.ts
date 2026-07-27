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

  // **이 기기에서 못 재는 지표를 시작 시점에 말한다.** 예전에는 stop 뒤 result.json 을 열어야
  // 알 수 있었다 — 사람이 앱을 조작하고 나서야 "프레임이 없다" 를 아는 것은 측정을 한 번 더
  // 하게 만드는 정보이고, 시작 전에 이미 알 수 있던 사실이다.
  // 세션을 막지는 않는다: 나머지 지표는 정상적으로 수집된다.
  const unsupported = session.unsupported ?? []
  const notice =
    unsupported.length === 0
      ? ''
      : `\n\n이 기기에서 측정할 수 없는 지표 ${unsupported.length}개 — 나머지는 정상 수집됩니다:\n` +
        unsupported.map((u) => `  ✗ ${u.id.padEnd(9)}${u.reason}`).join('\n')

  return (
    `측정을 시작했습니다.\n` +
    `Session   ${session.name}  (${session.id})\n` +
    `App       ${app.label}  ${app.package}\n` +
    `Run dir   ${session.runDir}${startup}${notice}\n\n` +
    `기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.\n` +
    `측정 중에는 기기에 어떤 명령도 보내지 않습니다.`
  )
}
