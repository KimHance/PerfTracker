import { describe, expect, it } from 'vitest'
import { startupCollector } from '../../src/collectors/startup.js'
import type { BaseExtractContext, CaptureFacts } from '../../src/collectors/types.js'

/** startup 은 `appPid` 를 읽지 않는다 — 기본값으로 채워 두고 각 케이스는 나머지만 말한다. */
function ctx(capture: Omit<CaptureFacts, 'appPid'> & { appPid?: number | null }): BaseExtractContext {
  return {
    packageName: 'com.foo.bar',
    env: { sdkInt: 35, dataSources: [] },
    capture: { appPid: null, ...capture },
  }
}

describe('startupCollector.supports', () => {
  it('어떤 기기에서도 지원된다 — am start -W 는 데이터소스가 아니다', () => {
    expect(startupCollector.supports({ sdkInt: 21, dataSources: [] })).toEqual({ supported: true })
  })
})

describe('startupCollector.traceConfigBlocks', () => {
  it('데이터소스를 하나도 요구하지 않는다', () => {
    expect(startupCollector.traceConfigBlocks()).toEqual([])
  })
})

describe('startupCollector.extract', () => {
  it('TotalTime 과 LaunchState 를 그대로 옮긴다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: 1842, launchState: 'COLD' } }),
    )
    expect(outcome).toEqual({
      collected: true,
      data: { total_time_ms: 1842, launch_state: 'COLD' },
    })
  })

  it('LaunchState 가 없어도 TotalTime 만으로 수집된다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: 903, launchState: null } }),
    )
    expect(outcome).toEqual({
      collected: true,
      data: { total_time_ms: 903, launch_state: null },
    })
  })

  it('--launch 없이 시작한 세션은 skipped 다 — 실패가 아니라 안 한 것이다', async () => {
    const outcome = await startupCollector.extract(ctx({ launchRequested: false, startup: null }))
    expect(outcome).toEqual({
      collected: false,
      status: 'skipped',
      reason: { code: 'launch_not_requested' },
    })
  })

  it('--launch 를 줬는데 TotalTime 이 없으면 partial 이다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: null, launchState: 'HOT' } }),
    )
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'launch_time_unreported', detail: { am_start_status: null } },
    })
  })

  /**
   * 기기가 `Status: timeout` 을 냈다면 TotalTime 이 없는 이유를 **기기가 이미 말한 것**이다.
   * 그것을 "앱이 이미 떠 있었거나 액티비티가 바로 끝났을 수 있습니다" 로 렌더하면 도구가
   * 관측하지 않은 원인을 지어낸다. 실측(에뮬레이터)에서 이 경로가 흔하게 잡힌다.
   */
  it('Status: timeout 은 별도 사유로 낸다 — 원인을 지어내지 않는다', async () => {
    const outcome = await startupCollector.extract(
      ctx({
        launchRequested: true,
        startup: { totalTimeMs: null, launchState: 'UNKNOWN', status: 'timeout', waitTimeMs: 11062 },
      }),
    )
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'launch_wait_timed_out', detail: { wait_time_ms: 11062 } },
    })
  })

  it('--launch 를 줬는데 startup 자체가 없어도 partial 이다', async () => {
    const outcome = await startupCollector.extract(ctx({ launchRequested: true, startup: null }))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'launch_time_unreported', detail: { am_start_status: null } },
    })
  })

  it('음수 TotalTime 은 받지 않는다 — 스키마가 nonnegative 다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: -1, launchState: 'COLD', status: 'ok' } }),
    )
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'launch_time_unreported', detail: { am_start_status: 'ok' } },
    })
  })
})
