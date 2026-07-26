import { describe, expect, it } from 'vitest'
import type { NetworkData, Result, ThermalData } from '@perftracker/core'
import { formatSummary } from '../../src/format/summary.js'

function result(overrides: Partial<Result['metrics']> = {}): Result {
  const state = {
    captured_at: '2026-07-25T14:32:10.000Z',
    battery_level: 68,
    battery_temp_c: 34.8,
    charging: true,
    connection: 'usb' as const,
    screen_brightness: 131,
    power_save_mode: false,
    network: 'wifi',
    mem_available_kb: 3511516,
    animator_duration_scale: 1,
    thermal_zones: [],
  }
  return {
    schema_version: '1.1.0',
    tool: { name: 'perftracker', version: '0.1.0' },
    session: {
      id: 'a3f9c1',
      name: '홈 스크롤',
      state: 'completed',
      started_at: '2026-07-25T14:32:10.000Z',
      ended_at: '2026-07-25T14:32:52.735Z',
      duration_ms: 42_735,
      options: { launch: true, video: false },
    },
    device: {
      serial: 'S1',
      static: {
        manufacturer: 'samsung',
        model: 'SM-S931N',
        android_release: '16',
        sdk_int: 36,
        build_fingerprint: 'x',
        abis: ['arm64-v8a'],
        soc_model: 'SM8750',
        soc_manufacturer: 'QTI',
        cpu: { core_count: 8, clusters: [] },
        memory_total_kb: 11380228,
        display: {
          width_px: 1080,
          height_px: 2340,
          density_dpi: 480,
          active_refresh_rate_hz: 120,
          supported_refresh_rates_hz: [60, 120],
        },
      },
      state_before: state,
      state_after: state,
    },
    target_app: {
      package: 'com.nhn.android.webtoon',
      label: '네이버 웹툰',
      label_source: 'apk_resources',
      version_name: '2.46.0',
      version_code: 24600400,
      uid: 10359,
      install_source: 'com.android.vending',
      launcher_activity: 'a',
      render_process: 'com.nhn.android.webtoon',
      pid: 1,
    },
    metrics: {
      frame: {
        status: 'collected',
        source: 'perfetto: actual_frame_timeline_slice.dur',
        reason_code: null,
        reason: null,
        data: {
          process: 'com.foo.bar',
          pid: 24193,
          total_frames: 1412,
          buckets: [{ from_ms: 0, to_ms: 5, count: 812 }],
          within_16_67ms_ratio: 0.874,
          percentiles: { p50: 9.2, p90: 21.4, p95: 28.1, p99: 96.3 },
          mean_ms: 12.8,
          max_ms: 312.4,
        },
      },
      startup: {
        status: 'collected',
        source: 'am start -W: TotalTime / LaunchState',
        reason_code: null,
        reason: null,
        data: { total_time_ms: 1842, launch_state: 'COLD' },
      },
      cpu: {
        status: 'collected',
        source: 'perfetto: linux.sys_stats cpu.times.* + ftrace power/cpu_frequency',
        reason_code: null,
        reason: null,
        data: {
          sampled_ms: 42000,
          samples: 42,
          total_busy_pct: 23.1,
          per_core: [
            { cpu: 0, busy_pct: 31.2 },
            { cpu: 1, busy_pct: 15 },
          ],
          frequency: [
            { cpu: 0, samples: 716, min_khz: 300000, max_khz: 2400000, avg_khz: 1820000 },
          ],
        },
      },
      memory: {
        status: 'collected',
        source: 'perfetto: linux.process_stats mem.rss + linux.sys_stats meminfo',
        reason_code: null,
        reason: null,
        data: {
          process: 'com.foo.bar',
          pid: 24193,
          samples: 42,
          rss: { min_kb: 300000, max_kb: 498688, avg_kb: 421888 },
          rss_anon: null,
          rss_file: null,
          rss_watermark_peak_kb: 512000,
          system: {
            mem_total_kb: 11380228,
            mem_available: { min_kb: 3000000, max_kb: 3600000, avg_kb: 3420160 },
            mem_free: { min_kb: 100000, max_kb: 200000, avg_kb: 150000 },
            cached: { min_kb: 800000, max_kb: 900000, avg_kb: 850000 },
            swap_total_kb: 6000000,
            swap_free: { min_kb: 1000000, max_kb: 2000000, avg_kb: 1500000 },
          },
        },
      },
      log: {
        status: 'collected',
        source: 'perfetto: android.log (device-wide, min_prio=PRIO_WARN)',
        reason_code: null,
        reason: null,
        data: {
          min_prio: 'PRIO_WARN',
          total: 142,
          by_priority: { warn: 118, error: 23, fatal: 1 },
          crashes: [],
          anrs: [],
        },
      },
      ...overrides,
    },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: 412,
      tracing_processes_cpu_share_pct: 0.7,
      tracing_processes_peak_rss_kb: 18432,
      adb_commands_during_session: 0,
      trace_buffer_overrun: false,
    },
    references: [],
    warnings: [{ code: 'charging_during_session', message: 'USB 충전 중이었음' }],
    artifacts: { trace: 'trace.perfetto-trace', video: null, raw: [] },
  }
}

describe('formatSummary', () => {
  it('세션·기기·앱 정보를 보여준다', () => {
    const out = formatSummary(result())
    expect(out).toContain('홈 스크롤')
    expect(out).toContain('SM-S931N')
    expect(out).toContain('네이버 웹툰')
  })

  it('프레임 수치를 보여준다', () => {
    const out = formatSummary(result())
    expect(out).toContain('1,412')
    expect(out).toContain('87.4%')
  })

  it('측정 창 안의 adb 호출 수를 보여주되, 무엇을 센 값인지 라벨에 밝힌다', () => {
    // "adb calls during session: 0" 만 쓰면 "아무도 기기를 안 건드렸다" 로 읽히는데
    // 이 카운터는 perftracker 를 통과한 호출만 센다.
    expect(formatSummary(result())).toContain('perftracker adb calls during session: 0')
  })

  /**
   * M4. 아직 stop 하지 않은 세션이다. 여기서 `0.0s` 와 `0` 을 찍으면 요약이
   * "0ms 동안 돌았고 위반도 없었다" 라고 말하게 되는데, 어느 쪽도 사실이 아니다.
   */
  it('stop 전 세션의 길이와 위반 횟수를 0 으로 찍지 않는다', () => {
    const r = result()
    const out = formatSummary({
      ...r,
      session: { ...r.session, state: 'running', ended_at: null, duration_ms: null },
      measurement_overhead: { ...r.measurement_overhead, adb_commands_during_session: null },
    })

    expect(out).toContain('Duration  n/a (stop 전)')
    expect(out).toContain('perftracker adb calls during session: n/a (셀 수 없음)')
    expect(out).not.toContain('Duration  0.0s')
  })

  it('stop 전이라도 셀 수 있었던 위반 횟수는 숫자로 보여준다', () => {
    const r = result()
    const out = formatSummary({
      ...r,
      session: { ...r.session, state: 'running', ended_at: null, duration_ms: null },
      measurement_overhead: { ...r.measurement_overhead, adb_commands_during_session: 2 },
    })

    expect(out).toContain('perftracker adb calls during session: 2')
  })

  it('프레임 예산이 패널 주사율이 아니라 고정 기준임을 밝힌다', () => {
    // Device 줄에 @120Hz 가 있는데 Frame 줄의 ≤16.67ms 가 그와 연관된 값으로 읽히면 안 된다.
    expect(formatSummary(result())).toContain('≤16.67ms (60fps ref)')
  })

  it('미수집 항목은 사유와 함께 보여준다', () => {
    const out = formatSummary(
      result({
        frame: {
          status: 'unsupported',
          source: 'perfetto: actual_frame_timeline_slice.dur',
          reason_code: 'sdk_too_low',
          reason: 'Android 12 이상이 필요합니다 (기기 sdk_int=30, 최소 sdk_int=31).',
          data: null,
        },
      }),
    )
    expect(out).toContain('unsupported')
    expect(out).toContain('sdk_int=30')
  })

  it('미수집 항목은 기계용 코드도 함께 보여준다', () => {
    const out = formatSummary(
      result({
        frame: {
          status: 'partial',
          source: 'perfetto: actual_frame_timeline_slice.dur',
          reason_code: 'render_process_not_found',
          reason: '대상 앱(com.x)의 렌더 프로세스를 트레이스에서 찾지 못했습니다.',
          data: null,
        },
      }),
    )
    expect(out).toContain('[render_process_not_found]')
  })

  it('값이 있는 Frame 에도 사유가 있으면 그 줄을 감추지 않는다', () => {
    // 프로세스 이름을 pid 로 확인한 세션이 정확히 이 모양이다 — 숫자는 다 있는데
    // "그 이름을 어떻게 확인했는가" 라는 단서가 붙는다. 그것을 삼키면 안 된다.
    const r = result()
    const out = formatSummary({
      ...r,
      metrics: {
        ...r.metrics,
        frame: {
          ...r.metrics.frame,
          status: 'partial',
          reason_code: 'process_name_stale_in_trace',
          reason: '트레이스는 이 프로세스(pid 6037)를 "zygote64" 라는 이름으로 기록했습니다.',
        },
      },
    })
    expect(out).toContain('Frame     partial')
    expect(out).toContain('[process_name_stale_in_trace]')
    expect(out).toContain('zygote64')
  })

  it('좋다/나쁘다 판정을 넣지 않는다', () => {
    expect(formatSummary(result())).not.toMatch(/느림|양호|나쁨|권장|개선|PASS|FAIL/)
  })

  it('관측된 경고를 Notes 로 보여준다', () => {
    expect(formatSummary(result())).toContain('USB 충전 중이었음')
  })
})

describe('formatSummary — M2 메트릭', () => {
  it('Startup 을 TotalTime 과 LaunchState 로 보여준다', () => {
    expect(formatSummary(result())).toContain('Startup   collected     TotalTime 1,842ms · COLD')
  })

  it('CPU 는 사용률과 주파수를 한 줄에 함께 보여준다', () => {
    const out = formatSummary(result())
    expect(out).toContain('CPU       collected')
    expect(out).toContain('total busy 23.1%')
    expect(out).toContain('cpu0 1,820MHz')
  })

  it('주파수가 없으면 사용률 옆에 n/a 를 쓰고 사유를 남긴다', () => {
    const out = formatSummary(
      result({
        cpu: {
          status: 'partial',
          source: 'perfetto: linux.sys_stats cpu.times.* + ftrace power/cpu_frequency',
          reason_code: 'cpu_freq_unavailable',
          reason: 'ftrace power/cpu_frequency 이벤트가 없어 주파수를 함께 내지 못했습니다 — 사용률만 있는 값입니다.',
          data: {
            sampled_ms: 42000,
            samples: 42,
            total_busy_pct: 23.1,
            per_core: [{ cpu: 0, busy_pct: 31.2 }],
            frequency: null,
          },
        },
      }),
    )
    expect(out).toContain('CPU       partial')
    expect(out).toContain('freq n/a')
    expect(out).toContain('[cpu_freq_unavailable]')
  })

  it('Memory 를 MB 로 보여준다', () => {
    const out = formatSummary(result())
    expect(out).toContain('RSS avg 412MB · peak 487MB')
    expect(out).toContain('system avail avg 3,340MB')
  })

  it('Log 를 크래시·ANR·우선순위 개수로 보여준다', () => {
    expect(formatSummary(result())).toContain('crash 0 · ANR 0 · E 23 · W 118')
  })

  it('크래시/ANR 을 못 셌으면 0 이라고 찍지 않는다', () => {
    // null 은 "재 봤더니 없었다" 가 아니라 "못 셌다" 다 (이벤트 쿼리 실패).
    const out = formatSummary(
      result({
        log: {
          status: 'partial',
          source: 'perfetto: android.log (device-wide, min_prio=PRIO_WARN)',
          reason_code: 'query_failed',
          reason: '트레이스 쿼리에 실패했습니다: no such table',
          data: {
            min_prio: 'PRIO_WARN',
            total: 142,
            by_priority: { warn: 118, error: 23, fatal: 1 },
            crashes: null,
            anrs: null,
          },
        },
      }),
    )
    expect(out).toContain('crash n/a · ANR n/a')
    expect(out).not.toContain('crash 0')
  })

  it('수집되지 않은 항목은 상태와 사유 코드를 같은 자리에 보여준다', () => {
    const out = formatSummary(
      result({
        log: {
          status: 'partial',
          source: 'perfetto: android.log (device-wide, min_prio=PRIO_WARN)',
          reason_code: 'no_log_entries',
          reason: '트레이스에 로그 항목이 없습니다 (문턱 PRIO_WARN).',
          data: null,
        },
      }),
    )
    expect(out).toContain('Log       partial       [no_log_entries]')
  })

  it('메트릭 키 자체가 없는 1.0.0 결과에서도 죽지 않는다', () => {
    const r = result()
    const metrics = { frame: r.metrics.frame } as Result['metrics']
    const out = formatSummary({ ...r, metrics })
    expect(out).toContain('Frame     collected')
    expect(out).toContain('Startup   not-collected')
  })

  it('Overhead 를 측정값으로 보여준다', () => {
    expect(formatSummary(result())).toContain(
      'Overhead  tracing procs 0.7% CPU (412ms) · 18MB RSS · buffer overrun: no',
    )
  })

  it('오버헤드가 null 이면 숫자를 지어내지 않고 not measured 라고 쓴다', () => {
    const r = result()
    const out = formatSummary({
      ...r,
      measurement_overhead: {
        ...r.measurement_overhead,
        tracing_processes_cpu_time_ms: null,
        tracing_processes_cpu_share_pct: null,
        tracing_processes_peak_rss_kb: null,
      },
    })
    expect(out).toContain('Overhead  tracing procs not measured · buffer overrun: no')
  })

  it('버퍼 오버런을 확인 못 했으면 no 라고 쓰지 않는다', () => {
    // no 는 "확인해 봤더니 안 넘쳤다" 로 읽힌다. 트레이스가 없으면 본 적조차 없다.
    const r = result()
    const out = formatSummary({
      ...r,
      measurement_overhead: { ...r.measurement_overhead, trace_buffer_overrun: null },
    })

    expect(out).toContain('buffer overrun: n/a (확인 못 함)')
    expect(out).not.toContain('buffer overrun: no')
  })

  it('구글 기준선을 터미널에 쓰지 않는다 — references 에만 둔다', () => {
    const out = formatSummary(result())
    expect(out).not.toContain('5,000ms')
    expect(out).not.toContain('5000ms')
  })
})

// ---------------------------------------------------------------------------
// M3 — Thermal / Network
// ---------------------------------------------------------------------------

type Zone = ThermalData['zones'][number]

/** 실기기(SM-S901N) 4세션 중 `02-45-12` 의 실측 8존을 그대로 옮긴 것. */
function realZones(): Zone[] {
  const z = (
    name: string,
    type: number,
    before: number | null,
    after: number | null,
    source: 'hal' | 'cached' = 'hal',
  ): Zone => ({
    name,
    type,
    before_c: before,
    after_c: after,
    delta_c:
      before === null || after === null ? null : Number((after - before).toFixed(1)),
    status_before: 0,
    status_after: after === null ? null : 0,
    source,
  })
  return [
    z('AP', 0, 31.1, 36.2),
    z('BAT', 2, 30.7, 31.6),
    z('PATHM', 5, 33.4, 36.5),
    z('SKIN', 3, 31.1, 32.4),
    z('SUBBAT', 2, 0, 0),
    z('SUBBATRAW', 2, 0, 0),
    z('USB', 4, 30.4, 30.6),
    z('PA1THM', 5, 27, 27, 'cached'),
  ]
}

function thermalMetric(data: Partial<ThermalData> = {}): Result['metrics']['thermal'] {
  return {
    status: 'collected',
    source: 'dumpsys thermalservice: 세션 시작 직전 / 종료 직후 스냅샷의 센서별 온도 차이',
    reason_code: null,
    reason: null,
    data: {
      zones: realZones(),
      device_status_before: 0,
      device_status_after: 0,
      status_override_before: false,
      status_override_after: false,
      hal_ready_before: true,
      hal_ready_after: true,
      headroom_thresholds: [null, 0.8666667, 0.93333334, 1, 1.1333333, 1.4333333, 2.4333334],
      ...data,
    },
  }
}

function networkMetric(data: Partial<NetworkData> = {}): Result['metrics']['network'] {
  return {
    status: 'collected',
    source: 'dumpsys netstats mAppUidStatsMap: 세션 전/후 스냅샷의 uid 행 델타',
    reason_code: null,
    reason: null,
    data: {
      uid: 10388,
      rx_bytes: 1_258_291,
      tx_bytes: 441_344,
      rx_packets: 1119,
      tx_packets: 871,
      shared_uid_packages: ['com.nhn.android.webtoon'],
      ...data,
    },
  }
}

const withThermal = (data: Partial<ThermalData> = {}): Result =>
  result({ thermal: thermalMetric(data) })

const withNetwork = (data: Partial<NetworkData> = {}): Result =>
  result({ network: networkMetric(data) })

const withBoth = (): Result => result({ thermal: thermalMetric(), network: networkMetric() })

describe('formatSummary — Thermal 줄', () => {
  /** 깨지는 조건: 존 개수·기기 전후 상태·HAL 준비 여부 중 하나라도 줄에서 빠지면 실패한다. */
  it('존 개수와 전후 Thermal Status 를 내고 앞 3개 존을 전후·델타로 보여준다', () => {
    const out = formatSummary(withThermal())
    expect(out).toContain('Thermal   collected')
    expect(out).toContain('8 zones')
    expect(out).toContain('Thermal Status 0 → 0')
    // 존이 1개인 기기(에뮬레이터)에서 "1 zones" 라고 쓰지 않는다.
    expect(formatSummary(withThermal({ zones: realZones().slice(0, 1) }))).toContain('1 zone ·')
    expect(out).toContain('HAL ready')
    expect(out).toMatch(/AP 31\.1→36\.2 \(\+5\.1\)/)
  })

  /**
   * 깨지는 조건: 부호를 버리거나 절댓값을 쓰면 실패한다.
   * 실기기 4세션 중 2세션에서 온도가 **내려갔다**. 부호를 잃으면 도구가
   * "발열했다" 는 없던 사실을 말하게 된다.
   */
  it('델타가 음수면 음수로 쓴다 — "발열" 로 바꾸지 않는다', () => {
    const zones = realZones()
    zones[0] = { ...zones[0]!, before_c: 32.1, after_c: 30.8, delta_c: -1.3 }
    const out = formatSummary(withThermal({ zones }))
    expect(out).toContain('(-1.3)')
    expect(out).not.toContain('(+1.3)')
  })

  /**
   * 깨지는 조건: 존을 델타 크기로 정렬하거나 전부 펼치면 실패한다.
   * 순서는 기기가 준 것이고 "어느 존이 중요한가" 는 이 도구가 말하지 않는다.
   */
  it('존이 3개를 넘으면 앞 3개만 쓰고 나머지는 개수로 접는다 — 기기 순서를 지킨다', () => {
    const out = formatSummary(withThermal())
    expect(out).toContain('외 5개')
    // 기기가 준 순서: AP · BAT · PATHM. 델타 순(AP · PATHM · SKIN)이 아니다.
    expect(out).toMatch(/AP 31\.1→36\.2 \(\+5\.1\) · BAT 30\.7→31\.6 \(\+0\.9\) · PATHM/)
    expect(out).not.toContain('PA1THM 27')
  })

  /**
   * M-4. Network 줄은 uid 한정을 터미널까지 들고 가는데 Thermal 줄은 `source` 를 버렸다.
   * `cached` 존의 delta 0 을 "안 변했다" 로 읽는 것이 정확히 이 숫자의 오독이고
   * (실기기 `PA1THM` 은 약 3시간 4세션 8덤프 내내 27.0°C 고정이었다),
   * 요약만 보는 사람이 가장 많다.
   *
   * 표시 비용은 **cached 존이 미리보기에 들어올 때만** 든다. 실기기에서는 HAL 존이 먼저
   * 정렬되어 대개 "외 N개" 로 접히지만 그건 관측이지 보장이 아니다 — HAL 이 존을 적게 주면
   * 미리보기에 들어온다.
   */
  it('미리보기에 cached 존이 오면 그 사실과 뜻을 함께 쓴다', () => {
    // HAL 존이 둘뿐이라 cached 전용 존이 미리보기 안으로 들어오는 기기.
    const zones = [...realZones().slice(0, 2), realZones()[7]!]
    const out = formatSummary(withThermal({ zones }))

    // `signed` 는 0 에 부호를 붙이지 않는다 — 0 은 오르지도 내리지도 않은 값이다.
    expect(out).toContain('PA1THM 27.0→27.0 (0.0, cached)')
    // 단어만 붙이면 장식이다 — 그 뜻이 오독을 막는다.
    expect(out).toMatch(/갱신이 올 때만 바뀌는 값/)
  })

  /** 대가가 있는 표시다. cached 존이 안 보이면 한 글자도 붙지 않아야 한다. */
  it('미리보기가 전부 hal 이면 아무것도 붙이지 않는다 — 없는 줄을 길게 만들지 않는다', () => {
    // 기본 realZones() 의 앞 3개는 전부 hal 이고 PA1THM 은 "외 5개" 로 접힌다.
    const out = formatSummary(withThermal())
    expect(out).not.toContain('cached')
    expect(out).toMatch(/AP 31\.1→36\.2 \(\+5\.1\) · BAT/)
  })

  /** 깨지는 조건: after 가 없는 존에 0 을 쓰면 실패한다. null 은 "없다" 지 0 이 아니다. */
  it('after 가 없는 존은 "n/a" 로 쓴다 — 0 이 아니다', () => {
    const zones = realZones()
    zones[0] = { ...zones[0]!, after_c: null, delta_c: null, status_after: null }
    const out = formatSummary(withThermal({ zones }))
    expect(out).toContain('31.1→n/a')
    expect(out).not.toContain('31.1→0.0')
  })

  /** 깨지는 조건: data 가 null 인데 값 줄을 내려고 하면 죽거나 빈 줄이 된다. */
  it('값이 없으면 status 와 reason_code 줄이 나온다', () => {
    const out = formatSummary(
      result({
        thermal: {
          status: 'partial',
          source: 'dumpsys thermalservice',
          reason_code: 'snapshot_unavailable',
          reason: '세션 종료 스냅샷(raw/thermalservice_after.txt)이 없습니다.',
          data: null,
        },
      }),
    )
    expect(out).toContain('Thermal   partial')
    expect(out).toContain('[snapshot_unavailable]')
  })

  /** 깨지는 조건: HAL 준비 여부를 확인 못 했는데 "not ready" 로 단정하면 실패한다. */
  it('hal_ready 가 null 이면 n/a 다 — "not ready" 로 단정하지 않는다', () => {
    const out = formatSummary(withThermal({ hal_ready_before: null }))
    expect(out).toContain('HAL n/a')
    expect(out).not.toContain('HAL not ready')
  })

  /** 깨지는 조건: 기기 상태를 못 읽었는데 0(=NONE) 으로 채우면 실패한다. */
  it('device_status 가 null 이면 0 이 아니라 n/a 로 쓴다', () => {
    const out = formatSummary(withThermal({ device_status_after: null }))
    expect(out).toContain('Thermal Status 0 → n/a')
  })
})

describe('formatSummary — Network 줄', () => {
  /** 깨지는 조건: 바이트만 쓰고 패킷을 버리거나, 델타가 아닌 누적으로 읽히면 실패한다. */
  it('rx/tx 를 바이트 단위와 패킷 수로 함께 쓴다', () => {
    const out = formatSummary(withNetwork())
    expect(out).toContain('Network   collected')
    expect(out).toMatch(/rx 1\.2MB \/ 1,119pk/)
    expect(out).toMatch(/tx 431KB \/ 871pk/)
    expect(out).toContain('세션 델타')
  })

  /**
   * 깨지는 조건: uid 한정이 터미널에서 사라지면 실패한다.
   * 요약만 보는 사람이 가장 많고, "이 앱이 1.2MB 를 썼다" 로 읽는 것이
   * 정확히 이 숫자의 오독이다.
   */
  it('uid 와 그 uid 를 쓰는 패키지 수를 함께 쓴다', () => {
    const out = formatSummary(withNetwork({ shared_uid_packages: ['a', 'b'] }))
    expect(out).toContain('uid')
    expect(out).toContain('10388')
    expect(out).toContain('2개')
  })

  /**
   * 실기기에서 uid 1000 을 **86개** 패키지가 공유한다. 86개 이름을 한 줄에 쏟으면 요약이
   * 요약이 아니게 되므로 터미널에서만 자른다 — **`result.json` 은 전부 싣는다.**
   *
   * 자르되 **숫자는 먼저 말한다.** 개수가 이 줄의 요점이기 때문이다. 그리고 잘랐다는 사실을
   * 반드시 남긴다: 잘린 목록을 잘리지 않은 것처럼 보이게 하면 이 도구가 하지 않기로 한
   * 바로 그 일(관측하지 않은 것을 사실처럼 보이게 하기)이 된다.
   *
   * 깨지는 조건: 자르면서 "…" 표시를 빼거나, 개수를 목록 길이로 바꾸면 실패한다.
   */
  it('공유 패키지가 많으면 목록만 자르고 개수와 생략 사실을 남긴다', () => {
    const many = Array.from({ length: 86 }, (_, i) => `com.example.p${String(i)}`)
    const out = formatSummary(withNetwork({ shared_uid_packages: many }))

    expect(out).toContain('86개')
    expect(out).toContain('com.example.p0')
    // 마지막 것까지 다 찍으면 자르지 않은 것이다.
    expect(out).not.toContain('com.example.p85')
    // 잘렸다는 사실이 줄 안에 있어야 한다.
    expect(out).toMatch(/외 \d+개는 result\.json/)
    // 요약 한 줄이 터미널을 뒤덮지 않는다.
    const uidLine = out.split('\n').find((l) => l.includes('86개'))!
    expect(uidLine.length).toBeLessThan(200)
  })

  /** 깨지는 조건: null 을 `[]` 처럼 취급해 "0개"/"1개" 를 찍으면 실패한다. */
  it('shared_uid_packages 가 null 이면 "확인 안 됨" 이라고 쓴다 — "1개" 가 아니다', () => {
    const out = formatSummary(withNetwork({ shared_uid_packages: null }))
    expect(out).toContain('확인 안 됨')
    expect(out).not.toMatch(/패키지 \d+개/)
  })

  /**
   * 깨지는 조건: 0 을 "못 쟀다" 로 접으면 실패한다.
   * **조회했고 관측된 변화가 없어서 나온 0 은 정직한 0 이다** — null 과 반대다.
   */
  it('0 바이트도 collected 면 0 으로 쓴다 — 조회한 0 은 사실이다', () => {
    const out = formatSummary(
      withNetwork({ rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 }),
    )
    expect(out).toContain('rx 0B')
    expect(out).not.toContain('rx n/a')
  })

  /** 깨지는 조건: data 가 null 인데 값 줄을 내려고 하면 죽거나 빈 줄이 된다. */
  it('값이 없으면 status 와 reason_code 줄이 나온다', () => {
    const out = formatSummary(
      result({
        network: {
          status: 'unsupported',
          source: 'dumpsys netstats mAppUidStatsMap',
          reason_code: 'sdk_too_low',
          reason: 'Android 14 이상이 필요합니다 (기기 sdk_int=33, 최소 sdk_int=34).',
          data: null,
        },
      }),
    )
    expect(out).toContain('Network   unsupported')
    expect(out).toContain('[sdk_too_low]')
  })
})

describe('formatSummary — M3 이 요약 계약을 깨지 않는다', () => {
  /** 깨지는 조건: 두 줄이 Overhead 뒤로 밀리거나 Log 앞으로 올라오면 실패한다. */
  it('여덟 줄이 Frame → Startup → CPU → Memory → Log → Thermal → Network → Overhead 순이다', () => {
    const out = formatSummary(withBoth())
    const order = ['Frame', 'Startup', 'CPU', 'Memory', 'Log', 'Thermal', 'Network', 'Overhead']
    const at = order.map((label) =>
      out.split('\n').findIndex((l) => l.startsWith(label)),
    )
    for (const i of at) expect(i).toBeGreaterThanOrEqual(0)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  /** 깨지는 조건: 새 두 줄에 평가어가 섞이면 실패한다. */
  it('Thermal / Network 줄에도 판정 언어가 없다', () => {
    const out = formatSummary(withBoth())
    expect(out).not.toMatch(/느림|양호|나쁨|높음|초과|권장|개선|발열|과열|PASS|FAIL/)
  })

  /** 깨지는 조건: 키가 없는 옛 결과에서 죽으면 실패한다. */
  it('thermal / network 키가 없는 결과도 죽지 않는다', () => {
    const out = formatSummary(result())
    expect(out).toContain('Thermal   not-collected')
    expect(out).toContain('Network   not-collected')
  })
})
