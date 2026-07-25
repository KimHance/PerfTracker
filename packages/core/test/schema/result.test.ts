import { describe, expect, it } from 'vitest'
import { resultJsonSchema } from '../../src/schema/jsonSchema.js'
import { REFERENCES } from '../../src/schema/references.js'
import { ResultSchema, SCHEMA_VERSION } from '../../src/schema/result.js'

function minimalResult() {
  const state = {
    captured_at: '2026-07-25T14:32:10.000+09:00',
    battery_level: 68,
    battery_temp_c: 34.8,
    charging: true,
    connection: 'usb' as const,
    screen_brightness: 131,
    power_save_mode: false,
    network: 'wifi',
    mem_available_kb: 3511516,
    animator_duration_scale: 1,
    thermal_zones: [{ name: 'AP', celsius: 37.1 }],
  }
  return {
    schema_version: SCHEMA_VERSION,
    tool: { name: 'perftracker', version: '0.1.0' },
    session: {
      id: 'a3f9c1',
      name: '홈 스크롤',
      state: 'completed' as const,
      started_at: '2026-07-25T14:32:10.000+09:00',
      ended_at: '2026-07-25T14:32:52.735+09:00',
      duration_ms: 42735,
      options: { launch: true, video: false },
    },
    device: {
      serial: 'R3CY0000002',
      static: {
        manufacturer: 'samsung',
        model: 'SM-S931N',
        android_release: '16',
        sdk_int: 36,
        build_fingerprint: 'samsung/pa1qksx/pa1q:16/BP4A.251205.006/x:user/release-keys',
        abis: ['arm64-v8a'],
        soc_model: 'SM8750',
        soc_manufacturer: 'QTI',
        cpu: { core_count: 8, clusters: [{ cpus: [0, 1, 2, 3, 4, 5], max_freq_khz: 3532800 }] },
        memory_total_kb: 11380228,
        display: {
          width_px: 1080,
          height_px: 2340,
          density_dpi: 480,
          active_refresh_rate_hz: 120,
          supported_refresh_rates_hz: [10, 24, 30, 48, 60, 80, 120],
        },
      },
      state_before: state,
      state_after: state,
    },
    target_app: {
      package: 'com.nhn.android.webtoon',
      label: '네이버 웹툰',
      label_source: 'apk_resources' as const,
      version_name: '2.46.0',
      version_code: 24600400,
      uid: 10359,
      install_source: 'com.android.vending',
      launcher_activity: 'com.naver.webtoon.splash.SplashActivity',
      render_process: 'com.nhn.android.webtoon',
      pid: 24193,
    },
    metrics: {
      frame: {
        status: 'collected' as const,
        source: 'perfetto: actual_frame_timeline_slice.dur',
        reason_code: null,
        reason: null,
        data: {
          process: 'com.nhn.android.webtoon',
          pid: 24193,
          total_frames: 450,
          buckets: [{ from_ms: 0, to_ms: 5, count: 12 }],
          within_16_67ms_ratio: 0.874,
          percentiles: { p50: 9.2, p90: 21.4, p95: 28.1, p99: 96.3 },
          mean_ms: 12.8,
          max_ms: 312.4,
        },
      },
    },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: null,
      tracing_processes_cpu_share_pct: null,
      tracing_processes_peak_rss_kb: null,
      adb_commands_during_session: 0,
      trace_buffer_overrun: false,
    },
    references: REFERENCES,
    warnings: [{ code: 'charging_during_session', message: 'USB 충전 중이었음' }],
    artifacts: { trace: 'trace.perfetto-trace', video: null, raw: ['raw/battery_before.txt'] },
  }
}

describe('ResultSchema', () => {
  it('완전한 결과를 통과시킨다', () => {
    expect(() => ResultSchema.parse(minimalResult())).not.toThrow()
  })

  it('미지원 메트릭은 data 가 null 이어도 통과한다', () => {
    const r = minimalResult()
    r.metrics.frame = {
      status: 'unsupported',
      source: 'perfetto: actual_frame_timeline_slice.dur',
      reason_code: 'sdk_too_low',
      reason: 'Android 12 이상이 필요합니다 (기기 sdk_int=30, 최소 sdk_int=31).',
      data: null,
    } as never
    expect(() => ResultSchema.parse(r)).not.toThrow()
  })

  it('알 수 없는 status 는 거부한다', () => {
    const r = minimalResult()
    r.metrics.frame.status = 'good' as never
    expect(() => ResultSchema.parse(r)).toThrow()
  })

  it('700+ 버킷은 to_ms 가 null 이다', () => {
    const r = minimalResult()
    r.metrics.frame.data!.buckets = [{ from_ms: 700, to_ms: null, count: 3 }] as never
    expect(() => ResultSchema.parse(r)).not.toThrow()
  })
})

describe('REFERENCES', () => {
  it('모든 항목이 출처 URL 을 갖는다', () => {
    expect(REFERENCES.length).toBeGreaterThan(0)
    for (const ref of REFERENCES) expect(ref.url).toMatch(/^https:\/\//)
  })
})

describe('resultJsonSchema', () => {
  it('object 타입 JSON Schema 를 만든다', () => {
    const schema = resultJsonSchema()
    expect(schema['type']).toBe('object')
    expect((schema['properties'] as Record<string, unknown>)['schema_version']).toBeDefined()
    expect((schema['properties'] as Record<string, unknown>)['metrics']).toBeDefined()
  })
})
