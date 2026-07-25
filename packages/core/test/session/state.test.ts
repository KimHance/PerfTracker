import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ActiveSession,
  clearActiveSession,
  newSessionId,
  readActiveSession,
  writeActiveSession,
  writeRunSession,
} from '../../src/session/state.js'
import { computeStatus, formatElapsed } from '../../src/session/status.js'

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
    options: { launch: true, video: false },
    startup: { totalTimeMs: 1842, launchState: 'COLD' },
    ...overrides,
  }
}

describe('newSessionId', () => {
  it('6자리 16진수를 만든다', () => {
    expect(newSessionId(() => Buffer.from([0xa3, 0xf9, 0xc1]))).toBe('a3f9c1')
  })

  it('기본 구현은 매번 다른 값을 낸다', () => {
    expect(newSessionId()).not.toBe(newSessionId())
  })
})

describe('active session 파일', () => {
  it('쓰고 읽으면 같은 값이 나온다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const s = session()

    await writeActiveSession(s, home)

    expect(await readActiveSession(s.serial, home)).toEqual(s)
  })

  it('없는 기기는 null 을 낸다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    expect(await readActiveSession('NOPE', home)).toBeNull()
  })

  it('지우면 사라진다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const s = session()
    await writeActiveSession(s, home)

    await clearActiveSession(s.serial, home)

    expect(await readActiveSession(s.serial, home)).toBeNull()
  })

  it('없는 세션을 지워도 오류가 아니다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await expect(clearActiveSession('NOPE', home)).resolves.toBeUndefined()
  })

  it('기기마다 독립적으로 유지된다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(session({ serial: 'A' }), home)
    await writeActiveSession(session({ serial: 'B', id: 'bbbbbb' }), home)

    expect((await readActiveSession('A', home))?.id).toBe('a3f9c1')
    expect((await readActiveSession('B', home))?.id).toBe('bbbbbb')
  })
})

describe('writeRunSession', () => {
  it('run 디렉토리에 정본을 남긴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-run-'))
    await mkdir(dir, { recursive: true })

    await writeRunSession(dir, session(), { state: 'completed' })

    const parsed = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as Record<string, unknown>
    expect(parsed['id']).toBe('a3f9c1')
    expect(parsed['name']).toBe('홈 스크롤')
    expect(parsed['state']).toBe('completed')
  })
})

describe('computeStatus / formatElapsed', () => {
  it('경과 시간을 계산한다', () => {
    const s = computeStatus(session(), new Date('2026-07-25T14:33:00.000Z'))
    expect(s.elapsedMs).toBe(50_000)
    expect(s.durationExceeded).toBe(false)
  })

  it('설정한 duration 을 넘으면 표시한다', () => {
    const s = computeStatus(session({ configuredDurationMs: 1000 }), new Date('2026-07-25T14:33:00.000Z'))
    expect(s.durationExceeded).toBe(true)
  })

  it('경과 시간을 사람이 읽는 형태로 만든다', () => {
    expect(formatElapsed(50_000)).toBe('00:50')
    expect(formatElapsed(3_723_000)).toBe('01:02:03')
  })
})
