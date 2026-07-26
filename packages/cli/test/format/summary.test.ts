import { describe, expect, it } from 'vitest'
import type { Result } from '@perftracker/core'
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
