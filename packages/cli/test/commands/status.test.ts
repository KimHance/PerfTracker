import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActiveSession } from '@perftracker/core'
import { DEFAULT_MAX_DURATION_MS, DIAGNOSE_MAX_DURATION_MS, writeActiveSession } from '@perftracker/core'
import { describe, expect, it, vi } from 'vitest'
import { runStatus, statusData } from '../../src/commands/status.js'
import { DIAGNOSE_CLI_COPY } from '../../src/copy/diagnose.js'
import { buildProgram } from '../../src/program.js'

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    version: 1,
    id: 'a3f9c1',
    name: '홈 스크롤',
    serial: 'R3CY0000002',
    packageName: 'com.nhn.android.webtoon',
    runDir: '/runs/2026-07-25T14-32-10_홈-스크롤',
    perfettoKey: 'perftracker_a3f9c1',
    remoteTracePath: '/data/misc/perfetto-traces/perftracker_a3f9c1.pftrace',
    startedAt: '2026-07-25T14:32:10.000Z',
    configuredDurationMs: 1_800_000,
    options: { launch: true },
    startup: null,
    ...overrides,
  }
}

describe('runStatus — 기기에 접촉하지 않는다', () => {
  it('활성 세션이 0개면 안내 문구를 낸다 (-d 없이)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    expect(await runStatus(undefined, home)).toBe('실행 중인 세션이 없습니다.')
  })

  it('활성 세션이 정확히 1개면 -d 없이도 그 세션을 보여준다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'R5CT0000001' }), home)

    const out = await runStatus(undefined, home)
    expect(out).toContain('홈 스크롤')
    expect(out).toContain('com.nhn.android.webtoon')
  })

  it('활성 세션이 여러 기기에 있으면 -d 로 지정하라고 안내하고 두 serial 을 모두 보여준다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'AAAA111111' }), home)
    await writeActiveSession(session({ serial: 'BBBB222222', id: 'bbbbbb', name: '상세페이지' }), home)

    const out = await runStatus(undefined, home)
    expect(out).toContain('AAAA111111')
    expect(out).toContain('BBBB222222')
    expect(out).toContain('-d')
  })

  it('-d 로 serial 을 지정하면 그 기기의 세션만 본다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'AAAA111111', name: '첫번째' }), home)
    await writeActiveSession(session({ serial: 'BBBB222222', id: 'bbbbbb', name: '두번째' }), home)

    const out = await runStatus('BBBB222222', home)
    expect(out).toContain('두번째')
    expect(out).not.toContain('첫번째')
  })

  it('-d 로 지정한 기기에 활성 세션이 없으면 없다고 안내한다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'AAAA111111' }), home)

    expect(await runStatus('NOPE', home)).toBe('실행 중인 세션이 없습니다.')
  })
})

describe('runStatus — 지금 알아야 할 것', () => {
  it('누적 adb 위반 횟수를 보여준다', async () => {
    /**
     * 포인터에 이미 쌓여 있는데 보여주지 않아 왔다. 세션이 오염된 것을 `stop` 뒤
     * `result.json` 을 열어야 아는 것은 그때까지의 조작을 통째로 버리게 만든다.
     */
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ adbCommandsDuringSession: 3 }), home)

    const text = await runStatus(undefined, home)

    expect(text).toContain('3번 차단')
    expect(text).toContain('오염')
  })

  it('위반이 없으면 그 줄을 아예 안 낸다', async () => {
    // "0회 위반" 은 정상이고, 정상을 매번 보고하면 진짜 신호가 묻힌다.
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)

    expect(await runStatus(undefined, home)).not.toContain('차단')
  })

  it('마킹 수와 마지막 마킹 시각을 보여준다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(
      session({
        marks: [
          { offsetMs: 61_000, label: '스크롤' },
          { offsetMs: 5_000, label: '진입' },
        ],
      }),
      home,
    )

    const text = await runStatus(undefined, home)

    // 저장 순서가 뒤집혀 있어도 "마지막" 은 시간순의 마지막이다.
    expect(text).toContain('Marks     2개')
    expect(text).toContain('01:01')
  })

  it('마킹이 없으면 그 줄도 없다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)

    expect(await runStatus(undefined, home)).not.toContain('Marks')
  })
})

describe('statusData — --json 이 내는 모양', () => {
  it('세션이 없으면 session 은 null 이다 (빈 객체가 아니다)', async () => {
    // `{}` 를 내면 소비자가 "세션은 있는데 정보가 비었다" 로 읽는다.
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))

    const data = await statusData(undefined, home)

    expect(data.session).toBeNull()
    expect(data.elapsedMs).toBeNull()
    expect(data.durationExceeded).toBeNull()
  })

  it('텍스트와 같은 규칙으로 세션을 고른다', async () => {
    /**
     * 사람이 보는 답과 기계가 받는 답이 갈리면 안 된다. 기기가 여럿일 때 텍스트가
     * "-d 로 지정하세요" 라고 하면 JSON 도 고르지 않고 후보를 낸다.
     */
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'AAA', id: 'aaa111' }), home)
    await writeActiveSession(session({ serial: 'BBB', id: 'bbb222' }), home)

    const data = await statusData(undefined, home)
    const text = await runStatus(undefined, home)

    expect(data.session).toBeNull()
    expect(data.ambiguous.map((a) => a.serial)).toEqual(['AAA', 'BBB'])
    expect(text).toContain('여러 기기에')
  })

  it('마킹은 시간순으로, 위반 횟수는 숫자로 낸다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(
      session({
        adbCommandsDuringSession: 2,
        marks: [
          { offsetMs: 9000, label: '나중' },
          { offsetMs: 1000, label: '먼저' },
        ],
      }),
      home,
    )

    const data = await statusData(undefined, home)

    expect(data.marks.map((m) => m.label)).toEqual(['먼저', '나중'])
    expect(data.adbCommandsDuringSession).toBe(2)
  })
})

/** core 가 진단 세션에 싣는 모양 그대로 (`session/start.ts`) — 최대 10분 · 진단 키 둘. */
function diagnoseSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return session({
    configuredDurationMs: 600_000,
    options: { launch: true, diagnose: true },
    diagnose: { atraceCategories: ['am', 'wm', 'view'], atraceApps: ['com.nhn.android.webtoon'], notice: null },
    ...overrides,
  })
}

/** `startedAt` 을 지금에서 `ms` 만큼 앞으로 — 경과 시간이 그만큼인 세션. */
function startedAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

describe('DM-11 start·status 진단 줄 — status', () => {
  it('DM-11 start·status 진단 줄 — 진단 세션이면 Run dir 다음 줄에 start 와 같은 Diagnose 줄', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(diagnoseSession({ marks: [{ offsetMs: 160_000, label: '스크롤' }] }), home)

    const lines = (await runStatus(undefined, home)).split('\n')
    const runDir = lines.findIndex((l) => l.startsWith('Run dir'))

    expect(lines[runDir + 1]).toBe(DIAGNOSE_CLI_COPY.labelLine)
    // 마킹 줄은 그 아래 (디자인 시안 cli 블록 5).
    expect(lines[runDir + 2]).toMatch(/^Marks {5}1개/)
  })

  it('DM-11 start·status 진단 줄 — 평소 세션에는 없다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)

    expect(await runStatus(undefined, home)).not.toContain('Diagnose')
  })
})

describe('DM-11 runs 태그 · --json — status --json', () => {
  /** `perftracker --json status` 를 commander 로 끝까지 돌려 찍힌 JSON 을 받는다. 기기 접촉 없음. */
  async function statusJson(home: string): Promise<{ session: Record<string, unknown> | null }> {
    vi.stubEnv('PERFTRACKER_HOME', home)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await buildProgram().parseAsync(['--json', 'status'], { from: 'user' })
      return JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    } finally {
      log.mockRestore()
      vi.unstubAllEnvs()
    }
  }

  it('DM-11 runs 태그 · --json — status --json 은 진단 세션에만 진단 표시를 싣는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(diagnoseSession(), home)

    const data = await statusJson(home)

    expect(data.session?.['options']).toEqual({ launch: true, diagnose: true })
    expect(data.session?.['diagnose']).toEqual({
      atraceCategories: ['am', 'wm', 'view'],
      atraceApps: ['com.nhn.android.webtoon'],
      notice: null,
    })
  })

  it('DM-11 runs 태그 · --json — 평소 세션의 status --json 은 진단 키 0 (false 도 없음)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session(), home)

    const data = await statusJson(home)

    expect(data.session?.['options']).toStrictEqual({ launch: true })
    expect(Object.keys(data.session ?? {})).not.toContain('diagnose')
  })
})

describe('DM-17 status 넘음 기준', () => {
  /** 디자인 시안 cli 블록 6 — 기존 문구 그대로, 값만 `10:00`. */
  it('DM-17 status 넘음 기준 — 진단 세션은 10분을 넘으면 (10:00) 기준으로 알린다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(diagnoseSession({ startedAt: startedAgo(624_000) }), home)

    const text = await runStatus(undefined, home)

    expect(text).toContain('설정된 최대 측정 시간(10:00)을 넘었습니다.')
  })

  it('DM-17 status 넘음 기준 — 진단 세션도 10분 전에는 알리지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(diagnoseSession({ startedAt: startedAgo(540_000) }), home)

    expect(await runStatus(undefined, home)).not.toContain('최대 측정 시간')
  })

  it('DM-17 status 넘음 기준 — 평소 세션(30분)은 같은 10분 24초에 알리지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ startedAt: startedAgo(624_000) }), home)

    expect(await runStatus(undefined, home)).not.toContain('최대 측정 시간')
  })

  it('DM-17 status 넘음 기준 — 넘음 기준은 core 의 상수와 같다 (진단 10분 · 평소 30분)', () => {
    // 위 시험의 세션 모양이 core 가 실제로 싣는 값과 어긋나면 위 시험은 빈말이 된다.
    expect(diagnoseSession().configuredDurationMs).toBe(DIAGNOSE_MAX_DURATION_MS)
    expect(session().configuredDurationMs).toBe(DEFAULT_MAX_DURATION_MS)
  })
})
