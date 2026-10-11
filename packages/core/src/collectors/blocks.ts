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

/**
 * 소비자 둘이 공유한다: **memory**, **overhead**.
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
 * **다만 그 필드는 기기가 아는 경우에만 나간다. 아래를 보라.**
 */

/**
 * `record_process_runtime` 이 **Android 15(sdk 35)부터** 존재한다. perfetto v44(2024-04)에서
 * 추가됐고 그 이전 플랫폼의 `ProcessStatsConfig` 에는 이 필드가 아예 없다.
 *
 * **모르는 필드 하나가 config 전체를 거부시킨다.** perfetto 는 config 를 부분 수용하지 않아서
 * 이 필드 때문에 Android 14 이하에서는 **세션 자체가 열리지 않았다** — 오버헤드 자가측정
 * 하나 때문에 지표 일곱 개가 전부 죽는 구조였다:
 *
 * ```
 * error: No field named "record_process_runtime" in proto ProcessStatsConfig
 * ```
 *
 * **실측 범위:** SM-A405S(Android 11) 와 에뮬레이터(Android 14) 에서 이 필드만 빼면 나머지
 * 블록이 전부 통과하는 것을 확인했다. Android 12·13 은 이미지가 없어 AOSP proto 로만 봤지만,
 * proto 필드는 추가만 되고 사라지지 않으므로 13 에 없으면 12 에도 없다.
 * 반대쪽 끝은 SM-F936N(Android 16) 실측이다.
 *
 * 이 필드가 빠진 세션에서는 `measurement_overhead` 의 CPU 필드가 `null` 이 된다 —
 * `extract/overhead.ts` 가 카운터를 못 찾으면 0 이 아니라 null 을 내므로 그 자리는 이미 맞다.
 * **`null` 은 "안 쟀다" 이고, 그것이 이 기기에서 참인 문장이다.**
 */
export const PROCESS_RUNTIME_MIN_SDK = 35

/**
 * 소스마다 블록 하나라는 규칙은 그대로다 — 다만 이 블록만 **기기에 따라 텍스트가 달라진다.**
 * 한 세션 안에서 sdk 는 하나이므로 이 함수를 부르는 collector 넷(frame · cpu · memory · log)은
 * 언제나 같은 문자열을 받고, `mergeTraceConfigBlocks` 의 "같은 소스는 같은 텍스트" 검사도
 * 그대로 성립한다.
 *
 * 나머지 설명(소비자 셋, scan_all_processes_on_start 의 뜻, 프로세스 이름이 낡는 문제)은
 * 아래 그대로다.
 *
 * `scan_all_processes_on_start: true` 는 세션 시작 시점의 전체 스냅샷을 남긴다. 폴링은
 * 매 주기마다 /proc 전체를 훑으므로(실측: 실기기 트레이스에 953개 프로세스) 대상 앱을
 * 따로 지정할 필요가 없다 — 단 이것은 **카운터** 갱신에 대한 이야기다.
 * **프로세스 이름은 최초 관측 때 한 번만 확정되고 다시 읽히지 않는다.** zygote 가 fork 한
 * 앱은 `Process.setArgV0()` 이전에 관측되면 트레이스에 `zygote64` 로 남는다 (실측 확인).
 * 그래서 `collectors/appProcess.ts` 가 캡처 때 받아 둔 pid 를 두 번째 근거로 쓴다.
 */
export function processStatsBlock(sdkInt: number): string {
  const runtime = sdkInt >= PROCESS_RUNTIME_MIN_SDK ? ' record_process_runtime: true' : ''
  return (
    'data_sources { config { name: "linux.process_stats" ' +
    `process_stats_config { proc_stats_poll_ms: ${POLL_PERIOD_MS} ` +
    `scan_all_processes_on_start: true${runtime} } } }`
  )
}

/**
 * cpu(사용률) 와 memory(시스템 메모리) 가 공유한다.
 *
 * 주기 키 이름이 `stat_period_ms` / `meminfo_period_ms` 라서 `assertLowOverheadConfig` 의
 * 1000ms 하한 검사를 실제로 받는다 — 의도한 것이다.
 * `cpufreq_period_ms`(sysfs 폴링)는 **쓰지 않는다.** 스펙이 지정한 주파수 출처는 ftrace
 * `power/cpu_frequency` 이고, 같은 값을 두 경로로 받을 이유가 없다.
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
 * cpu collector 가 **실제로 읽는** ftrace 이벤트 하나뿐이다.
 * `power/cpu_frequency` 는 주파수가 실제로 바뀔 때만 뜨고, `cpu.ts` 의 `CPU_FREQ_SQL` 이
 * 그것을 `cpufreq` 카운터 트랙으로 읽는다.
 *
 * 여기 `power/cpu_idle` 과 `power/suspend_resume` 이 함께 있었다. 둘을 읽는 코드는 저장소에
 * 하나도 없었는데, 4코어 에뮬레이터 33초 세션에서 `cpu_idle` 만 **47,752건**(초당 약 1,450건)
 * 으로 ftrace 이벤트 50,654건의 **94%** 였다. `suspend_resume` 은 0건이었다 — adb 가 붙어
 * 있는 기기는 서스펜드하지 않으므로 애초에 아무것도 주지 않는 이벤트였다.
 * 읽지 않는 이벤트는 트레이스만 키우는 것이 아니라 커널이 매 이벤트마다 링버퍼에 쓰는 비용을
 * 대상 앱이 돌던 코어에 청구한다 — 원칙 1 위반이다.
 * 필요해지면 **그것을 읽는 collector 와 같은 커밋에** `ALLOWED_FTRACE_EVENTS` 와 함께 넣는다.
 *
 * `drain_period_ms` 를 일부러 지정하지 않고 perfetto 기본값을 쓴다. (예전에는 "그 키가
 * `assertLowOverheadConfig` 의 주기 화이트리스트 밖이라 어떤 값이든 통과한다" 는 것이 이유의
 * 절반이었는데, 그 화이트리스트는 이제 없다 — `*_period_ms` 는 전부 1000ms 하한을 받는다.)
 */
export const FTRACE_POWER_BLOCK =
  'data_sources { config { name: "linux.ftrace" ftrace_config { ' +
  'ftrace_events: "power/cpu_frequency" } } }'

/** 진단 세션이 켜는 atrace 범위. 카테고리 · 앱 slice 대상 (DM-3). */
export interface AtraceScope {
  categories: readonly string[]
  apps: readonly string[]
}

/**
 * **진단 세션의 `linux.ftrace` 블록.** atrace 는 별도 데이터소스가 아니라 `linux.ftrace` 의
 * 키라서, 소스 하나 · 블록 하나 규칙 아래에서는 `FTRACE_POWER_BLOCK` 과 **같은 블록 안에**
 * 들어가야 한다. 그래서 그 블록을 대신하는 텍스트를 여기서 만든다 — 주인은 이 파일이다.
 *
 * `withPowerEvents` 는 평소 세션이 그 블록을 요청했는가다 (`collectTraceConfigBlocks`).
 * 진단 세션의 `ftrace_events` 는 **평소 세션과 같은 집합**이어야 한다 (DM-3) — cpu 가
 * 미지원이라 평소에 이벤트가 없는 기기에서 여기서 이벤트를 켜면 아무도 읽지 않는 이벤트가 된다.
 * 이벤트 부분은 `FTRACE_POWER_BLOCK` 과 글자까지 같다 (시험이 둘을 대조한다).
 */
export function diagnoseFtraceBlock(scope: AtraceScope, withPowerEvents: boolean): string {
  const events = withPowerEvents ? 'ftrace_events: "power/cpu_frequency" ' : ''
  const categories = scope.categories.map((c) => `atrace_categories: "${c}" `).join('')
  const apps = scope.apps.map((a) => `atrace_apps: "${a}" `).join('')
  return `data_sources { config { name: "linux.ftrace" ftrace_config { ${events}${categories}${apps}} } }`
}

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

/**
 * **SurfaceFlinger 가 프레임마다 한 건씩 민다.** 폴링도 ftrace 도 아니라 주기 설정이 없다.
 *
 * 부하가 없다는 것을 실기기에서 재고 넣는다 (SM-F936N, 20초 세션 A/B 7쌍):
 * 대상 앱 CPU -0.08초 · SurfaceFlinger CPU -0.11초 — **켠 쪽이 오히려 낮았고**
 * 세션 간 편차(±0.2초)보다 작다. 생산자가 `/system/bin/surfaceflinger` 라서
 * ftrace 처럼 인터럽트당한 프로세스(= 대상 앱)에 비용이 청구되지 않는다.
 * 대가는 트레이스 부피 +43%(20초에 +317KB) 하나뿐이다.
 */
export const FRAMETIMELINE_BLOCK =
  'data_sources { config { name: "android.surfaceflinger.frametimeline" } }'
