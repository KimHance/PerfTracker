import {
  baseDexLine,
  CompileAppliedError,
  CompileFailedError,
  type CompileSummary,
  type DexoptLine,
  PerfTrackerError,
  readCaptureManifest,
  type TargetApp,
} from '@perftracker/core'
import { COMPILE_CLI_COPY as COPY, fillCopy, UNKNOWN_WORD } from '../copy/compile.js'

/**
 * `start --compile` 세션의 cli 표시 (기능 문서 baseline-profile BP-5 · BP-6). `start` · `stop` · `status` 가
 * 나눠 쓰므로 명령 파일이 아니라 여기 둔다 (`browser.ts` 와 같은 예외). 기기를 모른다 — 재료는 core 가
 * 세션에 실은 바꾼 기록(`session.compile`)과 호스트의 `capture.json` 뿐이다. 바꾸기 전 → 뒤 요약은 core 의
 * `summarizeCompile` 하나 — `runs --json` 과 같은 값이 된다.
 *
 * **판정하지 않는다.** 바꾸기 전 → 뒤 `status` 를 원문 그대로 옮기고, 어느 쪽이 낫다고 하지 않는다.
 */

/**
 * `cmd package compile -m` 이 받는 값 — sdk 36 기기 도움말 실측 (BP-5). 되돌림 명령은 이 셋으로만 만든다.
 * `--compile` 이 받는 값(`COMPILE_VALUES` — `reset` 이 있고 `verify` 가 없다)과 다른 목록이다.
 */
export const REVERT_MODES = ['speed', 'speed-profile', 'verify'] as const

const isRevertMode = (s: string): boolean => (REVERT_MODES as readonly string[]).includes(s)

/** `Compile   speed · base.apk speed-profile → speed · 67,500 ms` — 80칸 안. */
export function compileLine(s: CompileSummary): string {
  return fillCopy(COPY.compileLine, {
    value: s.value,
    before: s.baseStatusBefore ?? UNKNOWN_WORD,
    after: s.baseStatusAfter ?? UNKNOWN_WORD,
    ms: s.elapsedMs.toLocaleString('en-US'),
  })
}

/**
 * 바꾼 뒤 상태 — `capture.json` 의 `target_app.compile_state_start` (core 가 compile 바로 뒤 다시 읽은
 * `dumpsys package` · BP-4). 호스트 파일이라 기기를 건드리지 않는다. 못 읽으면 null(→ `모름`).
 */
export async function readStateAfter(runDir: string): Promise<DexoptLine[] | null> {
  try {
    return (await readCaptureManifest(runDir)).target_app.compile_state_start ?? null
  } catch {
    return null
  }
}

/**
 * 되돌림 줄 (BP-5) — **호스트에서 그대로 쳐서 도는** `adb -s <serial> shell cmd package compile …` 꼴.
 * 대상 앱만이고 (결정 9) 자동으로 실행하지 않는다 (결정 4). 명령 줄은 두 칸 들여 · 앞에 라벨 없음 —
 * 줄째 복사해도 돈다. 80칸 규칙 밖이고 자르지 않는다 (결정 13).
 *
 * - 바꾸기 전 base 줄 `status` 를 모르면 · `-m` 이 받지 않는 값이면 명령 대신 그 사실 한 줄.
 * - 보조 dex 가 있고 `status` 가 모두 같고 `-m` 이 받는 값이면 `--secondary-dex` 한 줄 더 · 서로 다르면 그 사실 한 줄.
 */
export function revertLines(before: readonly DexoptLine[] | null | undefined, serial: string, pkg: string): string[] {
  const base = baseDexLine(before)
  if (base === null) return [COPY.revertUnknown]
  if (!isRevertMode(base.status)) return [fillCopy(COPY.revertOutside, { status: base.status })]

  const lines = [COPY.revertHead, `  ${fillCopy(COPY.revertBase, { serial, status: base.status, pkg })}`]

  const secondary = (before ?? []).filter((l) => l.secondary_dex)
  const statuses = new Set(secondary.map((l) => l.status))
  if (statuses.size > 1) {
    lines.push(`  ${fillCopy(COPY.secondaryMixed, { n: new Set(secondary.map((l) => l.path)).size })}`)
  } else if (statuses.size === 1) {
    const status = [...statuses][0]!
    if (isRevertMode(status)) lines.push(`  ${fillCopy(COPY.revertSecondary, { serial, status, pkg })}`)
  }
  return lines
}

/**
 * compile 이 낀 실패 두 종류를 되돌림 줄이 붙은 오류로 바꾼다 (BP-5). 그 밖의 오류면 null — 그대로 던진다.
 *
 * - `CompileFailedError` — 상태 바꾸기 자체가 실패. 바꾸기 전은 cli 가 쥔 `TargetApp` (대상 앱 해석의 출력).
 * - `CompileAppliedError` — 바꾸기는 됐는데 같은 `start` 의 뒤 단계가 던짐 (plan B32). 바꾸기 전은 `e.compile`.
 *
 * 둘 다 바꾼 뒤를 다시 읽지 않는다 (실패 뒤 기기 명령 0) — 상태 줄은 `지금 모름`. 같은 code 의 PerfTrackerError
 * 로 내서 진입점이 message 를 stderr 로 찍고 종료 코드 1 로 끝난다. 원래 오류가 PerfTrackerError 가 아니면
 * 진입점이 찍던 것(예상 못 한 오류 머리 + 스택)을 그대로 앞에 둔다.
 */
export function compileFailure(e: unknown, app: TargetApp, serial: string): PerfTrackerError | null {
  let head: string
  let value: string
  let before: readonly DexoptLine[] | null | undefined
  if (e instanceof CompileFailedError) {
    head = e.message
    value = e.value
    before = app.compile_state_start
  } else if (e instanceof CompileAppliedError) {
    head =
      e.cause instanceof PerfTrackerError
        ? e.message
        : '예상치 못한 오류가 발생했습니다. 아래 내용과 함께 이슈로 알려주세요.\n' +
          (e.cause instanceof Error ? (e.cause.stack ?? e.cause.message) : String(e.cause))
    value = e.compile.value
    before = e.compile.compile_state_before
  } else {
    return null
  }

  const state = fillCopy(COPY.failState, { value, before: baseDexLine(before)?.status ?? UNKNOWN_WORD })
  return new PerfTrackerError(
    e.code,
    [head, state, '', ...revertLines(before, serial, app.package)].join('\n'),
  )
}
