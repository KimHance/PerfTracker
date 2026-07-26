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
