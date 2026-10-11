import { describe, expect, it } from 'vitest'
import { nodeProcessRunner } from '../../src/adb/process.js'

/**
 * 실제 프로세스를 띄우는 runner 의 시간 한도 (기능 문서 baseline-profile BP-4 · 결정 10). 한도로 죽인 것과
 * 명령이 비영 코드로 끝난 것은 종료 코드만으로 갈리지 않는다 (둘 다 1 일 수 있다) — 그래서 칸이 따로 있다.
 */
describe('nodeProcessRunner — 시간 한도', () => {
  it('BP-4 compile 시간 한도 — 넘긴 한도로 끊으면 timedOut 이 실린다', async () => {
    const r = await nodeProcessRunner.run('sleep', ['5'], { timeoutMs: 100 })

    expect(r.timedOut).toBe(true)
  })

  it('BP-4 compile 시간 한도 — 명령이 스스로 1 로 끝나면 timedOut 키가 없다', async () => {
    const r = await nodeProcessRunner.run('sh', ['-c', 'exit 1'], { timeoutMs: 5_000 })

    expect(r.code).toBe(1)
    expect('timedOut' in r).toBe(false)
  })

  it('BP-4 compile 시간 한도 — 한도 안에 끝나면 timedOut 키가 없다', async () => {
    const r = await nodeProcessRunner.run('sh', ['-c', 'echo Success'], { timeoutMs: 5_000 })

    expect(r.code).toBe(0)
    expect(r.stdout.toString('utf8')).toBe('Success\n')
    expect('timedOut' in r).toBe(false)
  })
})
