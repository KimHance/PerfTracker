import { describe, expect, it } from 'vitest'
import {
  ANDROID_LOG_BLOCK,
  ANDROID_LOG_MIN_PRIO,
  FRAMETIMELINE_BLOCK,
  FTRACE_POWER_BLOCK,
  POLL_PERIOD_MS,
  PROCESS_STATS_BLOCK,
  SYS_STATS_BLOCK,
} from '../../src/collectors/blocks.js'
import { buildTraceConfig, FORBIDDEN_FTRACE_EVENTS, mergeTraceConfigBlocks } from '../../src/perfetto/config.js'

const ALL = [
  FRAMETIMELINE_BLOCK,
  PROCESS_STATS_BLOCK,
  SYS_STATS_BLOCK,
  FTRACE_POWER_BLOCK,
  ANDROID_LOG_BLOCK,
]

describe('데이터소스 블록', () => {
  it('블록마다 data_sources 이름이 정확히 하나다', () => {
    for (const block of ALL) {
      const names = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])
      expect(names).toHaveLength(1)
    }
  })

  it('데이터소스 이름이 서로 겹치지 않는다 — 겹치면 merge 가 던진다', () => {
    const names = ALL.map((b) => /name:\s*"([^"]+)"/.exec(b)?.[1])
    expect(new Set(names).size).toBe(ALL.length)
  })

  it('전부 모아도 저부하 불변식을 통과한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: ALL })).not.toThrow()
  })

  it('같은 상수를 두 번 넣으면 merge 가 하나로 접는다', () => {
    expect(mergeTraceConfigBlocks([...ALL, ...ALL])).toEqual(ALL)
  })

  it('금지된 고빈도 ftrace 이벤트를 하나도 켜지 않는다', () => {
    for (const event of FORBIDDEN_FTRACE_EVENTS) {
      expect(FTRACE_POWER_BLOCK).not.toContain(event)
    }
  })

  it('process_stats 가 record_process_runtime 을 켠다 — 없으면 overhead CPU 가 영원히 null 이다', () => {
    expect(PROCESS_STATS_BLOCK).toContain('record_process_runtime: true')
  })

  it('sys_stats 가 CPU 시간과 meminfo 를 한 블록에서 요청한다', () => {
    expect(SYS_STATS_BLOCK).toContain('stat_counters: STAT_CPU_TIMES')
    expect(SYS_STATS_BLOCK).toContain('meminfo_counters: MEMINFO_MEM_AVAILABLE')
  })

  it('폴링 주기가 1000ms 하한을 지킨다', () => {
    expect(POLL_PERIOD_MS).toBeGreaterThanOrEqual(1000)
    for (const m of [...ALL.join('\n').matchAll(/(\w*poll_ms|\w*period_ms):\s*(\d+)/g)]) {
      expect(Number(m[2])).toBeGreaterThanOrEqual(1000)
    }
  })

  it('android.log 의 문턱값이 블록과 상수에서 같다 — 결과에 그대로 실린다', () => {
    expect(ANDROID_LOG_BLOCK).toContain(`min_prio: ${ANDROID_LOG_MIN_PRIO}`)
  })
})

/**
 * 위 `.toContain` 검사들은 "이 필드가 있다" 는 의도만 표현하고 "이게 전부다" 는 말하지 않는다
 * — 그래서 `record_process_runtime: true` 가 아무 테스트도 건드리지 않고 조용히 추가됐었다.
 * 여기서는 블록 텍스트 전체를 고정한다. 앞으로 누가 공유 블록에 필드를 더하거나 빼면
 * 이 테스트가 먼저 깨져서, "frame 전용 세션이 오늘부터 다른 바이트를 기기로 보낸다" 는 사실이
 * 눈에 보이는 diff 로 드러난다.
 */
describe('데이터소스 블록 — 전체 텍스트 고정', () => {
  it('FRAMETIMELINE_BLOCK', () => {
    expect(FRAMETIMELINE_BLOCK).toBe(
      'data_sources { config { name: "android.surfaceflinger.frametimeline" } }',
    )
  })

  it('PROCESS_STATS_BLOCK', () => {
    expect(PROCESS_STATS_BLOCK).toBe(
      'data_sources { config { name: "linux.process_stats" process_stats_config { ' +
        'proc_stats_poll_ms: 1000 scan_all_processes_on_start: true ' +
        'record_process_runtime: true } } }',
    )
  })

  it('SYS_STATS_BLOCK', () => {
    expect(SYS_STATS_BLOCK).toBe(
      'data_sources { config { name: "linux.sys_stats" sys_stats_config { ' +
        'stat_period_ms: 1000 stat_counters: STAT_CPU_TIMES meminfo_period_ms: 1000 ' +
        'meminfo_counters: MEMINFO_MEM_TOTAL meminfo_counters: MEMINFO_MEM_FREE ' +
        'meminfo_counters: MEMINFO_MEM_AVAILABLE meminfo_counters: MEMINFO_BUFFERS ' +
        'meminfo_counters: MEMINFO_CACHED meminfo_counters: MEMINFO_SWAP_CACHED ' +
        'meminfo_counters: MEMINFO_SWAP_TOTAL meminfo_counters: MEMINFO_SWAP_FREE } } }',
    )
  })

  it('FTRACE_POWER_BLOCK', () => {
    expect(FTRACE_POWER_BLOCK).toBe(
      'data_sources { config { name: "linux.ftrace" ftrace_config { ' +
        'ftrace_events: "power/cpu_frequency" ftrace_events: "power/cpu_idle" ' +
        'ftrace_events: "power/suspend_resume" } } }',
    )
  })

  it('ANDROID_LOG_BLOCK', () => {
    expect(ANDROID_LOG_BLOCK).toBe(
      'data_sources { config { name: "android.log" android_log_config { ' +
        'log_ids: LID_DEFAULT log_ids: LID_SYSTEM log_ids: LID_CRASH ' +
        'min_prio: PRIO_WARN } } }',
    )
  })
})
