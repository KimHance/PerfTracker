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
import { COMPILE_CLI_COPY as COPY, fillCopy } from '../copy/compile.js'
import { unexpectedErrorText } from '../unexpected.js'

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
    before: s.baseStatusBefore ?? COPY.unknownWord,
    after: s.baseStatusAfter ?? COPY.unknownWord,
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

/** 셸이 글자 그대로 받는 글자 — 이 밖의 글자가 있으면 작은따옴표로 감싼다 (zsh 글롭 `[` · `]` 등). */
const SHELL_SAFE = /^[A-Za-z0-9._:@%+,/-]+$/

/**
 * 호스트 셸(sh · bash · zsh)에서 **한 인자로 글자 그대로** 가는 꼴. 보통 serial(USB · `emulator-5554` ·
 * `ip:port` · mDNS 이름)은 그대로 두고 — 디자인 꼴 그대로 — IPv6 `[fe80::1]:5555` 처럼 셸이 해석하는 글자가
 * 있을 때만 작은따옴표로 감싼다 (검수 왕복 1 #1 — zsh 가 `no matches found` 로 멈췄다).
 */
export function shellWord(s: string): string {
  return SHELL_SAFE.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * 되돌림 줄 (BP-5) — **호스트에서 그대로 쳐서 도는** `adb -s <serial> shell cmd package compile …` 꼴.
 * 대상 앱만이고 (결정 9) 자동으로 실행하지 않는다 (결정 4). 명령 줄은 두 칸 들여 · 앞에 라벨 없음 —
 * 줄째 복사해도 돈다. 80칸 규칙 밖이고 자르지 않는다 (결정 13). `{pkg}` 는 안드로이드 패키지 이름 글자라
 * 인용하지 않는다 · `{status}` 는 `REVERT_MODES` 셋뿐이다.
 *
 * base 줄과 보조 dex 는 **따로** 본다 — 한쪽을 되돌릴 수 없어도 다른 쪽 명령은 낸다. 되돌릴 수 없는 쪽은
 * **침묵하지 않고 그 사실 한 줄** (plan B34 #5 · 규칙 3 — 숨기면 사람은 다 되돌렸다고 믿는다):
 * - base 줄 `status` 를 모르면 · `-m` 이 받지 않는 값이면 명령 대신 그 사실 한 줄 (머리 밖).
 * - 보조 dex 가 있고 `status` 가 모두 같으면: `-m` 이 받는 값이면 `--secondary-dex` 명령 · 아니면 그 사실 한 줄.
 *   서로 다르면 그 사실 한 줄. 명령이 하나라도 있으면 보조 dex 사실 줄은 머리 아래 두 칸 들여 (디자인 블록 2).
 */
export function revertLines(before: readonly DexoptLine[] | null | undefined, serial: string, pkg: string): string[] {
  const host = shellWord(serial)
  /** 명령 대신 낸 base 사실 — 머리 밖. */
  const facts: string[] = []
  /** 머리 아래 두 칸 들여 놓는 것 — 명령과 보조 dex 사실. */
  const block: string[] = []
  let commands = 0

  const base = baseDexLine(before)
  if (base === null) facts.push(COPY.revertUnknown)
  else if (!isRevertMode(base.status)) facts.push(fillCopy(COPY.revertOutside, { status: base.status }))
  else {
    block.push(fillCopy(COPY.revertBase, { serial: host, status: base.status, pkg }))
    commands++
  }

  const secondary = (before ?? []).filter((l) => l.secondary_dex)
  const statuses = [...new Set(secondary.map((l) => l.status))]
  const n = new Set(secondary.map((l) => l.path)).size
  if (statuses.length > 1) {
    block.push(fillCopy(COPY.secondaryMixed, { n }))
  } else if (statuses.length === 1) {
    const status = statuses[0]!
    if (isRevertMode(status)) {
      block.push(fillCopy(COPY.revertSecondary, { serial: host, status, pkg }))
      commands++
    } else {
      block.push(fillCopy(COPY.secondaryOutside, { n, status }))
    }
  }

  // 명령이 없으면 머리(「실행 뒤 …」)를 낼 까닭이 없다 — 사실 줄만 머리 밖에.
  if (commands === 0) return [...facts, ...block]
  return [...facts, COPY.revertHead, ...block.map((l) => `  ${l}`)]
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
        : unexpectedErrorText(e.cause)
    value = e.compile.value
    before = e.compile.compile_state_before
  } else {
    return null
  }

  const state = fillCopy(COPY.failState, { value, before: baseDexLine(before)?.status ?? COPY.unknownWord })
  return new PerfTrackerError(
    e.code,
    [head, state, '', ...revertLines(before, serial, app.package)].join('\n'),
  )
}
