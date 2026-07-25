import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActiveSession } from '@perftracker/core'
import { writeActiveSession } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { runStatus } from '../../src/commands/status.js'

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
