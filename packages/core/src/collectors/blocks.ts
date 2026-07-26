/**
 * 데이터소스 이름 하나당 블록 텍스트 하나. **이 파일이 유일한 소유자다.**
 *
 * `mergeTraceConfigBlocks` 는 같은 `name` 이 서로 다른 텍스트로 두 번 오면 던진다. 그 규칙을
 * 지키는 방법은 둘이었다 — 설정을 합치거나(= 텍스트 프로토 파서를 새로 쓰는 일이고, 그 순간
 * "어떤 설정으로 측정했는가" 가 결과에서 사라진다), 소스마다 주인을 정하거나.
 *
 * 주인을 정하되 그 주인을 collector 가 아니라 이 파일로 뒀다. collector 가 소유하면
 * 그 collector 의 `supports()` 가 false 인 기기에서 소스가 통째로 사라진다 — frame 은
 * sdk_int < 31 에서 꺼지는데 memory 와 overhead 는 그 기기에서도 돌아야 한다.
 *
 * 결과적으로 merge 의 예외는 "정상적인 공유" 가 아니라 "누가 이 상수를 복사해 고쳤다" 는
 * 신호로만 남는다. 트립와이어가 트립와이어로 남는다.
 */

/** 폴링 주기. `assertLowOverheadConfig` 의 1000ms 하한과 같은 값이다. */
export const POLL_PERIOD_MS = 1000

export const FRAMETIMELINE_BLOCK =
  'data_sources { config { name: "android.surfaceflinger.frametimeline" } }'

/**
 * 소비자 셋이 공유한다: **frame**, **memory**, **overhead**.
 *   - frame  : frametimeline 은 프레임 타이밍만 주고 process 테이블의 이름을 안 채운다 —
 *     이 블록이 그 이름을 채운다.
 *   - memory : 앱의 `mem.rss` 계열.
 *   - overhead: `traced` / `traced_probes` 의 `runtime.*` 와 `mem.rss`.
 *
 * `record_process_runtime: true` 는 overhead 계산 전용이다 — 있어야 trace_processor 가
 * 프로세스마다 `runtime.user_ns` / `runtime.kernel_ns` 카운터를 만든다. 이것이 M1 에서
 * 빠져 있어서 `measurement_overhead` 의 CPU 필드가 null 이었다. 이 파일이 소스 하나당
 * 블록 하나를 강제하므로, frame 만 등록된 세션(overhead/memory collector 가 아직 없거나
 * 미지원인 기기)도 이 필드를 그대로 들고 나간다 — memory/overhead 를 위해 frame 이 대신
 * 짊어지는 비용이고, 의도한 것이다.
 *
 * `scan_all_processes_on_start: true` 는 세션 시작 시점의 전체 스냅샷을 남긴다. 폴링은
 * 매 주기마다 /proc 전체를 훑으므로(실측: 실기기 트레이스에 953개 프로세스) 대상 앱을
 * 따로 지정할 필요가 없다.
 */
export const PROCESS_STATS_BLOCK =
  'data_sources { config { name: "linux.process_stats" ' +
  `process_stats_config { proc_stats_poll_ms: ${POLL_PERIOD_MS} ` +
  'scan_all_processes_on_start: true record_process_runtime: true } } }'

/**
 * cpu(사용률) 와 memory(시스템 메모리) 가 공유한다.
 *
 * 주기 키 이름이 `stat_period_ms` / `meminfo_period_ms` 라서 `assertLowOverheadConfig` 의
 * 화이트리스트에 걸려 1000ms 하한 검사를 실제로 받는다 — 의도한 것이다.
 * `cpufreq_period_ms`(sysfs 폴링)는 **쓰지 않는다.** 그 키는 화이트리스트 밖이라 검사 없이
 * 통과하고, 스펙이 지정한 주파수 출처는 ftrace `power/cpu_frequency` 다.
 */
export const SYS_STATS_BLOCK =
  'data_sources { config { name: "linux.sys_stats" sys_stats_config { ' +
  `stat_period_ms: ${POLL_PERIOD_MS} stat_counters: STAT_CPU_TIMES ` +
  `meminfo_period_ms: ${POLL_PERIOD_MS} ` +
  'meminfo_counters: MEMINFO_MEM_TOTAL meminfo_counters: MEMINFO_MEM_FREE ' +
  'meminfo_counters: MEMINFO_MEM_AVAILABLE meminfo_counters: MEMINFO_BUFFERS ' +
  'meminfo_counters: MEMINFO_CACHED meminfo_counters: MEMINFO_SWAP_CACHED ' +
  'meminfo_counters: MEMINFO_SWAP_TOTAL meminfo_counters: MEMINFO_SWAP_FREE } } }'

/**
 * 규칙 2 가 채택한 저볼륨 이벤트만. `power/cpu_frequency` 는 주파수가 실제로 바뀔 때만 뜨므로
 * 초당 수만 건이 쏟아지는 sched 계열과 근본적으로 다르다.
 *
 * `drain_period_ms` 를 일부러 지정하지 않는다 — 그 키는 `assertLowOverheadConfig` 의
 * 화이트리스트 밖이라 어떤 값을 넣어도 검사를 통과해 버린다. perfetto 기본값을 쓴다.
 */
export const FTRACE_POWER_BLOCK =
  'data_sources { config { name: "linux.ftrace" ftrace_config { ' +
  'ftrace_events: "power/cpu_frequency" ftrace_events: "power/cpu_idle" ' +
  'ftrace_events: "power/suspend_resume" } } }'

/**
 * WARN 이상만 받는다. 자바 크래시(`FATAL EXCEPTION`), 네이티브 크래시(`Fatal signal`), ANR
 * (`ANR in ...`)은 전부 ERROR 이상이라 다 잡히고, I/D/V 를 빼면 logd 소켓으로 흐르는 양이
 * 한 자릿수 배로 줄어든다.
 *
 * 이 값은 log collector 의 `data.min_prio` 로 결과에 그대로 실린다. "W 118 건" 은 어떤
 * 문턱 아래에서 센 것인지 없이는 읽을 수 없는 숫자다.
 */
export const ANDROID_LOG_MIN_PRIO = 'PRIO_WARN'
export const ANDROID_LOG_BLOCK =
  'data_sources { config { name: "android.log" android_log_config { ' +
  'log_ids: LID_DEFAULT log_ids: LID_SYSTEM log_ids: LID_CRASH ' +
  `min_prio: ${ANDROID_LOG_MIN_PRIO} } } }`
