import type { ActiveSession, TargetApp } from '@perftracker/core'
import { diagnoseNotice } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { formatStart, startSessionOptions } from '../../src/commands/start.js'
import { displayWidth } from '../../src/commands/runs.js'
import { DIAGNOSE_CLI_COPY } from '../../src/copy/diagnose.js'
import { buildProgram } from '../../src/program.js'

/**
 * `start` 의 cli 몫 — 옵션을 core 로 넘기는 입구와 사람이 읽는 문장. 세션을 여는 일(config ·
 * 기기 명령)은 core 가 하고 core 시험(`DM-1 core …`)이 그 글자를 고정한다.
 */

const APP: TargetApp = {
  package: 'com.google.android.youtube',
  label: 'YouTube',
  label_source: 'apk_resources',
  version_name: '21.29.366',
  version_code: 1555530176,
  uid: 10234,
  install_source: 'com.android.vending',
  launcher_activity: 'com.google.android.youtube.app.honeycomb.Shell$HomeActivity',
  pid: null,
}

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    version: 1,
    id: 'a1b2c3',
    name: '유튜브 진단',
    serial: 'R5CT0000001',
    packageName: APP.package,
    runDir: 'runs/2026-10-08T00-29-11_유튜브-진단_a1b2c3',
    perfettoKey: 'perftracker_a1b2c3',
    remoteTracePath: '/data/misc/perfetto-traces/perftracker_a1b2c3.pftrace',
    startedAt: '2026-10-08T00:29:11.000Z',
    configuredDurationMs: 1_800_000,
    options: { launch: true },
    startup: { totalTimeMs: 719, launchState: 'COLD', status: 'ok', waitTimeMs: 730 },
    ...overrides,
  }
}

/** core 가 진단 세션에 싣는 모양 그대로 (`session/start.ts`). */
function diagnoseSession(notice: string | null, overrides: Partial<ActiveSession> = {}): ActiveSession {
  return session({
    configuredDurationMs: 600_000,
    options: { launch: true, diagnose: true },
    diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: [APP.package], notice },
    ...overrides,
  })
}

function startCommand() {
  const start = buildProgram().commands.find((c) => c.name() === 'start')
  if (start === undefined) throw new Error('start 명령이 없다')
  return start
}

describe('DM-1 start --diagnose', () => {
  it('DM-1 start --diagnose — 등록돼 있고 기본값이 없다', () => {
    const option = startCommand().options.find((o) => o.long === '--diagnose')

    expect(option, '--diagnose 가 start 에 등록되지 않았다').toBeDefined()
    // 기본값이 있으면 `--help` 에 `(default: false)` 가 붙어 문구 정본과 달라진다.
    expect(option!.defaultValue).toBeUndefined()
    expect(option!.description).toBe(DIAGNOSE_CLI_COPY.helpDiagnose)
  })

  /**
   * commander 가 실제로 파싱한 값을 그대로 core 의 옵션으로 옮겨 본다 — 등록과 입구가 한 줄로
   * 이어져야 "`--diagnose` 를 주면 진단 세션" 이 성립한다.
   */
  it('DM-1 start --diagnose — 주면 core 에 diagnose: true 가 간다', () => {
    const start = startCommand()
    start.parseOptions(['--app', APP.package, '--launch', '--diagnose'])
    const now = new Date('2026-10-08T00:29:11.000Z')

    const core = startSessionOptions(start.opts() as Parameters<typeof startSessionOptions>[0], now)

    expect(core).toEqual({ launch: true, outDir: 'runs', force: false, now, diagnose: true })
  })

  it('DM-1 start --diagnose — 안 주면 core 로 가는 옵션이 이 옵션이 없던 때와 키까지 같다', () => {
    const start = startCommand()
    start.parseOptions(['--app', APP.package, '--launch', '--name', '홈'])
    const now = new Date('2026-10-08T00:29:11.000Z')

    const core = startSessionOptions(start.opts() as Parameters<typeof startSessionOptions>[0], now)

    // `diagnose: false` 도 없어야 한다 — 평소 세션의 입구는 진단 모드 이전과 같은 모양이다.
    expect(core).toStrictEqual({ name: '홈', launch: true, outDir: 'runs', force: false, now })
    expect(Object.keys(core)).not.toContain('diagnose')
  })

  it('DM-1 start --diagnose — --help 줄에 설명이 기본값 표시 없이 80칸 안에 나온다', () => {
    const line = startCommand()
      .helpInformation()
      .split('\n')
      .find((l) => l.includes('--diagnose'))

    expect(line).toBeDefined()
    expect(line).toContain(DIAGNOSE_CLI_COPY.helpDiagnose)
    expect(line).not.toContain('default')
    expect(displayWidth(line!)).toBeLessThanOrEqual(80)
  })
})

describe('DM-11 start·status 진단 줄 — start', () => {
  it('DM-11 start·status 진단 줄 — 진단 세션이면 Run dir 다음 줄에 Diagnose 줄', () => {
    const lines = formatStart(diagnoseSession(null), APP).split('\n')
    const runDir = lines.findIndex((l) => l.startsWith('Run dir'))

    expect(lines[runDir + 1]).toBe(DIAGNOSE_CLI_COPY.labelLine)
    // 시작 시간 줄은 그 아래로 밀린다 (디자인 시안 cli 블록 3).
    expect(lines[runDir + 2]).toBe('Startup   TotalTime 719ms · COLD')
  })

  it('DM-11 start·status 진단 줄 — 평소 세션에는 진단 표시가 없고 문장은 그대로다', () => {
    const out = formatStart(session(), APP)

    expect(out).not.toContain('Diagnose')
    expect(out).not.toContain('slice')
    expect(out).toBe(
      '측정을 시작했습니다.\n' +
        'Session   유튜브 진단  (a1b2c3)\n' +
        'App       YouTube  com.google.android.youtube\n' +
        'Run dir   runs/2026-10-08T00-29-11_유튜브-진단_a1b2c3\n' +
        'Startup   TotalTime 719ms · COLD\n\n' +
        '기기에서 앱을 조작한 뒤 perftracker stop 을 실행하세요.\n' +
        '측정 중에는 기기에 어떤 명령도 보내지 않습니다.',
    )
  })

  it('DM-11 start·status 진단 줄 — 80칸 안', () => {
    expect(displayWidth(DIAGNOSE_CLI_COPY.labelLine)).toBeLessThanOrEqual(80)
  })
})

describe('DM-10 start 고지', () => {
  /** 고지 문구와 판정의 주인은 core 다 — cli 는 core 가 세션에 실은 줄을 그대로 찍는다. */
  const notice = diagnoseNotice(30, false)

  it('DM-10 start 고지 — 모름 칸이면 세션은 열고 고지 줄을 낸다', () => {
    expect(notice).toBe('앱 slice 열림 모름 — sdk 30 · debuggable 아님')

    const out = formatStart(diagnoseSession(notice), APP)

    expect(out).toContain('측정을 시작했습니다.')
    expect(out).toContain(`\n\n${notice}\n\n기기에서 앱을 조작한 뒤`)
  })

  it('DM-10 start 고지 — 못 재는 지표 목록 뒤에 빈 줄 하나 두고 나온다', () => {
    const out = formatStart(
      diagnoseSession(notice, {
        unsupported: [
          { id: 'frame', reason: '이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=31, Android 12).' },
        ],
      }),
      APP,
    )

    const lines = out.split('\n')
    const listed = lines.findIndex((l) => l.startsWith('  ✗ frame'))
    expect(lines[listed + 1]).toBe('')
    expect(lines[listed + 2]).toBe(notice)
  })

  it('DM-10 start 고지 — 열리는 칸(고지 null)과 평소 세션에는 줄이 없다', () => {
    expect(formatStart(diagnoseSession(null), APP)).not.toContain('앱 slice 열림 모름')
    expect(formatStart(session(), APP)).not.toContain('앱 slice 열림 모름')
  })

  it('DM-10 start 고지 — 고지 줄은 80칸 안 (sdk 두 자리 · debuggable 두 갈래)', () => {
    for (const debuggable of [false, null]) {
      const line = diagnoseNotice(30, debuggable)
      expect(line).not.toBeNull()
      expect(displayWidth(line!)).toBeLessThanOrEqual(80)
    }
  })
})
