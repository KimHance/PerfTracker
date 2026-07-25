import { describe, expect, it } from 'vitest'
import {
  assertLowOverheadConfig,
  buildTraceConfig,
  mergeTraceConfigBlocks,
} from '../../src/perfetto/config.js'
import { PerfettoSessionError } from '../../src/errors.js'

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
  it('고빈도 ftrace 이벤트를 거부한다', () => {
    // buildTraceConfig 는 만들면서 이미 검사하므로, 검사기 자체를 보려면 문자열을 직접 준다.
    const bad =
      'data_sources { config { name: "linux.ftrace" ftrace_config { ftrace_events: "sched/sched_switch" } } }\n' +
      'write_into_file: true\nflush_period_ms: 30000\n'
    expect(() => assertLowOverheadConfig(bad)).toThrow(/sched\/sched_switch/)
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
