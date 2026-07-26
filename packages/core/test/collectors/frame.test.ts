import { describe, expect, it } from 'vitest'
import { bucketFrames, buildFrameBuckets, frameCollector, percentile } from '../../src/collectors/frame.js'
import { FRAME_PROCESS_SQL, frameDurationsSql } from '../../src/collectors/frame.js'
import type { CaptureFacts } from '../../src/collectors/types.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

/**
 * `--launch` 없이 시작한 세션. 그런 세션에는 앱의 pid 를 알 기회가 없으므로 `appPid` 는 null 이다
 * (그리고 그때는 앱이 트레이스 시작 전부터 떠 있어 이름이 이미 확정돼 있다).
 */
const NO_CAPTURE: CaptureFacts = { startup: null, launchRequested: false, appPid: null }

describe('buildFrameBuckets', () => {
  it('스펙이 정한 101개 버킷을 만든다', () => {
    expect(buildFrameBuckets()).toHaveLength(101)
  })

  it('첫 버킷은 0-5 하나다', () => {
    expect(buildFrameBuckets()[0]).toEqual({ from_ms: 0, to_ms: 5, count: 0 })
  })

  it('16ms 부근은 1ms 간격이다', () => {
    const b = buildFrameBuckets()
    expect(b[1]).toEqual({ from_ms: 5, to_ms: 6, count: 0 })
    expect(b[11]).toEqual({ from_ms: 15, to_ms: 16, count: 0 })
  })

  it('마지막 버킷은 상한이 없다', () => {
    expect(buildFrameBuckets().at(-1)).toEqual({ from_ms: 700, to_ms: null, count: 0 })
  })

  it('구간 경계가 이어진다', () => {
    const b = buildFrameBuckets()
    for (let i = 0; i < b.length - 1; i++) expect(b[i]!.to_ms).toBe(b[i + 1]!.from_ms)
  })
})

describe('bucketFrames', () => {
  it('경계값은 아래 버킷이 아니라 위 버킷에 들어간다', () => {
    const b = bucketFrames([5])
    expect(b[0]!.count).toBe(0)
    expect(b[1]!.count).toBe(1)
  })

  it('700 이상은 마지막 버킷으로 간다', () => {
    expect(bucketFrames([700, 5000]).at(-1)!.count).toBe(2)
  })

  it('0 은 첫 버킷에 들어간다', () => {
    expect(bucketFrames([0, 4.9])[0]!.count).toBe(2)
  })

  it('총합이 입력 개수와 같다', () => {
    const durations = [1, 7, 17, 60, 200, 400, 900]
    expect(bucketFrames(durations).reduce((s, b) => s + b.count, 0)).toBe(durations.length)
  })

  it('음수는 오버플로 버킷으로 흘리지 않고 거부한다', () => {
    // trace_processor 는 종료 이벤트를 못 받은 slice 에 dur = -1 을 낸다.
    // 예전에는 그것이 700ms+ (frozen frame) 버킷에 앉았다.
    expect(() => bucketFrames([-1])).toThrow(RangeError)
    expect(() => bucketFrames([10, -1_000_000])).toThrow(/범위 밖/)
  })

  it('NaN 도 거부한다', () => {
    expect(() => bucketFrames([Number.NaN])).toThrow(RangeError)
  })
})

describe('frameDurationsSql', () => {
  it('미완결 slice(dur = -1) 를 SQL 단계에서 거른다', () => {
    expect(frameDurationsSql(2)).toContain('dur >= 0')
  })
})

describe('percentile', () => {
  it('정렬된 배열에서 백분위를 고른다', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 90)).toBe(9)
    expect(percentile(sorted, 100)).toBe(10)
  })

  it('빈 배열은 0', () => {
    expect(percentile([], 50)).toBe(0)
  })
})

describe('frameCollector', () => {
  it('Android 12 미만은 안정적인 코드로 미지원을 말한다', () => {
    // 산문이 아니라 코드가 계약이다 — 문구를 다듬어도 CI 매처가 깨지지 않는다.
    expect(frameCollector.supports({ sdkInt: 30, dataSources: [] })).toEqual({
      supported: false,
      reason: { code: 'sdk_too_low', detail: { sdk_int: 30, min_sdk: 31 } },
    })
  })

  it('데이터소스 미등록도 코드로 말한다', () => {
    expect(frameCollector.supports({ sdkInt: 36, dataSources: [] })).toEqual({
      supported: false,
      reason: { code: 'data_source_not_registered', detail: { data_source: 'android.surfaceflinger.frametimeline' } },
    })
  })

  it('데이터소스가 등록되지 않았으면 미지원', () => {
    expect(frameCollector.supports({ sdkInt: 36, dataSources: [] }).supported).toBe(false)
  })

  it('조건이 맞으면 지원', () => {
    expect(
      frameCollector.supports({ sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] }),
    ).toEqual({ supported: true })
  })

  it('TraceConfig 블록에 frametimeline 이 들어간다', () => {
    expect(frameCollector.traceConfigBlocks().join('\n')).toContain('android.surfaceflinger.frametimeline')
  })

  it('TraceConfig 블록에 linux.process_stats 도 들어간다 — 프로세스 이름 해석에 필요하다', () => {
    const text = frameCollector.traceConfigBlocks().join('\n')
    expect(text).toContain('linux.process_stats')
    expect(text).toContain('proc_stats_poll_ms: 1000')
    expect(text).toContain('scan_all_processes_on_start: true')
  })

  it('내는 블록은 저부하 불변식을 통과한다 (폴링 주기 1000ms 이상)', () => {
    expect(() =>
      buildTraceConfig({ dataSourceBlocks: frameCollector.traceConfigBlocks() }),
    ).not.toThrow()
  })

  it('supports() 는 linux.process_stats 를 게이트 조건으로 쓰지 않는다', () => {
    // frametimeline 데이터소스만 등록돼 있어도 지원 판정은 그대로다.
    expect(
      frameCollector.supports({ sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] }),
    ).toEqual({ supported: true })
  })

  it('트레이스에서 프레임 분포를 산출한다', async () => {
    const pkg = 'com.nhn.android.webtoon'
    const runner = new FakeProcessRunner()
      .on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
        stdout: `"j"\n"[{"upid":2,"pid":24193,"name":"${pkg}","frames":4}]"\n`,
      })
      .on(`query /t.pftrace ${frameDurationsSql(2)}`, {
        stdout: '"j"\n"[8000000,20000000,4000000,900000000]"\n',
      })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    const outcome = await frameCollector.extract({
      tp,
      packageName: pkg,
      env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
      capture: NO_CAPTURE,
    })

    expect(outcome.collected).toBe(true)
    const data = outcome.collected ? outcome.data : null
    expect(data).not.toBeNull()
    expect(data!.process).toBe(pkg)
    expect(data!.pid).toBe(24193)
    expect(data!.total_frames).toBe(4)
    expect(data!.max_ms).toBe(900)
    expect(data!.within_16_67ms_ratio).toBe(0.5)
    expect(data!.buckets.reduce((s, b) => s + b.count, 0)).toBe(4)
  })

  it('앱 프로세스를 못 찾으면 render_process_not_found 로 구분한다', async () => {
    const runner = new FakeProcessRunner().on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
      stdout: '"j"\n"[{"upid":1,"pid":1,"name":"/system/bin/surfaceflinger","frames":450}]"\n',
    })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    await expect(
      frameCollector.extract({
        tp,
        packageName: 'com.x',
        env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
        capture: NO_CAPTURE,
      }),
    ).resolves.toEqual({
      collected: false,
      reason: { code: 'render_process_not_found', detail: { package: 'com.x' } },
    })
  })

  it('프로세스는 찾았지만 프레임이 없으면 no_frames 로 구분한다', async () => {
    // 예전에는 이 경우에도 "렌더 프로세스를 찾지 못했습니다" 라는 틀린 사유가 나갔다.
    const pkg = 'com.nhn.android.webtoon'
    const runner = new FakeProcessRunner()
      .on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
        stdout: `"j"\n"[{"upid":2,"pid":24193,"name":"${pkg}","frames":0}]"\n`,
      })
      .on(`query /t.pftrace ${frameDurationsSql(2)}`, { stdout: '"j"\n"[]"\n' })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    await expect(
      frameCollector.extract({
        tp,
        packageName: pkg,
        env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
        capture: NO_CAPTURE,
      }),
    ).resolves.toEqual({ collected: false, reason: { code: 'no_frames', detail: { process: pkg } } })
  })

  /**
   * 에뮬레이터 실측 트레이스 그대로. `--launch` 는 앱을 force-stop 하고 다시 띄우므로 앱
   * 프로세스는 항상 갓 fork 된 상태이고, `linux.process_stats` 가 `Process.setArgV0` 이전에
   * 그 프로세스를 훑으면 이름이 "zygote64" 로 굳는다.
   */
  const ZYGOTE_CANDIDATES =
    '[{"upid":254,"pid":551,"name":"system_server","frames":37},' +
    '{"upid":234,"pid":398,"name":"/system/bin/surfaceflinger","frames":36},' +
    '{"upid":309,"pid":6037,"name":"zygote64","frames":11},' +
    '{"upid":1,"pid":1074,"name":"com.google.android.apps.nexuslauncher","frames":9}]'

  function zygoteRunner(): FakeProcessRunner {
    return new FakeProcessRunner()
      .on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, { stdout: `"j"\n"${ZYGOTE_CANDIDATES}"\n` })
      .on(`query /t.pftrace ${frameDurationsSql(309)}`, {
        stdout: '"j"\n"[8000000,20000000,4000000]"\n',
      })
  }

  const LAUNCHED: CaptureFacts = {
    startup: { totalTimeMs: 12457, launchState: 'COLD' },
    launchRequested: true,
    appPid: 6037,
  }

  it('트레이스 이름이 zygote64 로 굳어도 캡처한 pid 로 앱을 찾고, 그 이름을 쓰지 않는다', async () => {
    const pkg = 'com.example.streaming.debug'
    const outcome = await frameCollector.extract({
      tp: new TraceProcessor('/bin/tp', '/t.pftrace', zygoteRunner()),
      packageName: pkg,
      env: { sdkInt: 35, dataSources: ['android.surfaceflinger.frametimeline'] },
      capture: LAUNCHED,
    })

    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    // 이것이 결함의 핵심이었다: 사실로 팔리는 필드에 틀린 값이 실려 나갔다.
    expect(outcome.data.process).not.toBe('zygote64')
    expect(outcome.data.process).toBe(pkg)
    expect(outcome.data.pid).toBe(6037)
    expect(outcome.data.total_frames).toBe(3)
    // 트레이스가 다른 이름을 알고 있다는 사실 자체는 숨기지 않는다.
    expect(outcome.partialReason).toEqual({
      code: 'process_name_stale_in_trace',
      detail: { package: pkg, pid: 6037, trace_name: 'zygote64' },
    })
  })

  it('pid 를 모르면 프레임이 가장 많은 프로세스를 앱이라고 추측하지 않는다', async () => {
    const pkg = 'com.example.streaming.debug'
    const outcome = await frameCollector.extract({
      tp: new TraceProcessor('/bin/tp', '/t.pftrace', zygoteRunner()),
      packageName: pkg,
      env: { sdkInt: 35, dataSources: ['android.surfaceflinger.frametimeline'] },
      capture: NO_CAPTURE,
    })

    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'render_process_not_found', detail: { package: pkg } },
    })
  })
})
