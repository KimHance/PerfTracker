import { describe, expect, it } from 'vitest'
import { startupCollector } from '../../src/collectors/startup.js'
import type { BaseExtractContext, CaptureFacts } from '../../src/collectors/types.js'

/**
 * startup 은 `appPid` 도 `snapshots` 도 읽지 않는다 — 기본값으로 채워 두고 각 케이스는
 * 나머지만 말한다.
 */
function ctx(
  capture: Omit<CaptureFacts, 'appPid' | 'snapshots'> &
    Partial<Pick<CaptureFacts, 'appPid' | 'snapshots'>>,
): BaseExtractContext {
  return {
    packageName: 'com.foo.bar',
    appUid: null,
    env: { sdkInt: 35, dataSources: [] },
    capture: { appPid: null, snapshots: {}, ...capture },
  }
}

describe('startupCollector.supports', () => {
  it('어떤 기기에서도 지원된다 — am start -W 는 데이터소스가 아니다', () => {
    expect(startupCollector.supports({ sdkInt: 21, dataSources: [] })).toEqual({ supported: true })
  })
})

describe('startupCollector.traceConfigBlocks', () => {
  it('데이터소스를 하나도 요구하지 않는다', () => {
    expect(startupCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })).toEqual([])
  })
})

describe('startupCollector.extract', () => {
  it('TotalTime 과 LaunchState 를 그대로 옮긴다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: 1842, launchState: 'COLD' } }),
    )
    expect(outcome).toEqual({
      collected: true,
      data: { total_time_ms: 1842, launch_state: 'COLD', status: null, wait_time_ms: null },
    })
  })

  it('LaunchState 가 없어도 TotalTime 만으로 수집된다', async () => {
    const outcome = await startupCollector.extract(
      ctx({ launchRequested: true, startup: { totalTimeMs: 903, launchState: null } }),
    )
    expect(outcome).toEqual({
      collected: true,
      data: { total_time_ms: 903, launch_state: null, status: null, wait_time_ms: null },
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
  it('Status: timeout 이면 시작 시간은 null 이되 기기가 말한 것은 남긴다', async () => {
    /**
     * **못 잰 것과 아무것도 모르는 것은 다르다.** TotalTime 은 없지만 기기는 두 가지를
     * 말해 줬다 — 스스로 `timeout` 이라고 했고, 얼마나 기다렸는지도 찍었다. 예전에는 그 둘이
     * 한국어 `reason` 문장 안에만 있어서 `result.json` 만 읽는 소비자가 쓸 수 없었다.
     *
     * **`wait_time_ms` 를 `total_time_ms` 자리에 넣지 않는다.** 실측(SM-A405S / Android 11,
     * 같은 앱 4회): 10182 · 10150 · 10147 · 10163ms — 편차 0.3%. 앱이 11초 걸리든 60초
     * 걸리든 같은 값이 나오는, 기기의 임계치이지 측정값이 아니다.
     */
    const outcome = await startupCollector.extract(
      ctx({
        launchRequested: true,
        startup: { totalTimeMs: null, launchState: 'UNKNOWN', status: 'timeout', waitTimeMs: 11062 },
      }),
    )
    expect(outcome).toEqual({
      collected: true,
      data: {
        total_time_ms: null,
        launch_state: 'UNKNOWN',
        status: 'timeout',
        wait_time_ms: 11062,
      },
      partialReason: { code: 'launch_wait_timed_out', detail: { wait_time_ms: 11062 } },
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
