import { describe, expect, it } from 'vitest'
import { resultJsonSchema } from '../../src/schema/jsonSchema.js'
import { REFERENCES } from '../../src/schema/references.js'
import { METRIC_REASON_CODES } from '../../src/schema/reasons.js'
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

  it('references 는 출처 URL 이 있는 항목만 담는다 — 근거 없는 기준선은 곧 판정이다', () => {
    for (const ref of REFERENCES) {
      expect(ref.url.startsWith('https://')).toBe(true)
      expect(ref.source.length).toBeGreaterThan(0)
    }
  })

  it('startup 기준선 세 개가 들어 있다', () => {
    const startup = REFERENCES.filter((r) => r.metric === 'startup')
    expect(startup.map((r) => r.value).sort((a, b) => a - b)).toEqual([1500, 2000, 5000])
  })
})

describe('resultJsonSchema', () => {
  const props = (node: unknown): Record<string, any> =>
    (node as Record<string, any>)['properties'] as Record<string, any>

  it('object 타입 JSON Schema 를 만든다', () => {
    const schema = resultJsonSchema()
    expect(schema['type']).toBe('object')
    expect(props(schema)['schema_version']).toBeDefined()
    expect(props(schema)['metrics']).toBeDefined()
  })

  it('reason_code 의 값 집합을 스키마에 실어 보낸다 — CI 매처가 매칭할 대상이다', () => {
    const frame = props(props(resultJsonSchema())['metrics'])['frame']
    const reasonCode = JSON.stringify(props(frame)['reason_code'])

    for (const code of METRIC_REASON_CODES) expect(reasonCode).toContain(code)
    // "안정적인 키" 라고 말만 하고 type: string 만 내보내면 소비자는 알 길이 없다.
    expect(reasonCode).not.toBe('{"type":["string","null"]}')
  })

  it('adb_commands_during_session 의 한계를 description 으로 함께 내보낸다', () => {
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const field = props(overhead)['adb_commands_during_session'] as { description?: string }

    expect(field.description).toBeDefined()
    // 이 필드를 가장 잘못 읽기 쉬운 소비자가 스키마만 읽는 CI 와 LLM 이다.
    expect(field.description).toContain('perftracker')
    expect(field.description).toMatch(/역은 성립하지 않는다/)
  })

  it('오버헤드 세 필드의 주의사항을 스키마에 실어 보낸다 — 가장 오해하기 쉬운 숫자들이다', () => {
    const overhead = props(resultJsonSchema())['measurement_overhead']
    for (const [field, phrase] of [
      ['tracing_processes_cpu_time_ms', '10ms'],
      ['tracing_processes_cpu_share_pct', 'cpu.times'],
      ['tracing_processes_peak_rss_kb', '상계'],
    ] as const) {
      const f = props(overhead)[field] as { description?: string }
      expect(f.description, `${field} 설명 없음`).toContain(phrase)
    }
  })

  it('perfetto CLI 가 안 잡히는 것을 보장이 아니라 관측으로 적는다', () => {
    // B-3. perfetto 는 TRACING_PROCESS_NAMES 에 들어 있으므로, 잡히면 세어진다.
    // "잡히지 않는다" 는 우리가 지킬 수 있는 약속이 아니라 지금까지의 관측이다.
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const d = (props(overhead)['tracing_processes_cpu_time_ms'] as { description?: string })
      .description!

    expect(d).toContain('perfetto')
    expect(d).not.toMatch(/잡히지 않는다\./)
    expect(d).toMatch(/관측|실측/)
  })

  it('peak RSS 가 1초 표본의 최댓값이라는 사실까지 적는다', () => {
    // B-4. 프로세스별 최댓값을 더한 것이 상계라는 설명만으로는 부족하다 —
    // 각 최댓값 자체가 1초 주기 표본의 최댓값이라 표본 사이의 순간 최고점은 안 보인다.
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const d = (props(overhead)['tracing_processes_peak_rss_kb'] as { description?: string })
      .description!

    expect(d).toContain('상계')
    expect(d).toMatch(/1초|1,000ms|1000ms/)
  })

  /**
   * B-1/B-2. `resultJsonSchema` 는 `z.toJSONSchema` 라 **소스 주석을 못 본다.**
   * log 의 숫자들이 기기 전역이라는 사실이 `//` 주석에만 있으면, 스키마만 읽는 CI 와 LLM 은
   * `crashes` 를 대상 앱의 크래시로 읽는다. 그 오독이 이 필드의 기본값이 되면 안 된다.
   */
  const logProps = (): Record<string, any> => {
    // data 는 nullable 이라 anyOf 로 나온다 — object 쪽 가지를 찾아 들어간다.
    const data = props(props(props(resultJsonSchema())['metrics'])['log'])['data'] as {
      anyOf?: Record<string, any>[]
    }
    const object = data.anyOf?.find((b) => b['type'] === 'object') ?? data
    return props(object)
  }

  it('log 의 모든 숫자 필드가 기기 전역임을 스키마에서 말한다', () => {
    for (const field of ['total', 'crashes', 'anrs']) {
      const f = logProps()[field] as { description?: string }
      expect(f.description, `${field} 설명 없음`).toBeDefined()
      expect(f.description, `${field} 가 범위를 안 밝힘`).toContain('기기 전역')
    }
    const byPriority = logProps()['by_priority'] as { description?: string }
    expect(byPriority.description).toContain('기기 전역')
  })

  it('log 의 min_prio 가 개수의 전제임을 스키마에서 말한다', () => {
    expect((logProps()['min_prio'] as { description?: string }).description).toContain('문턱')
  })

  it('crashes/anrs 가 잘릴 수 있다는 사실을 스키마에 싣는다', () => {
    for (const field of ['crashes', 'anrs']) {
      const f = logProps()[field] as { description?: string }
      expect(f.description, `${field} 가 상한을 안 밝힘`).toContain('200')
      expect(f.description).toContain('log_events_truncated')
    }
  })

  it('JSON 으로 직렬화된다 (perftracker schema 가 그대로 출력한다)', () => {
    expect(() => JSON.parse(JSON.stringify(resultJsonSchema()))).not.toThrow()
  })

  it('다섯 메트릭이 모두 JSON Schema 에 실린다 — catchall 로 뭉개지지 않는다', () => {
    const metrics = props(props(resultJsonSchema())['metrics'])
    for (const id of ['frame', 'startup', 'cpu', 'memory', 'log']) {
      expect(metrics[id], `${id} 가 스키마에 없음`).toBeDefined()
    }
  })

  it('frame 만 required 다 — 1.0.0 문서가 계속 유효해야 한다', () => {
    const metrics = props(resultJsonSchema())['metrics'] as { required?: string[] }
    expect(metrics.required).toEqual(['frame'])
  })
})
