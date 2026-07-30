import { describe, expect, it } from 'vitest'
import {
  ANDROID_LOG_BLOCK,
  ANDROID_LOG_MIN_PRIO,
  FTRACE_POWER_BLOCK,
  POLL_PERIOD_MS,
  PROCESS_RUNTIME_MIN_SDK,
  processStatsBlock,
  SYS_STATS_BLOCK,
} from '../../src/collectors/blocks.js'
import { ALLOWED_FTRACE_EVENTS, buildTraceConfig, mergeTraceConfigBlocks } from '../../src/perfetto/config.js'

/** 최신 기기(A15+). `record_process_runtime` 이 들어간다. */
const PROCESS_STATS_NEW = processStatsBlock(PROCESS_RUNTIME_MIN_SDK)
/** 그 아래(A14 이하). 그 필드가 빠진다 — 넣으면 config 전체가 거부된다. */
const PROCESS_STATS_OLD = processStatsBlock(PROCESS_RUNTIME_MIN_SDK - 1)

const ALL = [
  PROCESS_STATS_NEW,
  SYS_STATS_BLOCK,
  FTRACE_POWER_BLOCK,
  ANDROID_LOG_BLOCK,
]

const ALL_OLD = [
  PROCESS_STATS_OLD,
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

  /**
   * "고빈도만 안 켜면 된다" 가 아니다. 켜는 이벤트마다 그것을 읽는 코드가 있어야 한다 —
   * `power/cpu_idle` 은 저빈도도 아니었고(에뮬레이터에서 초당 1,400건, ftrace 의 94%)
   * 읽는 코드도 없었다.
   */
  it('허용 목록 밖의 ftrace 이벤트를 하나도 켜지 않는다', () => {
    const events = [...FTRACE_POWER_BLOCK.matchAll(/ftrace_events:\s*"([^"]+)"/g)].map((m) => m[1]!)
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(ALLOWED_FTRACE_EVENTS, event).toContain(event)
    }
  })

  it('아무도 읽지 않는 전력 이벤트를 켜지 않는다 — cpu.ts 는 cpufreq 만 읽는다', () => {
    expect(FTRACE_POWER_BLOCK).not.toContain('cpu_idle')
    expect(FTRACE_POWER_BLOCK).not.toContain('suspend_resume')
  })

  it('A15+ 는 record_process_runtime 을 켠다 — 없으면 overhead CPU 가 영원히 null 이다', () => {
    expect(PROCESS_STATS_NEW).toContain('record_process_runtime: true')
  })

  /**
   * **이 저장소가 실기기에서 맞은 결함이다.** `record_process_runtime` 은 perfetto v44 에서
   * 생겼고 **Android 15(sdk 35)부터** 플랫폼에 들어갔다. 그 아래 기기의 `ProcessStatsConfig`
   * 에는 필드가 아예 없는데, perfetto 는 config 를 부분 수용하지 않으므로 모르는 필드 하나가
   * **세션 전체를 거부시킨다:**
   *
   * ```
   * error: No field named "record_process_runtime" in proto ProcessStatsConfig
   * ```
   *
   * 그래서 오버헤드 자가측정 하나 때문에 **Android 14 이하에서 지표 일곱 개가 전부** 죽었다.
   * 실측: SM-A405S(A11)·에뮬레이터(A14) 에서 이 필드만 빼면 나머지 블록이 전부 통과했고,
   * SM-F936N(A16) 에서는 넣은 채로 통과했다.
   */
  it('A14 이하에는 record_process_runtime 을 보내지 않는다 — 보내면 세션이 안 열린다', () => {
    expect(PROCESS_STATS_OLD).not.toContain('record_process_runtime')
    // 나머지는 그대로다. 필드 하나만 빠지고 데이터소스가 사라지지는 않는다.
    expect(PROCESS_STATS_OLD).toContain('name: "linux.process_stats"')
    expect(PROCESS_STATS_OLD).toContain('scan_all_processes_on_start: true')
    expect(PROCESS_STATS_OLD).toContain(`proc_stats_poll_ms: ${POLL_PERIOD_MS}`)
  })

  it('경계는 sdk 35 다 — 34 에서 빠지고 35 에서 들어간다', () => {
    expect(PROCESS_RUNTIME_MIN_SDK).toBe(35)
    expect(processStatsBlock(34)).not.toContain('record_process_runtime')
    expect(processStatsBlock(35)).toContain('record_process_runtime: true')
    expect(processStatsBlock(36)).toContain('record_process_runtime: true')
    // sdk 를 못 읽어 0 이 온 기기에는 보내지 않는다 — 모르면 보수적으로 간다.
    expect(processStatsBlock(0)).not.toContain('record_process_runtime')
  })

  it('구형 기기용 조합도 저부하 불변식을 통과한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: ALL_OLD })).not.toThrow()
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
  it('processStatsBlock — A15+ (record_process_runtime 포함)', () => {
    expect(PROCESS_STATS_NEW).toBe(
      'data_sources { config { name: "linux.process_stats" process_stats_config { ' +
        'proc_stats_poll_ms: 1000 scan_all_processes_on_start: true ' +
        'record_process_runtime: true } } }',
    )
  })

  /**
   * **이 문자열이 Android 11~14 기기로 실제로 나가는 바이트다.** 실측으로 통과를 확인한
   * 그 텍스트이므로, 여기가 바뀌면 그 기기들에서 세션이 열리는지 다시 확인해야 한다.
   */
  it('processStatsBlock — A14 이하 (필드 없음)', () => {
    expect(PROCESS_STATS_OLD).toBe(
      'data_sources { config { name: "linux.process_stats" process_stats_config { ' +
        'proc_stats_poll_ms: 1000 scan_all_processes_on_start: true } } }',
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
        'ftrace_events: "power/cpu_frequency" } } }',
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
