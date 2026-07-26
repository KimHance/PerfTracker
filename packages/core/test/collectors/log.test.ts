import { describe, expect, it } from 'vitest'
import { appProcessSql } from '../../src/collectors/appProcess.js'
import { ANDROID_LOG_BLOCK, ANDROID_LOG_MIN_PRIO, PROCESS_STATS_BLOCK } from '../../src/collectors/blocks.js'
import {
  appLogCountSql,
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
    expect(classifyLogEvent({ tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main', pid: null, process: null })).toBe(
      'crash',
    )
  })

  it('네이티브 크래시를 crash 로 본다', () => {
    expect(
      classifyLogEvent({ tag: 'libc', msg: 'Fatal signal 11 (SIGSEGV), code 1 in tid 1234', pid: null, process: null }),
    ).toBe('crash')
  })

  it('ANR 을 anr 로 본다', () => {
    expect(
      classifyLogEvent({ tag: 'ActivityManager', msg: 'ANR in com.foo.bar (com.foo.bar/.Main)', pid: null, process: null }),
    ).toBe('anr')
  })

  it('태그가 맞아도 메시지가 다르면 분류하지 않는다', () => {
    expect(classifyLogEvent({ tag: 'AndroidRuntime', msg: 'Shutting down VM', pid: null, process: null })).toBeNull()
    expect(
      classifyLogEvent({ tag: 'ActivityManager', msg: 'Killing 1234:com.foo/u0a1', pid: null, process: null }),
    ).toBeNull()
  })

  it('메시지가 맞아도 태그가 다르면 분류하지 않는다 — 남의 로그가 크래시로 둔갑하지 않게', () => {
    expect(classifyLogEvent({ tag: 'MyApp', msg: 'FATAL EXCEPTION: main', pid: null, process: null })).toBeNull()
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

const PKG = 'com.foo.bar'

function ctx(answers: Record<string, unknown>, appPid: number | null = null): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: PKG,
    appUid: null,
    env: { sdkInt: 35, dataSources: ['android.log', 'linux.process_stats'] },
    capture: { startup: null, launchRequested: false, appPid, snapshots: {} },
  }
}

/** 실기기 세션의 기기 전역 개수 그대로 (WARN 1,095 / ERROR 412). */
const COUNTS: LogCountRow[] = [
  { prio: 5, count: 1095 },
  { prio: 6, count: 412 },
]

/** 같은 세션에서 대상 앱 프로세스(pid 24193)의 줄만 센 것. 45배 / 32배 차이가 이 두 표다. */
const APP_COUNTS: LogCountRow[] = [
  { prio: 5, count: 24 },
  { prio: 6, count: 13 },
]

const CANDIDATES = [{ upid: 926, pid: 24193, name: PKG }]

function answers(over: Record<string, unknown> = {}, appPid: number | null = null): Record<string, unknown> {
  return {
    [LOG_COUNT_SQL]: COUNTS,
    [LOG_EVENT_SQL]: [],
    [appProcessSql(PKG, appPid)]: CANDIDATES,
    [appLogCountSql(926)]: APP_COUNTS,
    ...over,
  }
}

describe('appLogCountSql', () => {
  /**
   * `android_logs` 는 프로세스가 아니라 **utid** 를 갖는다. thread 를 거쳐야 upid 에 닿고,
   * pid 가 아니라 upid 로 거는 것이 요점이다 — pid 는 세션 뒤에 재사용될 수 있다.
   */
  it('utid → thread → upid 로 걸러 온다', () => {
    const sql = appLogCountSql(926)
    expect(sql).toContain('android_logs')
    expect(sql).toContain('l.utid = th.utid')
    expect(sql).toContain('th.upid = 926')
  })
})

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
  /**
   * 앱 단위로 세려면 `process` / `thread` 테이블이 채워져 있어야 하고 그것을 채우는 것은
   * `linux.process_stats` 다. 블록 텍스트는 공유 상수 그대로라 기기로 나가는 설정은 안 바뀐다.
   */
  it('android.log 와 함께 자기가 읽는 process_stats 도 선언한다', () => {
    expect(logCollector.traceConfigBlocks()).toEqual([ANDROID_LOG_BLOCK, PROCESS_STATS_BLOCK])
  })
})

describe('logCollector.extract — 기기 전역', () => {
  it('우선순위별로 세고 문턱값을 결과에 실는다', async () => {
    const outcome = await logCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.min_prio).toBe(ANDROID_LOG_MIN_PRIO)
    expect(outcome.data.device_total).toBe(1507)
    expect(outcome.data.device_by_priority).toEqual({ warn: 1095, error: 412, fatal: 0 })
  })

  it('크래시와 ANR 을 갈라 담고 어느 프로세스가 찍었는지까지 싣는다', async () => {
    const events = [
      { tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main', pid: 24193, process: PKG },
      { tag: 'ActivityManager', msg: 'ANR in com.foo.bar', pid: 2414, process: 'system_server' },
      { tag: 'libc', msg: 'Fatal signal 11 (SIGSEGV)', pid: 24193, process: PKG },
      { tag: 'ActivityManager', msg: 'Killing 1234:com.foo/u0a1', pid: 2414, process: 'system_server' },
    ]
    const outcome = await logCollector.extract(ctx(answers({ [LOG_EVENT_SQL]: events })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_crashes).toEqual([
      { tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main', pid: 24193, process: PKG },
      { tag: 'libc', message: 'Fatal signal 11 (SIGSEGV)', pid: 24193, process: PKG },
    ])
    // 실측: `ActivityManager` 줄은 **system_server** 가 찍는다. 앱 pid 로 걸렀다면 사라졌을 줄이다.
    expect(outcome.data.device_anrs).toEqual([
      { tag: 'ActivityManager', message: 'ANR in com.foo.bar', pid: 2414, process: 'system_server' },
    ])
  })

  it('문턱 아래 우선순위가 섞여 와도 device_total 에는 다 넣고 버킷은 셋만 쓴다', async () => {
    const outcome = await logCollector.extract(
      ctx(answers({ [LOG_COUNT_SQL]: [{ prio: 4, count: 900 }, ...COUNTS] })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_total).toBe(2407)
    expect(outcome.data.device_by_priority).toEqual({ warn: 1095, error: 412, fatal: 0 })
  })

  it('로그가 하나도 없으면 0 이 아니라 partial 이다 — 0 은 거짓말일 수 있다', async () => {
    const outcome = await logCollector.extract(ctx(answers({ [LOG_COUNT_SQL]: [] })))
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
      pid: 24193,
      process: PKG,
    }))
    const outcome = await logCollector.extract(ctx(answers({ [LOG_EVENT_SQL]: events })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_crashes).toHaveLength(MAX_LOG_EVENTS)
    expect(outcome.partialReason).toEqual({
      code: 'log_events_truncated',
      detail: { limit: MAX_LOG_EVENTS },
    })
  })

  it('상한에 닿지 않으면 잘림을 말하지 않는다', async () => {
    const events = Array.from({ length: MAX_LOG_EVENTS - 1 }, () => ({
      tag: 'AndroidRuntime',
      msg: 'FATAL EXCEPTION: main',
      pid: 24193,
      process: PKG,
    }))
    const outcome = await logCollector.extract(ctx(answers({ [LOG_EVENT_SQL]: events })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason).toBeUndefined()
  })

  /**
   * M2. 이 collector 는 "빈 로그 버퍼를 0 으로 보고하지 않는다" 를 원칙으로 내세운다
   * (`no_log_entries`). 그런데 이벤트 쿼리가 터졌을 때는 `crashes: []` / `anrs: []` 를
   * 사실처럼 실었다 — 같은 원칙이 두 줄 아래에서 뒤집힌 것이다. 못 센 것은 null 이다.
   */
  it('이벤트 쿼리가 터지면 개수는 살리되 크래시/ANR 은 0 이 아니라 null 이다', async () => {
    const outcome = await logCollector.extract(
      ctx(answers({ [LOG_EVENT_SQL]: new Error('no such table: android_logs') })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_total).toBe(1507)
    expect(outcome.data.device_crashes).toBeNull()
    expect(outcome.data.device_anrs).toBeNull()
    expect(outcome.partialReason).toEqual({
      code: 'query_failed',
      detail: { message: 'no such table: android_logs' },
    })
  })

  it('쿼리가 성공하고 아무것도 없으면 그때는 빈 배열이다 — null 과 뜻이 다르다', async () => {
    const outcome = await logCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_crashes).toEqual([])
    expect(outcome.data.device_anrs).toEqual([])
  })
})

describe('logCollector.extract — 대상 앱', () => {
  /**
   * 이 두 표가 이 변경의 이유다. 같은 세션·같은 트레이스에서 기기 전역은 W 1,095 / E 412,
   * 대상 앱 프로세스만은 W 24 / E 13 이다 (45배 / 32배).
   */
  it('대상 앱 프로세스의 줄만 따로 센다', async () => {
    const outcome = await logCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toEqual({
      process: PKG,
      pid: 24193,
      total: 37,
      by_priority: { warn: 24, error: 13, fatal: 0 },
    })
    expect(outcome.data.device_total).toBe(1507)
  })

  /**
   * **여기가 이 변경에서 가장 위험한 자리다.** "앱이 한 줄도 안 찍었다" 와 "필터가 잘못돼
   * 0건이다" 는 완전히 다른 사실이다. 앱을 특정하지 못한 세션은 0 이 아니라 null 이다.
   */
  it('앱 프로세스를 못 찾으면 0 이 아니라 null 이고 사유를 남긴다', async () => {
    const outcome = await logCollector.extract(ctx(answers({ [appProcessSql(PKG, null)]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.data.device_total).toBe(1507)
    expect(outcome.partialReason).toEqual({
      code: 'process_not_in_trace',
      detail: { package: PKG },
    })
  })

  it('앱 쿼리가 터져도 기기 전역 개수는 살리고 앱만 null 로 둔다', async () => {
    const outcome = await logCollector.extract(
      ctx(answers({ [appLogCountSql(926)]: new Error('no such table: thread') })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.data.device_total).toBe(1507)
    expect(outcome.partialReason).toEqual({
      code: 'query_failed',
      detail: { message: 'no such table: thread' },
    })
  })

  /**
   * 앱을 **찾았는데** 그 프로세스의 줄이 한 건도 없는 것은 관측이다. 기기 전역 개수가
   * 0 이 아니라는 사실(`no_log_entries` 관문을 이미 지났다)이 로그 경로가 살아 있었다는
   * 증거이므로, 이 0 은 거짓 청정 신호가 아니다.
   */
  it('앱이 한 줄도 안 찍은 것은 0 으로 낸다 — 로그 경로가 살아 있음이 이미 확인됐다', async () => {
    const outcome = await logCollector.extract(ctx(answers({ [appLogCountSql(926)]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toEqual({
      process: PKG,
      pid: 24193,
      total: 0,
      by_priority: { warn: 0, error: 0, fatal: 0 },
    })
    expect(outcome.partialReason).toBeUndefined()
  })

  it('이름이 낡았으면 pid 로 찾고 그 사실을 사유로 남긴다', async () => {
    const stale = [{ upid: 926, pid: 24193, name: '<pre-initialized>' }]
    const outcome = await logCollector.extract(
      ctx(answers({ [appProcessSql(PKG, 24193)]: stale }, 24193), 24193),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app!.process).toBe(PKG)
    expect(outcome.partialReason).toEqual({
      code: 'process_name_stale_in_trace',
      detail: { package: PKG, pid: 24193, trace_name: '<pre-initialized>' },
    })
  })

  /**
   * 사유 자리는 하나다. 앱이 통째로 없는 사실이 "이벤트 배열이 잘렸다" 보다 먼저다 —
   * 잘림은 배열 길이로 흔적이 남지만 app 이 null 인 이유는 데이터 어디에도 없다.
   */
  it('앱이 없는 사실이 이벤트 잘림보다 먼저 실린다', async () => {
    const events = Array.from({ length: MAX_LOG_EVENTS }, () => ({
      tag: 'AndroidRuntime',
      msg: 'FATAL EXCEPTION: main',
      pid: 24193,
      process: PKG,
    }))
    const outcome = await logCollector.extract(
      ctx(answers({ [LOG_EVENT_SQL]: events, [appProcessSql(PKG, null)]: [] })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason?.code).toBe('process_not_in_trace')
  })
})
