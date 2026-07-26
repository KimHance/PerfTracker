import { describe, expect, it } from 'vitest'
import { ANDROID_LOG_BLOCK, ANDROID_LOG_MIN_PRIO } from '../../src/collectors/blocks.js'
import {
  classifyLogEvent,
  LOG_COUNT_SQL,
  LOG_EVENT_SQL,
  type LogCountRow,
  logCollector,
  MAX_LOG_EVENTS,
} from '../../src/collectors/log.js'
import type { ExtractContext } from '../../src/collectors/types.js'

describe('classifyLogEvent', () => {
  it('자바 크래시를 crash 로 본다', () => {
    expect(
      classifyLogEvent({ tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main' }),
    ).toBe('crash')
  })

  it('네이티브 크래시를 crash 로 본다', () => {
    expect(
      classifyLogEvent({ tag: 'libc', msg: 'Fatal signal 11 (SIGSEGV), code 1 in tid 1234' }),
    ).toBe('crash')
  })

  it('ANR 을 anr 로 본다', () => {
    expect(
      classifyLogEvent({ tag: 'ActivityManager', msg: 'ANR in com.foo.bar (com.foo.bar/.Main)' }),
    ).toBe('anr')
  })

  it('태그가 맞아도 메시지가 다르면 분류하지 않는다', () => {
    expect(classifyLogEvent({ tag: 'AndroidRuntime', msg: 'Shutting down VM' })).toBeNull()
    expect(classifyLogEvent({ tag: 'ActivityManager', msg: 'Killing 1234:com.foo/u0a1' })).toBeNull()
  })

  it('메시지가 맞아도 태그가 다르면 분류하지 않는다 — 남의 로그가 크래시로 둔갑하지 않게', () => {
    expect(classifyLogEvent({ tag: 'MyApp', msg: 'FATAL EXCEPTION: main' })).toBeNull()
  })
})

class FakeTp {
  constructor(private readonly answers: Record<string, unknown>) {}
  async queryJson<T>(sql: string): Promise<T> {
    if (!(sql in this.answers)) throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`)
    const value = this.answers[sql]
    if (value instanceof Error) throw value
    return value as T
  }
}

function ctx(answers: Record<string, unknown>): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: 'com.foo.bar',
    env: { sdkInt: 35, dataSources: ['android.log'] },
    capture: { startup: null, launchRequested: false, appPid: null },
  }
}

const COUNTS: LogCountRow[] = [
  { prio: 5, count: 118 },
  { prio: 6, count: 23 },
  { prio: 7, count: 1 },
]

describe('logCollector.supports', () => {
  it('android.log 가 없으면 미지원이다', () => {
    expect(logCollector.supports({ sdkInt: 35, dataSources: [] })).toEqual({
      supported: false,
      reason: { code: 'data_source_not_registered', detail: { data_source: 'android.log' } },
    })
  })

  it('SDK 하한은 없다', () => {
    expect(logCollector.supports({ sdkInt: 21, dataSources: ['android.log'] })).toEqual({
      supported: true,
    })
  })
})

describe('logCollector.traceConfigBlocks', () => {
  it('공유 상수를 그대로 쓴다', () => {
    expect(logCollector.traceConfigBlocks()).toEqual([ANDROID_LOG_BLOCK])
  })
})

describe('logCollector.extract', () => {
  it('우선순위별로 세고 문턱값을 결과에 실는다', async () => {
    const outcome = await logCollector.extract(
      ctx({ [LOG_COUNT_SQL]: COUNTS, [LOG_EVENT_SQL]: [] }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.min_prio).toBe(ANDROID_LOG_MIN_PRIO)
    expect(outcome.data.total).toBe(142)
    expect(outcome.data.by_priority).toEqual({ warn: 118, error: 23, fatal: 1 })
    expect(outcome.data.crashes).toEqual([])
    expect(outcome.data.anrs).toEqual([])
  })

  it('크래시와 ANR 을 갈라 담는다', async () => {
    const events = [
      { tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main' },
      { tag: 'ActivityManager', msg: 'ANR in com.foo.bar' },
      { tag: 'libc', msg: 'Fatal signal 11 (SIGSEGV)' },
      { tag: 'ActivityManager', msg: 'Killing 1234:com.foo/u0a1' },
    ]
    const outcome = await logCollector.extract(
      ctx({ [LOG_COUNT_SQL]: COUNTS, [LOG_EVENT_SQL]: events }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.crashes).toEqual([
      { tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main' },
      { tag: 'libc', message: 'Fatal signal 11 (SIGSEGV)' },
    ])
    expect(outcome.data.anrs).toEqual([{ tag: 'ActivityManager', message: 'ANR in com.foo.bar' }])
  })

  it('문턱 아래 우선순위가 섞여 와도 total 에는 다 넣고 버킷은 셋만 쓴다', async () => {
    const outcome = await logCollector.extract(
      ctx({
        [LOG_COUNT_SQL]: [{ prio: 4, count: 900 }, ...COUNTS],
        [LOG_EVENT_SQL]: [],
      }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.total).toBe(1042)
    expect(outcome.data.by_priority).toEqual({ warn: 118, error: 23, fatal: 1 })
  })

  it('로그가 하나도 없으면 0 이 아니라 partial 이다 — 0 은 거짓말일 수 있다', async () => {
    const outcome = await logCollector.extract(ctx({ [LOG_COUNT_SQL]: [], [LOG_EVENT_SQL]: [] }))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'no_log_entries', detail: { min_prio: ANDROID_LOG_MIN_PRIO } },
    })
  })

  /**
   * B-2. SQL 이 `limit 200` 이라 크래시 폭풍에서는 배열이 잘린다 — 그 상한이 실제로 걸리는
   * 상황이 바로 이 상한을 만든 상황이다. 짧은 배열을 전부인 것처럼 내보내면 안 된다.
   */
  it('이벤트 상한에 닿으면 잘렸을 수 있다는 사실을 사유로 남긴다', async () => {
    const events = Array.from({ length: MAX_LOG_EVENTS }, () => ({
      tag: 'AndroidRuntime',
      msg: 'FATAL EXCEPTION: main',
    }))
    const outcome = await logCollector.extract(
      ctx({ [LOG_COUNT_SQL]: COUNTS, [LOG_EVENT_SQL]: events }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.crashes).toHaveLength(MAX_LOG_EVENTS)
    expect(outcome.partialReason).toEqual({
      code: 'log_events_truncated',
      detail: { limit: MAX_LOG_EVENTS },
    })
  })

  it('상한에 닿지 않으면 잘림을 말하지 않는다', async () => {
    const events = Array.from({ length: MAX_LOG_EVENTS - 1 }, () => ({
      tag: 'AndroidRuntime',
      msg: 'FATAL EXCEPTION: main',
    }))
    const outcome = await logCollector.extract(
      ctx({ [LOG_COUNT_SQL]: COUNTS, [LOG_EVENT_SQL]: events }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason).toBeUndefined()
  })

  it('이벤트 쿼리가 터져도 개수는 살리고 partial 로 남긴다', async () => {
    const outcome = await logCollector.extract(
      ctx({ [LOG_COUNT_SQL]: COUNTS, [LOG_EVENT_SQL]: new Error('no such table: android_logs') }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.total).toBe(142)
    expect(outcome.data.crashes).toEqual([])
    expect(outcome.partialReason).toEqual({ code: 'query_failed', detail: { message: 'no such table: android_logs' } })
  })
})
