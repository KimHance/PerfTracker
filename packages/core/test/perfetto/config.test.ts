import { describe, expect, it } from 'vitest'
import {
  ALLOWED_FTRACE_EVENTS,
  assertLowOverheadConfig,
  buildTraceConfig,
  DIAGNOSE_ATRACE_CATEGORIES,
  mergeTraceConfigBlocks,
} from '../../src/perfetto/config.js'
import { PerfettoSessionError } from '../../src/errors.js'
import { FRAMETIMELINE_BLOCK } from '../../src/collectors/blocks.js'

const BLOCK = 'data_sources { config { name: "android.surfaceflinger.frametimeline" } }'

describe('buildTraceConfig', () => {
  it('detach 에 필요한 write_into_file 을 반드시 켠다', () => {
    expect(buildTraceConfig({ dataSourceBlocks: [BLOCK] })).toContain('write_into_file: true')
  })

  it('flush_period_ms 를 반드시 함께 넣는다', () => {
    // 빠뜨리면 trace_processor 가 트레이스를 통째로 메모리에 올린다.
    expect(buildTraceConfig({ dataSourceBlocks: [BLOCK] })).toMatch(/flush_period_ms:\s*\d+/)
  })

  it('데이터소스 블록을 그대로 넣는다', () => {
    expect(buildTraceConfig({ dataSourceBlocks: [BLOCK] })).toContain(BLOCK)
  })

  it('duration 과 버퍼 크기를 설정할 수 있다', () => {
    const text = buildTraceConfig({ dataSourceBlocks: [BLOCK], durationMs: 60_000, bufferSizeKb: 1024 })
    expect(text).toContain('duration_ms: 60000')
    expect(text).toContain('size_kb: 1024')
  })

  it('데이터소스가 없으면 거부한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: [] })).toThrow(PerfettoSessionError)
  })

  it('만들어진 config 는 저부하 불변식을 통과한다', () => {
    expect(() => assertLowOverheadConfig(buildTraceConfig({ dataSourceBlocks: [BLOCK] }))).not.toThrow()
  })
})

describe('assertLowOverheadConfig', () => {
  const ftraceConfig = (...events: string[]): string =>
    `data_sources { config { name: "linux.ftrace" ftrace_config { ${events
      .map((e) => `ftrace_events: "${e}"`)
      .join(' ')} } } }\n` +
    'write_into_file: true\nflush_period_ms: 30000\nfile_write_period_ms: 30000\n'

  it('고빈도 ftrace 이벤트를 거부한다', () => {
    // buildTraceConfig 는 만들면서 이미 검사하므로, 검사기 자체를 보려면 문자열을 직접 준다.
    expect(() => assertLowOverheadConfig(ftraceConfig('sched/sched_switch'))).toThrow(
      /sched\/sched_switch/,
    )
  })

  it('buildTraceConfig 도 금지 이벤트를 막는다', () => {
    expect(() =>
      buildTraceConfig({
        dataSourceBlocks: [
          'data_sources { config { name: "linux.ftrace" ftrace_config { ftrace_events: "sched/sched_switch" } } }',
        ],
      }),
    ).toThrow(/sched\/sched_switch/)
  })

  /**
   * 블랙리스트였을 때 이 이벤트들은 검사를 그냥 통과했다. 실제로 `power/cpu_idle` 이 그렇게
   * 들어와 ftrace 페이로드의 94% 를 차지했다 (에뮬레이터 33초 세션에서 47,752건 / 50,654건).
   * 허용 목록으로 뒤집은 뒤로는 "저볼륨이니까 괜찮다" 는 판단이 검사기에 없다 — 목록에
   * 없으면 거부한다.
   */
  it('허용 목록에 없는 이벤트는 저볼륨이어도 거부한다', () => {
    for (const event of ['power/cpu_idle', 'power/suspend_resume', 'mm_event/mm_event_record']) {
      expect(() => assertLowOverheadConfig(ftraceConfig(event)), event).toThrow(
        new RegExp(event.replace('/', '\\/')),
      )
    }
  })

  it('악명 높은 고빈도 이벤트는 하나도 빠짐없이 거부된다', () => {
    for (const event of [
      'sched/sched_switch',
      'sched/sched_waking',
      'sched/sched_wakeup',
      'raw_syscalls/sys_enter',
      'raw_syscalls/sys_exit',
      'ftrace/print',
    ]) {
      expect(ALLOWED_FTRACE_EVENTS, event).not.toContain(event)
      expect(() => assertLowOverheadConfig(ftraceConfig(event)), event).toThrow(PerfettoSessionError)
    }
  })

  it('허용 목록의 이벤트는 통과시킨다', () => {
    expect(() => assertLowOverheadConfig(ftraceConfig(...ALLOWED_FTRACE_EVENTS))).not.toThrow()
  })

  /**
   * 목록이 늘어나는 것 자체는 잘못이 아니지만, **읽는 collector 없이** 늘어나는 것이 C1 이었다.
   * 이 테스트가 깨지면 새 이벤트를 추가한 사람이 그것을 읽는 코드도 함께 넣었는지 되묻는다.
   */
  it('허용 목록에는 지금 실제로 읽는 이벤트만 있다', () => {
    expect([...ALLOWED_FTRACE_EVENTS]).toEqual(['power/cpu_frequency'])
  })

  it('write_into_file 없이 flush 만 있으면 거부한다', () => {
    expect(() => assertLowOverheadConfig('flush_period_ms: 30000\n')).toThrow(/write_into_file/)
  })

  it('flush_period_ms 가 없으면 거부한다', () => {
    expect(() => assertLowOverheadConfig('write_into_file: true\n')).toThrow(/flush_period_ms/)
  })

  it('폴링 주기가 1000ms 미만이면 거부한다', () => {
    const bad = 'write_into_file: true\nflush_period_ms: 30000\nproc_stats_poll_ms: 100\n'
    expect(() => assertLowOverheadConfig(bad)).toThrow(/1000ms/)
  })

  /**
   * 여기에도 화이트리스트(`stat|meminfo|vmstat`)가 있어서 목록 밖의 주기 키는 어떤 값이든
   * 검사 없이 통과했다 — ftrace 블랙리스트가 만든 것과 같은 종류의 구멍이다.
   */
  it('처음 보는 주기 키도 하한을 받는다 — 목록에 없다고 통과시키지 않는다', () => {
    for (const line of ['thermal_period_ms: 250', 'drain_period_ms: 100', 'battery_poll_ms: 500']) {
      const bad = `write_into_file: true\nflush_period_ms: 30000\nfile_write_period_ms: 30000\n${line}\n`
      expect(() => assertLowOverheadConfig(bad), line).toThrow(/1000ms/)
    }
  })

  it('file_write_period_ms 가 없으면 거부한다', () => {
    expect(() => assertLowOverheadConfig('write_into_file: true\nflush_period_ms: 30000\n')).toThrow(
      /file_write_period_ms/,
    )
  })

  it('file_write_period_ms 가 30000 미만이면 거부한다 (Global Constraint)', () => {
    const bad = 'write_into_file: true\nflush_period_ms: 30000\nfile_write_period_ms: 1000\n'
    expect(() => assertLowOverheadConfig(bad)).toThrow(/30000ms 이상/)
  })

  it('buildTraceConfig 도 짧은 file_write_period_ms 를 막는다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: [BLOCK], fileWritePeriodMs: 500 })).toThrow(
      PerfettoSessionError,
    )
  })
})

describe('mergeTraceConfigBlocks', () => {
  const PROCESS_STATS =
    'data_sources { config { name: "linux.process_stats" process_stats_config { proc_stats_poll_ms: 1000 } } }'

  it('같은 데이터소스를 두 collector 가 같은 텍스트로 요청하면 한 번만 넣는다', () => {
    expect(mergeTraceConfigBlocks([BLOCK, PROCESS_STATS, PROCESS_STATS])).toEqual([BLOCK, PROCESS_STATS])
  })

  it('요청 순서를 보존한다', () => {
    expect(mergeTraceConfigBlocks([PROCESS_STATS, BLOCK])).toEqual([PROCESS_STATS, BLOCK])
  })

  it('같은 데이터소스에 다른 설정이 오면 조용히 하나를 이기게 하지 않고 던진다', () => {
    const other =
      'data_sources { config { name: "linux.process_stats" process_stats_config { proc_stats_poll_ms: 5000 } } }'
    expect(() => mergeTraceConfigBlocks([PROCESS_STATS, other])).toThrow(PerfettoSessionError)
    expect(() => mergeTraceConfigBlocks([PROCESS_STATS, other])).toThrow(/linux\.process_stats/)
  })

  it('name 이 없는 블록도 중복만 접는다', () => {
    expect(mergeTraceConfigBlocks(['buffers { size_kb: 1 }', 'buffers { size_kb: 1 }'])).toEqual([
      'buffers { size_kb: 1 }',
    ])
  })
})

describe('frametimeline 블록', () => {
  it('저부하 검사를 통과한다 — ftrace 이벤트를 하나도 켜지 않는다', () => {
    const cfg = buildTraceConfig({ dataSourceBlocks: [FRAMETIMELINE_BLOCK] })
    expect(cfg).toContain('android.surfaceflinger.frametimeline')
    expect(() => assertLowOverheadConfig(cfg)).not.toThrow()
  })

  it('주기 설정을 갖지 않는다 — 폴링이 아니라 SurfaceFlinger 가 미는 데이터다', () => {
    expect(FRAMETIMELINE_BLOCK).not.toMatch(/(poll|period)_ms/)
  })
})

/**
 * DM-4. 이 검증기는 예전에 `ftrace_events` 만 봐서 atrace 카테고리 · 앱은 검사 없이 통과했다.
 * atrace slice 의 비용은 커널 ftrace 와 달리 **slice 를 남기는 프로세스 자신**에게 청구되므로,
 * 평소 세션에는 하나도 들어가면 안 되고 진단 세션에도 정한 범위 밖은 들어가면 안 된다.
 */
describe('assertLowOverheadConfig — atrace (DM-4)', () => {
  const PKG = 'com.google.android.youtube'
  const DIAG = { packageName: PKG }
  const tail = 'write_into_file: true\nflush_period_ms: 30000\nfile_write_period_ms: 30000\n'
  const ftrace = (body: string): string =>
    `data_sources { config { name: "linux.ftrace" ftrace_config { ${body} } } }\n${tail}`
  const IN_SCOPE =
    'ftrace_events: "power/cpu_frequency" atrace_categories: "am" atrace_categories: "wm" ' +
    `atrace_categories: "view" atrace_categories: "dalvik" atrace_apps: "${PKG}"`

  it('DM-4 평소 config atrace 거부 — atrace_ 로 시작하는 키가 하나라도 있으면', () => {
    for (const body of [
      'atrace_categories: "am"',
      `atrace_apps: "${PKG}"`,
      'atrace_categories_prefer_sdk: "am"',
      'atrace_userspace_only: true',
      `ftrace_events: "power/cpu_frequency" ${IN_SCOPE}`,
    ]) {
      expect(() => assertLowOverheadConfig(ftrace(body)), body).toThrow(PerfettoSessionError)
      expect(() => assertLowOverheadConfig(ftrace(body), null), body).toThrow(/진단 세션/)
    }
  })

  it('BP-7 진단 config dalvik — 허용 목록이 am · wm · view · dalvik 이고 평소 config 에는 dalvik 도 거부', () => {
    expect([...DIAGNOSE_ATRACE_CATEGORIES]).toEqual(['am', 'wm', 'view', 'dalvik'])
    expect(() => assertLowOverheadConfig(ftrace('atrace_categories: "dalvik"'))).toThrow(/진단 세션/)
  })

  it('DM-4 평소 config atrace 거부 — buildTraceConfig 도 diagnose 없이는 막는다', () => {
    const block = `data_sources { config { name: "linux.ftrace" ftrace_config { atrace_categories: "am" } } }`
    expect(() => buildTraceConfig({ dataSourceBlocks: [block] })).toThrow(PerfettoSessionError)
    expect(() => buildTraceConfig({ dataSourceBlocks: [block], diagnose: DIAG })).not.toThrow()
  })

  it('DM-4 따옴표 안의 atrace_ 는 키가 아니다', () => {
    expect(() =>
      assertLowOverheadConfig(`data_sources { config { name: "vendor.atrace_like" } }\n${tail}`),
    ).not.toThrow()
  })

  it('DM-4 진단 config 허용 밖 거부 — 키 · 카테고리 · 앱 · 와일드카드 · 둘 이상 · 리스트 꼴', () => {
    const outside: [string, RegExp][] = [
      [`${IN_SCOPE} atrace_categories_prefer_sdk: "am"`, /허용한 키가 아닙니다/],
      [`${IN_SCOPE} atrace_userspace_only: true`, /허용한 키가 아닙니다/],
      [`${IN_SCOPE} atrace_categories: "gfx"`, /"gfx"/],
      [`${IN_SCOPE} atrace_categories: "input"`, /"input"/],
      [`${IN_SCOPE} atrace_categories: "sched"`, /"sched"/],
      // dalvik 은 낱말 그대로만 — 대소문자 · 접두어가 다르면 허용 목록 밖이다.
      [`${IN_SCOPE} atrace_categories: "Dalvik"`, /"Dalvik"/],
      [`${IN_SCOPE} atrace_categories: "art"`, /"art"/],
      ['atrace_categories: "am" atrace_apps: "com.android.chrome"', /대상 앱/],
      ['atrace_categories: "am" atrace_apps: "*"', /와일드카드/],
      ['atrace_categories: "am" atrace_apps: "com.google.*"', /와일드카드/],
      [`atrace_categories: "am" atrace_apps: "${PKG}" atrace_apps: "${PKG}"`, /2개/],
      [`atrace_categories: "am" atrace_apps: "${PKG}" atrace_apps: "com.android.chrome"`, /2개/],
      [`atrace_categories: ["am", "gfx"] atrace_apps: "${PKG}"`, /꼴/],
      [`atrace_categories: ["am"] atrace_apps: "${PKG}"`, /꼴/],
      [`atrace_categories: "am" atrace_apps: ["${PKG}"]`, /꼴/],
    ]
    for (const [body, why] of outside) {
      expect(() => assertLowOverheadConfig(ftrace(body), DIAG), body).toThrow(why)
    }
  })

  it('DM-4 진단 config 허용 범위는 통과한다 — 카테고리 넷의 부분집합 · 대상 앱 하나', () => {
    expect(() => assertLowOverheadConfig(ftrace(IN_SCOPE), DIAG)).not.toThrow()
    expect(() => assertLowOverheadConfig(ftrace('atrace_categories: "am"'), DIAG)).not.toThrow()
    expect(() => assertLowOverheadConfig(ftrace('atrace_categories: "dalvik"'), DIAG)).not.toThrow()
    expect(() => assertLowOverheadConfig(ftrace(`atrace_apps: "${PKG}"`), DIAG)).not.toThrow()
  })

  /**
   * 코드 검수 #2. perfetto 파서는 `#` 를 줄 끝까지 주석으로 읽는데, 예전 검증기는 주석 안의 `"` 를
   * 문자열의 시작으로 읽어 그 뒤 진짜 키를 문자열 안으로 착각했다 — 아래 입력이 평소 · 진단
   * 둘 다 통과했다. 이 도구의 config 에는 주석이 없으므로 따옴표 밖 `#` 자체를 거부한다.
   */
  it('DM-4 주석(#) 안의 따옴표에 속지 않는다 — 따옴표 밖 # 는 평소 · 진단 모두 거부', () => {
    const review = ftrace('# it"s\n atrace_categories: "gfx" # "')
    expect(review).toContain('ftrace_config { # it"s\n atrace_categories: "gfx" # " }')
    expect(() => assertLowOverheadConfig(review)).toThrow(/주석/)
    expect(() => assertLowOverheadConfig(review, DIAG)).toThrow(/주석/)

    const otherApp = ftrace('# it"s\n atrace_categories: "gfx" atrace_apps: "com.android.chrome" # "')
    expect(() => assertLowOverheadConfig(otherApp, DIAG)).toThrow(/주석/)
    // atrace 만의 구멍이 아니다 — 값을 주석 너머 다음 줄로 넘기는 ftrace 이벤트도 같은 문에서 막힌다.
    expect(() => assertLowOverheadConfig(ftrace('ftrace_events: # x\n "sched/sched_switch"'))).toThrow(/주석/)
  })

  it('DM-4 따옴표 안의 # · 이스케이프된 따옴표는 문자열 안이다 · 닫히지 않은 따옴표는 거부', () => {
    expect(() => assertLowOverheadConfig(`data_sources { config { name: "vendor.a#b" } }\n${tail}`)).not.toThrow()
    expect(() =>
      assertLowOverheadConfig(`data_sources { config { name: "a\\" atrace_categories: \\"gfx" } }\n${tail}`),
    ).not.toThrow()
    expect(() => assertLowOverheadConfig(`data_sources { config { name: "vendor.ab } }\n${tail}`)).toThrow(/닫히지/)
  })

  it('DM-4 진단 세션이어도 ftrace 이벤트 허용 목록은 그대로다', () => {
    expect(() => assertLowOverheadConfig(ftrace(`${IN_SCOPE} ftrace_events: "sched/sched_switch"`), DIAG)).toThrow(
      /sched\/sched_switch/,
    )
    expect(ALLOWED_FTRACE_EVENTS).toEqual(['power/cpu_frequency'])
  })
})
