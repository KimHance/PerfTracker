import { describe, expect, it } from 'vitest'
import {
  ALLOWED_FTRACE_EVENTS,
  assertLowOverheadConfig,
  buildTraceConfig,
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
