import {
  type ActiveSession,
  beginStart,
  checkCompileOption,
  type DexoptLine,
  resolveTargetApp,
  startSession,
  type StartOptions,
  type TargetApp,
  summarizeCompile,
} from '@perftracker/core'
import type { CliContext } from '../context.js'
import { DIAGNOSE_CLI_COPY } from '../copy/diagnose.js'
import { compileFailure, compileLine, readStateAfter, revertLines } from './compile.js'

/** `start` 가 commander 에게서 받는 옵션. `diagnose` 는 기본값이 없다 — 안 주면 `undefined`. */
export interface StartCliOptions {
  app?: string
  name?: string
  launch: boolean
  out: string
  force: boolean
  diagnose?: boolean
  /** `--compile <값>` — 기본값이 없다. 안 주면 `undefined` 이고 기기 상태를 바꾸지 않는다 (BP-4). */
  compile?: string
}

/**
 * 앱 해석과 세션 시작은 core 가 한다 (resolveTargetApp / startSession).
 * 여기 남은 것은 옵션을 넘기고 결과를 사람이 읽는 문장으로 바꾸는 일이다.
 */
export async function runStart(ctx: CliContext, opts: StartCliOptions): Promise<string> {
  // `--compile` 거부는 **기기 명령 0** 이어야 한다 (BP-4 · 결정 8) — 옛 세션 정리(`--force`)와 앱 해석이
  // 둘 다 기기 접촉이라 그보다 먼저. 판정은 core 의 것을 그대로 부른다 (startSession 도 스스로 다시 본다).
  checkCompileOption({ launch: opts.launch, compile: opts.compile })

  // 앱 해석은 기기 접촉이다. 활성 세션이 있으면 측정 창이 열려 있으므로, 여기서 먼저 걸러야
  // 사용자가 MeasurementWindowViolationError 대신 "이미 세션이 있습니다" 를 본다.
  await beginStart(ctx, { force: opts.force })

  const app = await resolveTargetApp(ctx, opts.app)
  let session: ActiveSession
  try {
    session = await startSession(ctx, app, startSessionOptions(opts, new Date()))
  } catch (e) {
    // compile 이 낀 실패면 기기 상태가 바뀌었을 수 있다 — 되돌림 줄을 붙여 던진다 (BP-5 · plan B32).
    throw compileFailure(e, app, ctx.serial) ?? e
  }
  const after = session.compile === undefined ? null : await readStateAfter(session.runDir)
  return formatStart(session, app, after)
}

/**
 * commander 옵션 → core 의 `StartOptions`.
 *
 * **`diagnose` 는 켰을 때만 싣는다** (DM-1). 안 주면 core 로 가는 객체가 이 옵션이 없던 때와
 * 키까지 같다 — 평소 세션의 config 가 글자 하나 다르지 않다는 보증은 core 가 지키지만,
 * 그 입구에서 `diagnose: false` 같은 새 키를 만들 이유도 없다.
 */
export function startSessionOptions(opts: StartCliOptions, now: Date): StartOptions {
  return {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    launch: opts.launch,
    outDir: opts.out,
    force: opts.force,
    now,
    ...(opts.diagnose === true ? { diagnose: true } : {}),
    // 같은 이유로 `--compile` 도 줬을 때만 (BP-4 — 없는 세션은 core 옵션 객체가 이 기능 전과 같다).
    ...(opts.compile !== undefined ? { compile: opts.compile } : {}),
  }
}

/**
 * `start` 가 남기는 문장. 기기를 모르는 순수 함수라 시험이 그대로 부른다.
 *
 * `after` 는 `--compile` 세션의 바꾼 뒤 상태(`capture.json` 의 시작 상태) — 그 세션이 아니면 안 쓴다.
 */
export function formatStart(session: ActiveSession, app: TargetApp, after: readonly DexoptLine[] | null = null): string {
  // 진단 세션이면 무엇을 켰는지 라벨 줄 하나 (DM-11). 평소 세션에는 줄이 없다.
  const diagnose = session.options.diagnose === true ? `\n${DIAGNOSE_CLI_COPY.labelLine}` : ''

  // `--compile` 세션이면 바꾼 값 · 전 → 후 줄과 되돌림 줄 (BP-5 · BP-6). 아닌 세션에는 둘 다 없다.
  const compile = session.compile
  const compileRow = compile === undefined ? '' : `\n${compileLine(summarizeCompile(compile, after))}`
  const revert =
    compile === undefined
      ? ''
      : `\n\n${revertLines(compile.compile_state_before, session.serial, session.packageName).join('\n')}`

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

  // 진단 세션의 앱 slice 가 열리는지 모르는 기기 · 앱이면 그 고지 (DM-10). 같은 이유로 시작 때
  // 말한다 — 세션은 열리고 프레임워크 slice 는 실린다. 문구와 판정의 주인은 core 다.
  const sliceNotice = session.diagnose?.notice ?? null
  const appSliceNotice = sliceNotice === null ? '' : `\n\n${sliceNotice}`

  return (
    `측정을 시작했습니다.\n` +
    `Session   ${session.name}  (${session.id})\n` +
    `App       ${app.label}  ${app.package}\n` +
    `Run dir   ${session.runDir}${diagnose}${compileRow}${startup}${notice}${appSliceNotice}${revert}\n\n` +
    `기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.\n` +
    `측정 중에는 기기에 어떤 명령도 보내지 않습니다.`
  )
}
