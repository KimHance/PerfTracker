import { describe, expect, it } from 'vitest'
import type { Result } from '@perftracker/core'
import { formatSummary } from '../../src/format/summary.js'

function result(overrides: Partial<Result['metrics']['frame']> = {}): Result {
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
          process: 'com.nhn.android.webtoon',
          pid: 24193,
          total_frames: 1412,
          buckets: [],
          within_16_67ms_ratio: 0.874,
          percentiles: { p50: 9.2, p90: 21.4, p95: 28.1, p99: 96.3 },
          mean_ms: 12.8,
          max_ms: 312.4,
        },
        ...overrides,
      },
    },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: null,
      tracing_processes_cpu_share_pct: null,
      tracing_processes_peak_rss_kb: null,
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

  it('프레임 예산이 패널 주사율이 아니라 고정 기준임을 밝힌다', () => {
    // Device 줄에 @120Hz 가 있는데 Frame 줄의 ≤16.67ms 가 그와 연관된 값으로 읽히면 안 된다.
    expect(formatSummary(result())).toContain('≤16.67ms (60fps ref)')
  })

  it('미수집 항목은 사유와 함께 보여준다', () => {
    const out = formatSummary(
      result({
        status: 'unsupported',
        reason_code: 'sdk_too_low',
        reason: 'Android 12 이상이 필요합니다 (기기 sdk_int=30, 최소 sdk_int=31).',
        data: null,
      }),
    )
    expect(out).toContain('unsupported')
    expect(out).toContain('sdk_int=30')
  })

  it('미수집 항목은 기계용 코드도 함께 보여준다', () => {
    const out = formatSummary(
      result({
        status: 'partial',
        reason_code: 'render_process_not_found',
        reason: '대상 앱(com.x)의 렌더 프로세스를 트레이스에서 찾지 못했습니다.',
        data: null,
      }),
    )
    expect(out).toContain('[render_process_not_found]')
  })

  it('좋다/나쁘다 판정을 넣지 않는다', () => {
    expect(formatSummary(result())).not.toMatch(/느림|양호|나쁨|권장|개선|PASS|FAIL/)
  })

  it('관측된 경고를 Notes 로 보여준다', () => {
    expect(formatSummary(result())).toContain('USB 충전 중이었음')
  })
})
