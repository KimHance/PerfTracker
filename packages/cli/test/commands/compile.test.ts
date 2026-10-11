import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActiveSession, DexoptLine, SessionCompile, TargetApp } from '@perftracker/core'
import {
  CompileAppliedError,
  CompileFailedError,
  PerfTrackerError,
  SessionStateError,
  writeActiveSession,
} from '@perftracker/core'
import { describe, expect, it, vi } from 'vitest'
import { compileFailure, REVERT_MODES, revertLines } from '../../src/commands/compile.js'
import { UNEXPECTED_ERROR_HEAD } from '../../src/unexpected.js'
import { displayWidth } from '../../src/commands/runs.js'
import { formatStart, runStart, startSessionOptions } from '../../src/commands/start.js'
import { runStatus, statusData } from '../../src/commands/status.js'
import { formatStopResult } from '../../src/commands/stop.js'
import { COMPILE_CLI_COPY } from '../../src/copy/compile.js'
import { buildProgram } from '../../src/program.js'

/**
 * `start --compile` 의 cli 몫 (기능 문서 baseline-profile BP-4 CLI 쪽 · BP-5 · BP-6). 기기를 바꾸는 일 ·
 * 그 명령 목록은 core 시험(`BP-4 …` — `packages/core/test/session/start.test.ts`)이 고정한다. 여기는 입구의
 * 거부와 사람이 읽는 줄 — 되돌림 줄 · 컴파일 줄 — 을 본다.
 */

const SERIAL = 'R5CT0000001'
const PKG = 'com.google.android.youtube'
const BASE = '/data/app/~~x==/com.google.android.youtube-y==/base.apk'

/** 합성 dex 줄 — 실기기 SM-S901N YouTube 의 꼴 (base.apk 하나 · 보조 dex 셋). */
function line(path: string, status: string, over: Partial<DexoptLine> = {}): DexoptLine {
  return {
    path,
    secondary_dex: false,
    public_dex: false,
    abi: 'arm64',
    status,
    reason: 'profile-utilization',
    location: null,
    primary_abi: true,
    ...over,
  } as DexoptLine
}
const secondary = (n: number, status: string): DexoptLine =>
  line(`/data/user/0/${PKG}/files/${n}/pcam.jar`, status, { secondary_dex: true, reason: 'vdex' })

/** 바꾸기 전 — base `speed-profile` · 보조 dex 셋 `verify` (실측). */
const BEFORE: DexoptLine[] = [line(BASE, 'speed-profile'), secondary(1, 'verify'), secondary(2, 'verify'), secondary(3, 'verify')]
/** 바꾼 뒤 (`--compile speed`). */
const AFTER: DexoptLine[] = [line(BASE, 'speed', { reason: 'cmdline' }), secondary(1, 'verify')]

const BASE_REVERT = `  adb -s ${SERIAL} shell cmd package compile -m speed-profile -f ${PKG}`
const SECONDARY_REVERT = `  adb -s ${SERIAL} shell cmd package compile -m verify -f --secondary-dex ${PKG}`

const APP: TargetApp = {
  package: PKG,
  label: 'YouTube',
  label_source: 'apk_resources',
  version_name: '21.40.161',
  version_code: 1,
  uid: 10234,
  install_source: 'com.android.vending',
  launcher_activity: 'com.google.android.youtube.app.honeycomb.Shell$HomeActivity',
  pid: null,
  compile_state_start: BEFORE,
  compile_state_start_reason_code: null,
  compile_state_start_reason: null,
} as TargetApp

const COMPILE: SessionCompile = {
  value: 'speed',
  command: `cmd package compile -m speed -f '${PKG}'`,
  elapsed_ms: 67_500,
  compile_state_before: BEFORE,
  compile_state_before_reason_code: null,
  compile_state_before_reason: null,
} as SessionCompile

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    version: 1,
    id: 'a1b2c3',
    name: 'youtube-speed',
    serial: SERIAL,
    packageName: PKG,
    runDir: '/runs/2026-10-11_164012_youtube-speed',
    perfettoKey: 'perftracker_a1b2c3',
    remoteTracePath: '/data/misc/perfetto-traces/perftracker_a1b2c3.pftrace',
    startedAt: '2026-10-11T07:40:12.000Z',
    configuredDurationMs: 1_800_000,
    options: { launch: true },
    startup: { totalTimeMs: 844, launchState: 'COLD', status: 'ok', waitTimeMs: 850 },
    ...overrides,
  }
}

/** 어떤 속성을 건드려도 세는 adb — 기기 명령 0 을 "부르지 않았다" 로 확인한다. */
function countingCtx(): { ctx: Parameters<typeof runStart>[0]; touched: string[] } {
  const touched: string[] = []
  const adb = new Proxy(
    {},
    {
      get(_t, prop) {
        touched.push(String(prop))
        throw new Error(`기기에 닿음: ${String(prop)}`)
      },
    },
  )
  return { ctx: { adb, serial: SERIAL } as unknown as Parameters<typeof runStart>[0], touched }
}

function startCommand() {
  const start = buildProgram().commands.find((c) => c.name() === 'start')
  if (start === undefined) throw new Error('start 명령이 없다')
  return start
}

// ─── BP-4 CLI 쪽 ───

describe('BP-4 start --compile (CLI)', () => {
  it('BP-4 --compile 옵션 — 등록돼 있고 기본값이 없다 · 도움말은 문구 표 그대로', () => {
    const option = startCommand().options.find((o) => o.long === '--compile')
    expect(option, '--compile 이 start 에 등록되지 않았다').toBeDefined()
    expect(option!.defaultValue).toBeUndefined()
    expect(option!.required).toBe(true) // 값을 받는 옵션 (`<값>`)
    expect(option!.description).toBe(COMPILE_CLI_COPY.helpCompile)
  })

  it('BP-4 --compile 옵션 — 주면 core 에 그 값이 가고, 안 주면 키가 없다', () => {
    const now = new Date('2026-10-11T07:40:12.000Z')
    const withIt = startCommand()
    withIt.parseOptions(['--app', PKG, '--launch', '--compile', 'speed'])
    expect(startSessionOptions(withIt.opts() as Parameters<typeof startSessionOptions>[0], now).compile).toBe('speed')

    const without = startCommand()
    without.parseOptions(['--app', PKG, '--launch'])
    expect(Object.keys(startSessionOptions(without.opts() as Parameters<typeof startSessionOptions>[0], now))).not.toContain(
      'compile',
    )
  })

  it('BP-4 --launch 없으면 거부 — 기기 명령 0 (옛 세션 정리 · 앱 해석보다 먼저)', async () => {
    const { ctx, touched } = countingCtx()
    await expect(
      runStart(ctx, { app: PKG, launch: false, out: 'runs', force: true, compile: 'speed' }),
    ).rejects.toThrow(COMPILE_CLI_COPY.rejectLaunch)
    expect(touched).toEqual([])
  })

  it('BP-4 --launch 없으면 거부 — 명령 줄로 불러도 adb 를 찾기 전에 (없는 adb 경로라도 거부 문구)', async () => {
    // 순서가 뒤집히면 adb 탐색이 먼저 던진다 (AdbNotFoundError) — 없는 경로라 기기에 닿을 길이 없다.
    const run = (args: string[]) =>
      buildProgram().parseAsync(['--adb', '/nonexistent/perftracker-adb', 'start', '--app', PKG, ...args], { from: 'user' })
    await expect(run(['--compile', 'speed'])).rejects.toThrow(COMPILE_CLI_COPY.rejectLaunch)
    await expect(run(['--launch', '--compile', 'verify'])).rejects.toThrow('--compile verify · 받는 값')
    // 거부 아닌 경우는 adb 탐색으로 간다 — 이 시험이 "검사 뒤 createContext" 를 실제로 가른다는 증거.
    await expect(run(['--launch', '--compile', 'speed'])).rejects.not.toThrow(SessionStateError)
  })

  it('BP-4 허용 밖 값 거부 — 기기 명령 0 · 받는 값 셋을 말한다', async () => {
    const { ctx, touched } = countingCtx()
    const err = await runStart(ctx, { app: PKG, launch: true, out: 'runs', force: true, compile: 'verify' }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(SessionStateError)
    expect((err as Error).message).toBe('--compile verify · 받는 값 reset · speed-profile · speed · 기기 명령 0')
    expect(touched).toEqual([])
  })
})

// ─── BP-5 ───

describe('BP-5 되돌림 줄 — start · stop · 호스트 꼴', () => {
  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: 바꾸기 전 base status 로 -m · 보조 dex 가 모두 같으면 한 줄 더', () => {
    expect(revertLines(BEFORE, SERIAL, PKG)).toEqual([COMPILE_CLI_COPY.revertHead, BASE_REVERT, SECONDARY_REVERT])
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: start 출력에 컴파일 줄 다음 · 끝 안내 앞에 블록 (디자인 CLI 블록 1)', () => {
    const out = formatStart(session({ compile: COMPILE }), APP, AFTER).split('\n')
    const head = out.indexOf(COMPILE_CLI_COPY.revertHead)
    expect(head).toBeGreaterThan(0)
    expect(out[head - 1]).toBe('')
    expect(out.slice(head + 1, head + 3)).toEqual([BASE_REVERT, SECONDARY_REVERT])
    expect(out[head + 3]).toBe('')
    expect(out[head + 4]).toBe('기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.')
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: stop 출력은 경로 · 보고서 명령 뒤 빈 줄 하나 + 블록 (디자인 CLI 블록 3)', () => {
    const runDir = '/runs/2026-10-11_164012_youtube-speed'
    const out = formatStopResult({
      runDir,
      id: 'a1b2c3',
      state: 'completed',
      reportPath: null,
      revert: revertLines(BEFORE, SERIAL, PKG),
    }).split('\n')
    expect(out).toEqual([
      `→ ${runDir}/result.json`,
      `  perftracker report a1b2c3 -o /runs 로 보고서를 엽니다`,
      '',
      COMPILE_CLI_COPY.revertHead,
      BASE_REVERT,
      SECONDARY_REVERT,
    ])
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: 명령 줄은 adb -s <serial> shell cmd package compile 한 줄 (80칸 밖 · 자르지 않음)', () => {
    // check_cli.py 의 HOST 꼴 그대로 — 두 칸 들여 · 라벨 없음.
    const HOST = /^ {2}adb -s \S+ shell cmd package compile -m \S+ -f (--secondary-dex )?\S+$/
    const cmds = revertLines(BEFORE, SERIAL, PKG).slice(1)
    expect(cmds.every((c) => HOST.test(c))).toBe(true)
    expect(displayWidth(cmds[1]!)).toBeGreaterThan(80)
    // 범위 옵션(--primary-dex 등)을 붙이지 않는다 (결정 9).
    expect(cmds.join('\n')).not.toMatch(/--primary-dex|--include-dependencies|--split/)
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: 보조 dex status 가 서로 다르면 그 사실 한 줄 (디자인 CLI 블록 2)', () => {
    const mixed = [line(BASE, 'speed-profile'), secondary(1, 'verify'), secondary(2, 'run-from-apk'), secondary(3, 'run-from-apk')]
    expect(revertLines(mixed, SERIAL, PKG)).toEqual([
      COMPILE_CLI_COPY.revertHead,
      BASE_REVERT,
      '  보조 dex 3개 · status 서로 다름 · 보조 dex 되돌림 줄 없음',
    ])
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: 보조 dex 가 없으면 base 한 줄뿐', () => {
    expect(revertLines([line(BASE, 'verify')], SERIAL, PKG)).toEqual([
      COMPILE_CLI_COPY.revertHead,
      `  adb -s ${SERIAL} shell cmd package compile -m verify -f ${PKG}`,
    ])
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: ABI 줄이 여럿이면 [primary-abi] 줄의 status (결정 12)', () => {
    const multi = [line(BASE, 'verify', { abi: 'arm', primary_abi: false }), line(BASE, 'speed-profile', { abi: 'arm64' })]
    expect(revertLines(multi, SERIAL, PKG)[1]).toBe(BASE_REVERT)
  })

  it('BP-5 되돌림 줄 — start · stop · 호스트 꼴: -m 이 받는 값은 sdk 36 도움말 실측의 셋', () => {
    expect([...REVERT_MODES].sort()).toEqual(['speed', 'speed-profile', 'verify'])
  })
})

describe('BP-5 되돌릴 값 없으면 사실 한 줄', () => {
  it('BP-5 되돌릴 값 없으면 사실 한 줄 — base status 가 -m 밖 (디자인 CLI 블록 4)', () => {
    expect(revertLines([line(BASE, 'run-from-apk')], SERIAL, PKG)).toEqual([
      '되돌림 줄 없음 · 바꾸기 전 base.apk status run-from-apk · -m 이 받지 않는 값',
    ])
  })

  it('BP-5 되돌릴 값 없으면 사실 한 줄 — 바꾸기 전 상태 null (BP-2)', () => {
    expect(revertLines(null, SERIAL, PKG)).toEqual(['되돌림 줄 없음 · 바꾸기 전 base.apk status 모름'])
  })

  it('BP-5 되돌릴 값 없으면 사실 한 줄 — base 줄을 하나로 못 고르면 (primary-abi 표시 없는 ABI 줄 둘) 모름', () => {
    const ambiguous = [line(BASE, 'verify', { abi: 'arm', primary_abi: false }), line(BASE, 'speed', { primary_abi: false })]
    expect(revertLines(ambiguous, SERIAL, PKG)).toEqual([COMPILE_CLI_COPY.revertUnknown])
  })

  it('BP-5 되돌릴 값 없으면 사실 한 줄 — stop 출력에도 그 한 줄', () => {
    const out = formatStopResult({
      runDir: '/runs/x',
      id: 'a1b2c3',
      state: 'completed',
      reportPath: null,
      revert: revertLines(null, SERIAL, PKG),
    })
    expect(out.split('\n').slice(-2)).toEqual(['', COMPILE_CLI_COPY.revertUnknown])
  })
})

/**
 * 보조 dex 는 base 줄과 **따로** 본다 (plan B34 #5 · 검수 왕복 1 후속 1) — 되돌릴 수 없는 쪽이 있으면 침묵하지 않고
 * 그 사실 한 줄. 숨기면 사람은 다 되돌렸다고 믿는다.
 */
describe('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄', () => {
  const OUTSIDE = '보조 dex 3개 · status run-from-apk · -m 이 받지 않는 값 · 되돌림 줄 없음'
  const MIXED = '보조 dex 3개 · status 서로 다름 · 보조 dex 되돌림 줄 없음'
  const runFromApk = [secondary(1, 'run-from-apk'), secondary(2, 'run-from-apk'), secondary(3, 'run-from-apk')]
  const mixed = [secondary(1, 'verify'), secondary(2, 'run-from-apk'), secondary(3, 'run-from-apk')]

  it('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄 — 모두 같은데 -m 밖 · base 는 되돌림 (머리 아래 두 칸)', () => {
    expect(revertLines([line(BASE, 'speed-profile'), ...runFromApk], SERIAL, PKG)).toEqual([
      COMPILE_CLI_COPY.revertHead,
      BASE_REVERT,
      `  ${OUTSIDE}`,
    ])
  })

  it('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄 — base 가 -m 밖이어도 보조 dex 명령은 낸다', () => {
    expect(revertLines([line(BASE, 'run-from-apk'), ...BEFORE.slice(1)], SERIAL, PKG)).toEqual([
      '되돌림 줄 없음 · 바꾸기 전 base.apk status run-from-apk · -m 이 받지 않는 값',
      COMPILE_CLI_COPY.revertHead,
      SECONDARY_REVERT,
    ])
  })

  it('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄 — base 를 모르고 보조 dex 도 -m 밖 · 명령 0 이면 머리 없이 사실 둘', () => {
    const noBase = [line(BASE, 'verify', { abi: 'arm', primary_abi: false }), line(BASE, 'speed', { primary_abi: false })]
    expect(revertLines([...noBase, ...runFromApk], SERIAL, PKG)).toEqual([COMPILE_CLI_COPY.revertUnknown, OUTSIDE])
  })

  it('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄 — base 가 -m 밖 · 보조 dex 서로 다름', () => {
    expect(revertLines([line(BASE, 'run-from-apk'), ...mixed], SERIAL, PKG)).toEqual([
      '되돌림 줄 없음 · 바꾸기 전 base.apk status run-from-apk · -m 이 받지 않는 값',
      MIXED,
    ])
  })

  it('BP-5 보조 dex 를 되돌릴 수 없으면 사실 한 줄 — 보조 dex 개수는 파일 수 (ABI 줄 수 아님)', () => {
    const twoAbi = [secondary(1, 'quicken'), { ...secondary(1, 'quicken'), abi: 'arm', primary_abi: false }]
    expect(revertLines([line(BASE, 'speed-profile'), ...twoAbi], SERIAL, PKG).at(-1)).toBe(
      '  보조 dex 1개 · status quicken · -m 이 받지 않는 값 · 되돌림 줄 없음',
    )
  })
})

/**
 * 되돌림 줄은 **호스트 셸이 그대로 받아야** 한다 (BP-5 · 결정 13 · 검수 왕복 1 #1). 가짜 `adb`(인자를 NUL 로 끊어
 * 찍는 셸 스크립트)만 있는 PATH 로 실제 셸에 줄을 쳐서, serial 이 글자 그대로 한 인자로 가는지 본다 — 기기 0.
 */
describe('BP-5 되돌림 줄 — 호스트 셸이 그대로 받는다', () => {
  const fake = mkdtempSync(join(tmpdir(), 'pt-fake-adb-'))
  writeFileSync(join(fake, 'adb'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\0\' "$a"; done\n')
  chmodSync(join(fake, 'adb'), 0o755)

  function argsVia(shell: string, cmdLine: string): string[] {
    const out = execFileSync(shell, ['-c', cmdLine], { env: { PATH: `${fake}:/usr/bin:/bin` }, encoding: 'utf8' })
    return out.split('\0').slice(0, -1)
  }

  const SERIALS = [
    'R5CT0000001',
    'emulator-5554',
    '192.168.0.7:5555',
    'adb-R5CT0000001-AbCdEf._adb-tls-connect._tcp',
    '[fe80::1]:5555',
    "it's *odd? serial",
  ]
  const shells = ['/bin/sh', '/bin/zsh', '/bin/bash'].filter((sh) => existsSync(sh))

  it('BP-5 되돌림 줄 — 호스트 셸이 그대로 받는다: 시험할 셸이 있다', () => {
    expect(shells).toContain('/bin/sh')
  })

  for (const sh of shells) {
    it.each(SERIALS)(`BP-5 되돌림 줄 — 호스트 셸이 그대로 받는다: ${sh} · %s`, (serial) => {
      const [, base, sec] = revertLines(BEFORE, serial, PKG)
      expect(argsVia(sh, base!)).toEqual(['-s', serial, 'shell', 'cmd', 'package', 'compile', '-m', 'speed-profile', '-f', PKG])
      expect(argsVia(sh, sec!)).toEqual([
        '-s', serial, 'shell', 'cmd', 'package', 'compile', '-m', 'verify', '-f', '--secondary-dex', PKG,
      ])
    })
  }

  it('BP-5 되돌림 줄 — 호스트 셸이 그대로 받는다: 보통 serial 은 인용 없이 디자인 꼴 그대로', () => {
    for (const serial of SERIALS.slice(0, 4)) expect(revertLines(BEFORE, serial, PKG)[1]).toContain(`-s ${serial} shell`)
    expect(revertLines(BEFORE, '[fe80::1]:5555', PKG)[1]).toContain("-s '[fe80::1]:5555' shell")
  })
})

describe('BP-5 실패 두 종류에서도 되돌림 줄', () => {
  it('BP-5 실패 두 종류에서도 되돌림 줄 — CompileFailedError: core 머리 · 보낸 명령 + 상태 줄 지금 모름 + 되돌림 (디자인 CLI 블록 2)', () => {
    const e = new CompileFailedError('speed', `cmd package compile -m speed -f '${PKG}'`, 1, false, '', 300)
    const out = compileFailure(e, APP, SERIAL)
    expect(out).toBeInstanceOf(PerfTrackerError)
    expect(out!.code).toBe('COMPILE_FAILED')
    expect(out!.message.split('\n')).toEqual([
      '컴파일 실패 · 세션 안 엶 · exit 1',
      `보낸 명령  cmd package compile -m speed -f '${PKG}'`,
      'Compile   speed · base.apk 바꾸기 전 speed-profile · 지금 모름',
      '',
      COMPILE_CLI_COPY.revertHead,
      BASE_REVERT,
      SECONDARY_REVERT,
    ])
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — CompileFailedError 한도 · 바꾸기 전을 못 읽은 앱이면 모름 두 줄', () => {
    const e = new CompileFailedError('reset', `cmd package compile --reset '${PKG}'`, null, true, '', 600_000)
    const app = { ...APP, compile_state_start: null } as TargetApp
    expect(compileFailure(e, app, SERIAL)!.message.split('\n')).toEqual([
      '컴파일 한도 10분 넘음 · 세션 안 엶',
      `보낸 명령  cmd package compile --reset '${PKG}'`,
      'Compile   reset · base.apk 바꾸기 전 모름 · 지금 모름',
      '',
      COMPILE_CLI_COPY.revertUnknown,
    ])
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — CompileAppliedError: 원래 message · code 그대로 + 바꾸기 전은 e.compile', () => {
    const cause = new SessionStateError('perfetto 세션을 시작하지 못했습니다')
    const appWithoutState = { ...APP, compile_state_start: null } as TargetApp // 오류의 기록을 쓴다는 증거
    const out = compileFailure(new CompileAppliedError(COMPILE, cause), appWithoutState, SERIAL)
    expect(out!.code).toBe(cause.code)
    expect(out!.message.split('\n')).toEqual([
      'perfetto 세션을 시작하지 못했습니다',
      'Compile   speed · base.apk 바꾸기 전 speed-profile · 지금 모름',
      '',
      COMPILE_CLI_COPY.revertHead,
      BASE_REVERT,
      SECONDARY_REVERT,
    ])
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — 원래 오류가 예상 못 한 오류면 진입점이 찍던 머리 · 스택을 그대로 앞에', () => {
    const cause = new TypeError('boom')
    const out = compileFailure(new CompileAppliedError(COMPILE, cause), APP, SERIAL)!
    expect(out.code).toBe('START_FAILED_AFTER_COMPILE')
    expect(out.message.startsWith(`${UNEXPECTED_ERROR_HEAD}\nTypeError: boom`)).toBe(true)
    expect(out.message.split('\n').slice(-3)).toEqual([COMPILE_CLI_COPY.revertHead, BASE_REVERT, SECONDARY_REVERT])
  })

  it('BP-5 실패 두 종류에서도 되돌림 줄 — compile 과 무관한 오류는 건드리지 않는다', () => {
    expect(compileFailure(new SessionStateError('이미 세션이 있습니다'), APP, SERIAL)).toBeNull()
  })
})

describe('BP-5 --compile 없으면 출력 그대로', () => {
  it('BP-5 --compile 없으면 출력 그대로 — start 에 Compile 줄 · 되돌림 줄 0 (바꾼 뒤 상태를 줘도)', () => {
    const plain = formatStart(session(), APP)
    expect(formatStart(session(), APP, AFTER)).toBe(plain)
    expect(plain).not.toMatch(/Compile|되돌림|cmd package/)
  })

  it('BP-5 --compile 없으면 출력 그대로 — stop 은 경로 · 보고서 명령 두 줄뿐', () => {
    const out = formatStopResult({ runDir: '/runs/x', id: 'a1b2c3', state: 'completed', reportPath: null })
    expect(out.split('\n')).toHaveLength(2)
  })
})

// ─── BP-6 ───

describe('BP-6 start · status 컴파일 줄', () => {
  it('BP-6 start · status 컴파일 줄 — start: Run dir 다음 · Startup 앞 · 문구 표 꼴 (디자인 CLI 블록 1)', () => {
    const out = formatStart(session({ compile: COMPILE }), APP, AFTER).split('\n')
    const runDir = out.findIndex((l) => l.startsWith('Run dir'))
    expect(out[runDir + 1]).toBe('Compile   speed · base.apk speed-profile → speed · 67,500 ms')
    expect(out[runDir + 2]).toBe('Startup   TotalTime 844ms · COLD')
    expect(displayWidth(out[runDir + 1]!)).toBeLessThanOrEqual(80)
  })

  it('BP-6 start · status 컴파일 줄 — 바꾼 뒤 상태를 못 읽었으면 모름 (추측 0)', () => {
    const out = formatStart(session({ compile: COMPILE }), APP, null)
    expect(out).toContain('Compile   speed · base.apk speed-profile → 모름 · 67,500 ms')
  })

  it('BP-6 start · status 컴파일 줄 — status: capture.json 의 시작 상태로 전 → 후 · 기기 접촉 없음 (디자인 CLI 블록 5)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const runDir = mkdtempSync(join(tmpdir(), 'pt-run-'))
    await writeFile(join(runDir, 'capture.json'), JSON.stringify({ version: 1, target_app: { compile_state_start: AFTER } }))
    await writeActiveSession(session({ runDir, compile: COMPILE }), home)

    const lines = (await runStatus(undefined, home)).split('\n')
    const at = lines.findIndex((l) => l.startsWith('Run dir'))
    expect(lines[at + 1]).toBe('Compile   speed · base.apk speed-profile → speed · 67,500 ms')
  })

  it('BP-6 start · status 컴파일 줄 — status: capture.json 이 없으면 뒤는 모름', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const runDir = join(mkdtempSync(join(tmpdir(), 'pt-run-')), '없음')
    await writeActiveSession(session({ runDir, compile: COMPILE }), home)
    expect(await runStatus(undefined, home)).toContain('base.apk speed-profile → 모름 · 67,500 ms')
  })

  it('BP-6 start · status 컴파일 줄 — 평소 세션 status 에는 없다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)
    expect(await runStatus(undefined, home)).not.toContain('Compile')
  })
})

describe('BP-6 --json 은 compile 세션에만', () => {
  async function json(args: string[], env: Record<string, string> = {}): Promise<unknown> {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await buildProgram().parseAsync(['--json', ...args], { from: 'user' })
      return JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    } finally {
      log.mockRestore()
      vi.unstubAllEnvs()
    }
  }

  it('BP-6 --json 은 compile 세션에만 — status --json 의 compile 이 텍스트 줄과 같은 값', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const runDir = mkdtempSync(join(tmpdir(), 'pt-run-'))
    await writeFile(join(runDir, 'capture.json'), JSON.stringify({ version: 1, target_app: { compile_state_start: AFTER } }))
    await writeActiveSession(session({ runDir, compile: COMPILE }), home)

    const data = (await json(['status'], { PERFTRACKER_HOME: home })) as Record<string, unknown>
    expect(data['compile']).toEqual({
      value: 'speed',
      baseStatusBefore: 'speed-profile',
      baseStatusAfter: 'speed',
      elapsedMs: 67_500,
    })
    expect((await statusData(undefined, home)).compile).toEqual(data['compile'])
  })

  it('BP-6 --json 은 compile 세션에만 — 평소 세션 status --json 은 compile 키 0 (null 도 없음)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)
    const data = (await json(['status'], { PERFTRACKER_HOME: home })) as Record<string, unknown>
    expect(Object.keys(data)).not.toContain('compile')
    expect(Object.keys(data['session'] as object)).not.toContain('compile')
  })

  it('BP-6 --json 은 compile 세션에만 — runs --json 은 --compile 기록에만 compile', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-runs-'))
    const store = async (dir: string, id: string, compile?: SessionCompile): Promise<void> => {
      await mkdir(join(out, dir))
      const at = '2026-10-11T07:40:12'
      await writeFile(
        join(out, dir, 'session.json'),
        JSON.stringify({ version: 1, id, name: id, serial: SERIAL, packageName: PKG, startedAt: at, endedAt: at }),
      )
      await writeFile(
        join(out, dir, 'result.json'),
        JSON.stringify({
          session: { id, started_at: at, ended_at: at, ...(compile ? { compile } : {}) },
          target_app: { package: PKG, compile_state_start: AFTER },
        }),
      )
    }
    await store('a', 'a1b2c3', COMPILE)
    await store('b', '9f8e7d')

    const rows = (await json(['runs', '-o', out])) as Record<string, unknown>[]
    const byId = new Map(rows.map((r) => [r['id'], r]))
    expect(byId.get('a1b2c3')?.['compile']).toEqual({
      value: 'speed',
      baseStatusBefore: 'speed-profile',
      baseStatusAfter: 'speed',
      elapsedMs: 67_500,
    })
    expect(Object.keys(byId.get('9f8e7d') ?? {})).not.toContain('compile')
  })
})
