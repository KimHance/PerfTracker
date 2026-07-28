import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActiveSession } from '@perftracker/core'
import { writeActiveSession } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { runStatus, statusData } from '../../src/commands/status.js'

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
