import { describe, expect, it } from 'vitest'
import {
  bucketFrames,
  buildFrameBuckets,
  buildFrameTimeline,
  buildJank,
  frameCollector,
  frameJankSql,
  frameSamplesSql,
  percentile,
} from '../../src/collectors/frame/index.js'
import { FRAME_PROCESS_SQL } from '../../src/collectors/frame/index.js'
import type { CaptureFacts } from '../../src/collectors/types.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

/**
 * `--launch` 없이 시작한 세션. 그런 세션에는 앱의 pid 를 알 기회가 없으므로 `appPid` 는 null 이다
 * (그리고 그때는 앱이 트레이스 시작 전부터 떠 있어 이름이 이미 확정돼 있다).
 */
const NO_CAPTURE: CaptureFacts = {
  startup: null,
  launchRequested: false,
  appPid: null,
  snapshots: {},
}

describe('buildFrameBuckets', () => {
  it('스펙이 정한 61개 버킷을 만든다', () => {
    expect(buildFrameBuckets()).toHaveLength(61)
  })

  /**
   * **꼬리 경계를 값으로 못 박는다.** 개수(61)만 세면 130 이상을 어떻게 잘랐는지가
   * 테스트에 안 남고, 폭을 바꿔도 개수만 맞으면 통과한다. 여기가 이 파일에서 실제로
   * 판단이 들어간 유일한 자리라 값으로 적는다.
   */
  it('130ms 이상은 30 → 50 → 100ms 로 넓어진다', () => {
    const tail = buildFrameBuckets()
      .filter((b) => b.from_ms >= 130)
      .map((b) => b.from_ms)

    expect(tail).toEqual([130, 160, 190, 220, 250, 300, 350, 400, 450, 500, 600, 700])
  })

  it('130ms 미만은 그대로다 — 60fps 16.67ms 가 사는 구간이라 건드리지 않는다', () => {
    const head = buildFrameBuckets().filter((b) => b.from_ms < 130)
    expect(head).toHaveLength(49)
    // 16~18 버킷이 그 자리에 그대로 있어야 한다.
    expect(head.some((b) => b.from_ms === 16 && b.to_ms === 18)).toBe(true)
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

describe('frameSamplesSql', () => {
  /**
   * 이 필터가 없으면 미완결 프레임(`dur = -1`)이 **가장 빠른 버킷에 앉는다** — 끝나지 않은
   * 프레임이 0ms 대의 초고속 프레임으로 집계되어 분포가 실제보다 좋은 쪽으로 기운다.
   */
  it('미완결 slice(dur = -1) 를 SQL 단계에서 거른다', () => {
    expect(frameSamplesSql(2)).toContain('dur >= 0')
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
    expect(frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] }).join('\n')).toContain('android.surfaceflinger.frametimeline')
  })

  it('TraceConfig 블록에 linux.process_stats 도 들어간다 — 프로세스 이름 해석에 필요하다', () => {
    const text = frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] }).join('\n')
    expect(text).toContain('linux.process_stats')
    expect(text).toContain('proc_stats_poll_ms: 1000')
    expect(text).toContain('scan_all_processes_on_start: true')
  })

  it('내는 블록은 저부하 불변식을 통과한다 (폴링 주기 1000ms 이상)', () => {
    expect(() =>
      buildTraceConfig({ dataSourceBlocks: frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] }) }),
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
      .on(`query /t.pftrace ${frameSamplesSql(2)}`, {
        // [상대초, dur_ns] — 0초에 3장, 1초에 1장.
        stdout: '"j"\n"[[0,8000000],[0,20000000],[0,4000000],[1,900000000]]"\n',
      })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    const outcome = await frameCollector.extract({
      tp,
      packageName: pkg,
      appUid: null,
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
        appUid: null,
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
      .on(`query /t.pftrace ${frameSamplesSql(2)}`, { stdout: '"j"\n"[]"\n' })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    await expect(
      frameCollector.extract({
        tp,
        packageName: pkg,
        appUid: null,
        env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
        capture: NO_CAPTURE,
      }),
    ).resolves.toEqual({ collected: false, reason: { code: 'no_frames', detail: { process: pkg } } })
  })

  /**
   * M9. `bucketFrames` 가 던지는 `RangeError` 는 `runCollector` 의 포괄 catch 에 걸려
   * `query_failed` 로 렌더됐다 — "트레이스 쿼리에 실패했습니다: 프레임 duration 이 버킷 범위
   * 밖입니다" 라는, 원인을 잘못 짚는 문장이 된다. 쿼리는 성공했다.
   * SQL 의 `dur >= 0` 때문에 도달하기 어렵지만, 도달하면 사유가 틀리는 것이 문제다.
   */
  it('버킷 범위 밖 duration 은 쿼리 실패가 아니라 그 자체의 사유로 낸다', async () => {
    const pkg = 'com.nhn.android.webtoon'
    const runner = new FakeProcessRunner()
      .on(`query /t.pftrace ${FRAME_PROCESS_SQL}`, {
        stdout: `"j"\n"[{"upid":2,"pid":24193,"name":"${pkg}","frames":2}]"\n`,
      })
      .on(`query /t.pftrace ${frameSamplesSql(2)}`, {
        stdout: '"j"\n"[[0,8000000],[0,-1000000]]"\n',
      })
    const tp = new TraceProcessor('/bin/tp', '/t.pftrace', runner)

    await expect(
      frameCollector.extract({
        tp,
        packageName: pkg,
        appUid: null,
        env: { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] },
        capture: NO_CAPTURE,
      }),
    ).resolves.toEqual({
      collected: false,
      reason: { code: 'frame_duration_out_of_range', detail: { process: pkg, duration_ms: -1 } },
    })
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
      .on(`query /t.pftrace ${frameSamplesSql(309)}`, {
        stdout: '"j"\n"[[0,8000000],[0,20000000],[0,4000000]]"\n',
      })
  }

  const LAUNCHED: CaptureFacts = {
    startup: { totalTimeMs: 12457, launchState: 'COLD' },
    launchRequested: true,
    appPid: 6037,
    snapshots: {},
  }

  it('트레이스 이름이 zygote64 로 굳어도 캡처한 pid 로 앱을 찾고, 그 이름을 쓰지 않는다', async () => {
    const pkg = 'com.example.streaming.debug'
    const outcome = await frameCollector.extract({
      tp: new TraceProcessor('/bin/tp', '/t.pftrace', zygoteRunner()),
      packageName: pkg,
      appUid: null,
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
      appUid: null,
      env: { sdkInt: 35, dataSources: ['android.surfaceflinger.frametimeline'] },
      capture: NO_CAPTURE,
    })

    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'render_process_not_found', detail: { package: pkg } },
    })
  })
})

describe('buildFrameTimeline', () => {
  it('같은 초의 프레임을 한 점으로 묶는다', () => {
    const t = buildFrameTimeline([
      { second: 0, durationMs: 8 },
      { second: 0, durationMs: 12 },
      { second: 1, durationMs: 20 },
    ])

    expect(t).toEqual([
      { t_s: 0, count: 2, p50_ms: 8, max_ms: 12 },
      { t_s: 1, count: 1, p50_ms: 20, max_ms: 20 },
    ])
  })

  /**
   * 0 으로 채우면 "그 초에 한 장도 못 그렸다" 와 "그 초의 표본이 없다" 가 같은 모양이 된다.
   * 앱이 화면을 안 바꾸면 프레임이 아예 안 나오는 것이 정상이라 둘 다 실제로 일어난다.
   */
  it('값이 없는 초를 0 으로 채우지 않는다 — 배열에서 빠진다', () => {
    const t = buildFrameTimeline([
      { second: 0, durationMs: 8 },
      { second: 5, durationMs: 8 },
    ])

    expect(t.map((p) => p.t_s)).toEqual([0, 5])
  })

  it('초 순서대로 낸다 — 입력이 뒤섞여 있어도', () => {
    const t = buildFrameTimeline([
      { second: 3, durationMs: 8 },
      { second: 1, durationMs: 8 },
      { second: 2, durationMs: 8 },
    ])

    expect(t.map((p) => p.t_s)).toEqual([1, 2, 3])
  })

  it('세션 전체와 같은 백분위 함수를 쓴다', () => {
    const durations = [1, 2, 3, 4, 5]
    const t = buildFrameTimeline(durations.map((ms) => ({ second: 0, durationMs: ms })))

    // 같은 입력을 percentile 에 직접 넣은 값과 일치해야 한다. 규칙이 갈리면 여기서 깨진다.
    expect(t[0]!.p50_ms).toBe(percentile(durations, 50))
  })

  it('빈 입력은 빈 배열', () => {
    expect(buildFrameTimeline([])).toEqual([])
  })

  /** 모든 시계열이 같은 0 초를 써야 겹쳐 볼 수 있다. */
  it('SQL 이 trace_bounds 를 기준점으로 쓴다 — 지표마다 다른 0 초를 쓰지 않는다', () => {
    expect(frameSamplesSql(7)).toContain('select start_ts from trace_bounds')
    expect(frameSamplesSql(7)).toContain('dur >= 0')
  })

  /**
   * **한 줄이 화면에 나간 프레임 하나여야 한다.** 레이어마다 세면 실측에서 2.4배가 됐고
   * (행 6,932 vs 프레임 2,875) 빈 배경 레이어가 0–5ms 칸에 몰려 분포 모양까지 바뀌었다.
   */
  it('화면 갱신 하나로 접는다 — 레이어마다 세지 않는다', () => {
    expect(frameSamplesSql(7)).toContain('group by display_frame_token')
    // 그 프레임을 위해 앱이 쓴 시간 = 가장 오래 걸린 레이어.
    expect(frameSamplesSql(7)).toContain('max(dur)')
  })

  /**
   * 분포와 꼬리표가 **같은 대표 행**을 봐야 한다. 한쪽만 레이어를 전부 세면 분모가 갈려
   * 비율이 조용히 어긋난다.
   */
  it('꼬리표도 같은 대표 행을 쓴다', () => {
    expect(frameJankSql(7)).toContain('partition by display_frame_token')
    expect(frameJankSql(7)).toContain('order by dur desc')
    expect(frameJankSql(7)).toContain('rn = 1')
  })
})

/**
 * 실기기(SM-S901N / Stream 24초) 트레이스가 실제로 낸 모양이다. 꼬리표가 **집합**이라
 * 한 프레임이 여러 줄에 세어지는 것이 이 데이터의 핵심이고, 여기가 그것을 고정한다.
 */
const JANK_ROWS = [
  { type: 'Buffer Stuffing', onTime: true, count: 1347 },
  { type: 'None', onTime: true, count: 199 },
  { type: 'None', onTime: false, count: 41 },
  { type: 'App Deadline Missed, Buffer Stuffing', onTime: false, count: 144 },
  { type: 'Dropped Frame', onTime: false, count: 101 },
]

describe('buildJank', () => {
  it('꼬리표가 겹치면 각각에 센다 — 하나만 고르면 나머지가 사라진다', () => {
    const j = buildJank(JANK_ROWS)!
    const byType = Object.fromEntries(j.by_type.map((r) => [r.type, r.count]))

    // `App Deadline Missed, Buffer Stuffing` 144장은 두 꼬리표 **양쪽**에 들어간다.
    expect(byType['Buffer Stuffing']).toBe(1347 + 144)
    expect(byType['App Deadline Missed']).toBe(144)
    expect(byType['Dropped Frame']).toBe(101)
    // 읽는 쪽이 가장 먼저 보는 값이라 경로를 찾게 하지 않고 따로 센다.
    expect(buildJank(JANK_ROWS)!.dropped_frames).toBe(101)
  })

  it('by_type 의 합이 janky_frames 를 넘는 것이 정상이다', () => {
    const j = buildJank(JANK_ROWS)!
    expect(j.janky_frames).toBe(1347 + 144 + 101)
    expect(j.by_type.reduce((n, r) => n + r.count, 0)).toBeGreaterThan(j.janky_frames)
  })

  it('None 은 꼬리표가 아니다 — janky 에도 by_type 에도 넣지 않는다', () => {
    const j = buildJank(JANK_ROWS)!
    expect(j.by_type.some((r) => r.type === 'None')).toBe(false)
    expect(j.total_frames).toBe(1347 + 199 + 41 + 144 + 101)
  })

  it('late 는 janky 와 다른 사실이다 — None 인데 늦은 프레임이 실재한다', () => {
    const j = buildJank(JANK_ROWS)!
    // 꼬리표 없이 늦은 41장 + 꼬리표 붙고 늦은 144·101장.
    expect(j.late_frames).toBe(41 + 144 + 101)
    expect(j.late_frames).not.toBe(j.janky_frames)
  })

  it('많은 순으로 낸다', () => {
    const counts = buildJank(JANK_ROWS)!.by_type.map((r) => r.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it('못 읽었으면 null 이다 — 빈 배열(문제 없었다)과 다른 말이다', () => {
    expect(buildJank(null)).toBeNull()
    expect(buildJank([{ type: 'None', onTime: true, count: 10 }])).toEqual({
      total_frames: 10,
      janky_frames: 0,
      late_frames: 0,
      dropped_frames: 0,
      by_type: [],
    })
  })

  it('꼬리표 질의도 미완결 프레임을 같은 규칙으로 제외한다', () => {
    // `dur >= 0` 이 빠지면 표본 질의와 분모가 달라져 비율이 조용히 틀어진다.
    expect(frameJankSql(7)).toContain('dur >= 0')
  })
})
