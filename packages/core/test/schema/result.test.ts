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

  /**
   * D8: `type`/`status` 를 required 로 넣으면 M3 이전 문서가 통째로 깨진다. 그것은 major 다.
   * optional 로 넣었다는 사실을 여기서 고정한다 — 누가 `.optional()` 을 지우면 실패한다.
   */
  it('M3 이전의 thermal_zones({name, celsius})만 있는 문서도 통과한다', () => {
    const legacy = minimalResult()
    legacy.device.state_before.thermal_zones = [{ name: 'AP', celsius: 37.1 }]
    expect(ResultSchema.safeParse(legacy).success).toBe(true)
  })

  /**
   * zod 는 기본적으로 모르는 키를 **조용히 버린다.** 스키마를 안 넓히면 파싱은 성공하면서
   * `type`/`status` 만 사라진다 — 결함이 통과하는 가장 나쁜 모양이다. 그래서 통과 여부가
   * 아니라 **살아남은 값**을 단언한다.
   */
  it('type/status 가 붙은 새 문서도 통과하고, 그 값이 결과에 남는다', () => {
    const next = minimalResult()
    next.device.state_before.thermal_zones = [
      { name: 'AP', celsius: 37.1, type: 0, status: 0 },
    ] as never
    const parsed = ResultSchema.safeParse(next)
    expect(parsed.success).toBe(true)
    expect(parsed.data!.device.state_before.thermal_zones[0]).toEqual({
      name: 'AP',
      celsius: 37.1,
      type: 0,
      status: 0,
    })
  })

  /**
   * D4: "각 존은 어느 섹션에서 왔는지 `source` 로 들고 다닌다." 이 값이 없으면 소비자는
   * cached 존의 값이 갱신되지 않은 것일 수 있다는 사실에 도달할 수 없다.
   */
  it('source 가 붙은 문서도 통과하고 그 값이 결과에 남는다', () => {
    const next = minimalResult()
    next.device.state_before.thermal_zones = [
      { name: 'PA1THM', celsius: 27, type: 5, status: 0, source: 'cached' },
    ] as never
    const parsed = ResultSchema.safeParse(next)
    expect(parsed.success).toBe(true)
    expect(parsed.data!.device.state_before.thermal_zones[0]?.source).toBe('cached')
  })

  /** 벤더가 mType/mStatus 를 안 찍는 기기의 값은 null 이지 0 이 아니다 (G2). */
  it('type/status 가 null 인 존도 통과한다', () => {
    const next = minimalResult()
    next.device.state_before.thermal_zones = [
      { name: 'CPU', celsius: 41.5, type: null, status: null },
    ] as never
    expect(ResultSchema.safeParse(next).success).toBe(true)
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
    // 다른 터미널의 adb 는 안 잡힌다.
    expect(field.description).toMatch(/다른 터미널/)
    // 그리고 **이 도구 자신이** 트레이스 시작 뒤 창이 열리기 전에 보내는 두 명령도 안 잡힌다.
    // 이 절이 빠져 있던 동안 스키마만 읽는 소비자는 "perftracker 는 세션 중 아무것도 안
    // 보냈다" 로 결론냈고, `--launch` 세션에서 그건 거짓이었다.
    expect(field.description).toContain('am start -W')
    expect(field.description).toContain('pidof')
  })

  /**
   * M4. `stop` 하지 않은 run 에 extract 를 돌리면 이 값은 최종값이 아니고, 셀 수 없으면
   * null 이다. 그 사실이 소스 주석에만 있으면 스키마만 읽는 CI 는 null 을 만나 터지거나
   * (더 나쁘게) `?? 0` 으로 접어 오염 가능성이 있는 세션을 청정으로 판정한다.
   */
  it('stop 전에는 이 값이 최종값이 아니고 null 일 수 있다는 것을 스키마에서 말한다', () => {
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const field = props(overhead)['adb_commands_during_session'] as { description?: string }

    expect(field.description).toContain('running')
    expect(field.description).toMatch(/최종값이 아니다/)
    // null 과 0 이 다른 사실이라는 것을 스키마가 직접 말해야 한다.
    expect(field.description).toMatch(/null 은 0 이 아니다/)
    // 그리고 M2 에서 들어간 `--launch` 공시는 그대로 살아 있어야 한다.
    expect(field.description).toContain('am start -W')
    expect(field.description).toContain('pidof')
  })

  it('adb_commands_during_session 이 실제로 null 을 허용한다 — 설명만이 아니라 타입도', () => {
    const overhead = props(resultJsonSchema())['measurement_overhead']
    expect(JSON.stringify(props(overhead)['adb_commands_during_session'])).toContain('null')
  })

  it('끝나지 않은 세션의 종료 시각과 길이가 null 임을 스키마에서 말한다', () => {
    const session = props(props(resultJsonSchema())['session'])
    for (const field of ['ended_at', 'duration_ms']) {
      const f = session[field] as { description?: string }
      expect(f.description, `${field} 설명 없음`).toBeDefined()
      expect(JSON.stringify(session[field]), `${field} 가 null 을 안 받음`).toContain('null')
    }
    expect((session['duration_ms'] as { description: string }).description).toMatch(/0 과 혼동/)
  })

  it('확인하지 못한 것을 false 로 내지 않는다는 사실이 스키마에 있다', () => {
    // 같은 계열. 트레이스가 없으면 버퍼 통계를 볼 수조차 없는데 옛 값은 false 였다.
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const f = props(overhead)['trace_buffer_overrun'] as { description?: string }

    expect(f.description).toBeDefined()
    expect(f.description).toMatch(/null 은 확인하지 못했다는 뜻이다/)
    expect(JSON.stringify(props(overhead)['trace_buffer_overrun'])).toContain('null')
  })

  it('진행 중인 세션의 결과(널 네 개)가 스키마를 통과한다', () => {
    const r = minimalResult()
    const running = {
      ...r,
      session: { ...r.session, state: 'running' as const, ended_at: null, duration_ms: null },
      measurement_overhead: {
        ...r.measurement_overhead,
        adb_commands_during_session: null,
        trace_buffer_overrun: null,
      },
    }
    expect(() => ResultSchema.parse(running)).not.toThrow()
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

  it('log 의 total 과 by_priority 가 서로 반대되는 말을 하지 않는다', () => {
    // 출판되는 스키마 안에서 두 문장이 충돌했다: total 은 "문턱 이상만 센다" 고 하고
    // by_priority 는 "total 은 문턱보다 낮은 것도 전부 센다" 고 했다. 코드는 후자다.
    const total = (logProps()['total'] as { description: string }).description
    const byPriority = (logProps()['by_priority'] as { description: string }).description

    expect(total).not.toMatch(/문턱 이상만/)
    expect(total).toContain('전부')
    expect(byPriority).toContain('total')
  })

  /**
   * I3. `partial` 은 "값 있는데 일부" 와 "값 아예 없음" 을 겸한다. 그 사실이 소스 주석에만
   * 있어서, `status === 'failed'` 로 문제를 거르는 CI 는 값이 통째로 없는 메트릭을 전부
   * 통과시켰다 (실측: 에뮬 6회 중 log 는 전부 partial+null).
   */
  it('status 네 값의 뜻을 스키마에 싣는다 — partial 이 data null 을 겸한다는 것까지', () => {
    const status = (props(props(props(resultJsonSchema())['metrics'])['frame'])['status'] as {
      description?: string
    }).description

    expect(status).toBeDefined()
    for (const value of ['collected', 'partial', 'unsupported', 'failed', 'skipped']) {
      expect(status, `${value} 설명 없음`).toContain(value)
    }
    // partial 이 data null 일 수 있다.
    expect(status).toMatch(/값이 아예 나오지 않았다/)
    // failed 만 걸러서는 수집 실패를 못 잡는다.
    expect(status).toMatch(/failed. 만 걸러서는/)
  })

  /**
   * I2. 이 필드만 세션 구간의 값이 아닌데 세션 통계(rss) 바로 옆에 무표시로 놓여 있었다.
   */
  it('rss_watermark_peak_kb 가 세션 값이 아니라는 사실을 스키마에서 말한다', () => {
    const data = props(props(props(resultJsonSchema())['metrics'])['memory'])['data'] as {
      anyOf?: Record<string, any>[]
    }
    const object = data.anyOf?.find((b) => b['type'] === 'object') ?? data
    const d = (props(object)['rss_watermark_peak_kb'] as { description?: string }).description

    expect(d).toBeDefined()
    expect(d).toContain('VmHWM')
    expect(d).toMatch(/세션 구간의 값이 아니다/)
    expect(d).toContain('--launch')
    expect(d).toContain('rss.max_kb')
  })

  /**
   * M6. 커널이 ftrace 이벤트를 기록하는 비용은 인터럽트당한 프로세스에 청구되므로 이 숫자에
   * 들어오지 않는다. 필드명이 범위를 한정하지만, 요약과 README 는 이것을 총비용으로 읽는다.
   */
  it('overhead CPU 시간이 총비용이 아니라 하한임을 스키마에서 말한다', () => {
    const overhead = props(resultJsonSchema())['measurement_overhead']
    const d = (props(overhead)['tracing_processes_cpu_time_ms'] as { description?: string })
      .description!

    expect(d).toContain('하한')
    expect(d).toContain('ftrace')
  })

  /** `data` 는 nullable 이라 anyOf 로 나온다 — object 쪽 가지를 찾아 들어간다. */
  const metricDataProps = (id: string): Record<string, any> => {
    const data = props(props(props(resultJsonSchema())['metrics'])[id])['data'] as {
      anyOf?: Record<string, any>[]
    }
    const object = data.anyOf?.find((b) => b['type'] === 'object') ?? data
    return props(object)
  }

  it('thermal 의 숫자가 기기 전역이고 델타 부호가 있다는 것을 스키마에서 말한다', () => {
    const zones = metricDataProps('thermal')['zones'] as { description?: string }
    expect(zones.description).toBeDefined()
    expect(zones.description).toContain('기기 전역')
    // 전/후 2점이므로 구간 중 최고 온도는 원리적으로 없다.
    expect(zones.description).toMatch(/구간 중 최고 온도/)
    // 0.0 을 해석하지 않는다.
    expect(zones.description).toContain('0.0')
  })

  /**
   * 실기기 대조에서 나온 사실: `Cached` 전용 존 하나가 4세션 8개 덤프 내내 27.0°C 로
   * 고정이었고 같은 기간 HAL 존은 30.8~41.6°C 로 움직였다. 그 존의 `delta_c` 0 은
   * "온도가 안 변했다" 가 아니라 "이 값이 갱신되지 않았다" 일 수 있다.
   * 이 한정이 스키마 밖(소스 주석)에만 있으면 `perftracker schema` 만 읽는 소비자에게는
   * 거짓 청정 신호가 된다 — 0 이 관측된 안정으로 읽힌다.
   */
  it('cached 존의 delta 가 온도 변화가 아닐 수 있다는 것을 스키마에서 말한다', () => {
    const zoneProps = props((metricDataProps('thermal')['zones'] as { items: unknown }).items)
    const source = (zoneProps['source'] as { description: string }).description
    const delta = (zoneProps['delta_c'] as { description: string }).description

    expect(source).toContain('cached')
    expect(source).toMatch(/갱신/)
    // 근거가 함께 있어야 한다 — 주장만 있으면 소비자가 무게를 못 잰다.
    expect(source).toContain('27.0')
    expect(source).toMatch(/구분하지 못한다/)
    // delta_c 만 읽는 소비자도 그 사실에 도달해야 한다.
    expect(delta).toContain('cached')
    expect(delta).toMatch(/음수가 정상/)
  })

  it('network 의 숫자가 무엇의 합계인지를 스키마에서 말한다', () => {
    const rx = (metricDataProps('network')['rx_bytes'] as { description: string }).description
    expect(rx).toContain('uid 단위')
    expect(rx).toContain('IP 계층')
    expect(rx).toContain('loopback')
    expect(rx).toMatch(/wifi \/ mobile 로 나뉘지 않는다/)
    // 관측한 0 과 조회 못 한 것의 구분.
    expect(rx).toMatch(/조회하지 못했다/)

    const shared = (metricDataProps('network')['shared_uid_packages'] as { description: string })
      .description
    expect(shared).toMatch(/null 은 그 스냅샷을 읽지 못했다는 뜻이다/)
  })

  /**
   * C1. 옛 문서의 `thermal_zones` 에는 중복이 남아 있다. "존 하나당 정확히 한 항목이다" 를
   * 무조건문으로 두면 **오늘 이 저장소가 만들 수 있는 문서 일부가 그 문장을 위반한다.**
   */
  it('thermal_zones 의 중복 없음 보장에 한정 조건이 붙어 있다', () => {
    const d = (props(props(props(resultJsonSchema())['device'])['state_before'])[
      'thermal_zones'
    ] as { description: string }).description

    expect(d).toMatch(/보장은 .type.\/.source. 필드를 가진 문서에만 적용된다/)
    expect(d).toContain('raw/thermalservice')
    expect(d).toContain('target_app.render_process')
  })

  it('JSON 으로 직렬화된다 (perftracker schema 가 그대로 출력한다)', () => {
    expect(() => JSON.parse(JSON.stringify(resultJsonSchema()))).not.toThrow()
  })

  it('일곱 메트릭이 모두 JSON Schema 에 실린다 — catchall 로 뭉개지지 않는다', () => {
    const metrics = props(props(resultJsonSchema())['metrics'])
    for (const id of ['frame', 'startup', 'cpu', 'memory', 'log', 'thermal', 'network']) {
      expect(metrics[id], `${id} 가 스키마에 없음`).toBeDefined()
    }
  })

  it('frame 만 required 다 — 1.0.0 문서가 계속 유효해야 한다', () => {
    const metrics = props(resultJsonSchema())['metrics'] as { required?: string[] }
    expect(metrics.required).toEqual(['frame'])
  })
})
