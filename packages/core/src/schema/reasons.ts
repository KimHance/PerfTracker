/**
 * 메트릭이 왜 수집되지 않았는지를 **안정적인 기계 키**로 말한다.
 *
 * 예전에는 `MetricResult.reason` 하나가 두 일을 했다: CI 와 LLM 이 읽는 버전 있는 계약의
 * 필드이면서 동시에 한국어 사용자에게 보내는 터미널 설명. 하나로는 양쪽 다 실패한다 —
 * 기계 키로서는 문구를 다듬는 순간 깨지고, 사람 메시지로서는 영어 산문이었다.
 *
 * 그래서 갈랐다: `reason_code` 는 여기 있는 식별자이고 절대 문구 때문에 바뀌지 않는다.
 * `reason` 은 이 표가 렌더한 사람용 문장이며 언제든 다듬을 수 있다.
 */
export interface MetricReason {
  code: MetricReasonCode
  detail?: Record<string, unknown>
}

export const METRIC_REASON_CODES = [
  /** 기기 SDK 가 이 메트릭의 최소 요구치보다 낮다. detail: sdk_int, min_sdk */
  'sdk_too_low',
  /** 필요한 perfetto 데이터소스가 기기에 등록되어 있지 않다. detail: data_source */
  'data_source_not_registered',
  /** 회수된 트레이스 원본이 run 디렉토리에 없다. */
  'trace_missing',
  /** 트레이스 안에서 대상 앱의 렌더 프로세스를 특정하지 못했다. detail: package */
  'render_process_not_found',
  /** 프로세스는 찾았지만 완료된 프레임이 하나도 없다. detail: process */
  'no_frames',
  /** trace_processor 쿼리가 실패했다. detail: message */
  'query_failed',
  /** `--launch` 없이 시작한 세션이라 시작 시간을 잴 기회 자체가 없었다. */
  'launch_not_requested',
  /** `am start -W` 는 돌았지만 TotalTime 을 보고하지 않았다. */
  'launch_time_unreported',
  /** linux.sys_stats 는 켰는데 트레이스에 cpu.times.* 표본이 하나도 없다. */
  'no_cpu_samples',
  /** 표본이 delta 를 낼 만큼 모이지 않았다 (세션이 폴링 주기보다 짧음). detail: samples, required */
  'insufficient_samples',
  /**
   * 표본은 충분한데 CPU 시간 카운터가 구간 내내 전혀 증가하지 않았다.
   * `insufficient_samples` 와 원인이 다르다 — 이쪽은 표본 수가 아니라 카운터가 문제다.
   * detail: samples
   */
  'cpu_counters_did_not_advance',
  /**
   * 누적이어야 할 CPU 시간 카운터가 구간 안에서 감소했다 (세션 중 재부팅 등).
   * 해당 코어를 통째로 집계에서 제외했다. detail: dropped_cpus
   */
  'cpu_counters_not_monotonic',
  /** 사용률은 나왔지만 power/cpu_frequency 이벤트가 하나도 없다. */
  'cpu_freq_unavailable',
  /** 대상 앱의 프로세스가 process_stats 스캔에 잡히지 않았다. detail: package */
  'process_not_in_trace',
  /** 프로세스는 찾았지만 mem.rss 표본이 없다. detail: process */
  'no_rss_samples',
  /**
   * 트레이스가 그 프로세스를 아직 zygote 이름으로 알고 있어, 캡처 때 받아 둔 pid 로 대상 앱을
   * 특정했다. 값은 정상이고 보고하는 이름은 패키지명이다. detail: package, pid, trace_name
   */
  'process_name_stale_in_trace',
  /** linux.sys_stats 는 켰는데 meminfo 표본이 없다. */
  'no_meminfo_samples',
  /**
   * android.log 는 등록되어 있었지만 트레이스에 로그 항목이 하나도 없다.
   * 두 가지 뜻이 겹친다 — 정말 아무것도 안 찍혔거나, traced_probes 가 logd 를 못 읽었거나.
   */
  'no_log_entries',
  /**
   * 크래시/ANR 배열이 상한(200건)에 닿아 잘렸다. 그 뒤에 더 있었는지는 알 수 없다.
   * 개수(`total` / `by_priority`)는 잘리지 않는다 — 그쪽은 SQL 이 세어 온 값이다.
   * detail: limit
   */
  'log_events_truncated',
] as const

export type MetricReasonCode = (typeof METRIC_REASON_CODES)[number]

const RENDERERS: Record<MetricReasonCode, (d: Record<string, unknown>) => string> = {
  sdk_too_low: (d) =>
    `Android 12 이상이 필요합니다 (기기 sdk_int=${String(d['sdk_int'])}, 최소 sdk_int=${String(d['min_sdk'])}).`,
  data_source_not_registered: (d) =>
    `이 기기에 perfetto 데이터소스가 등록되어 있지 않습니다: ${String(d['data_source'])}`,
  trace_missing: () => '트레이스 원본이 없습니다.',
  render_process_not_found: (d) =>
    `대상 앱(${String(d['package'])})의 렌더 프로세스를 트레이스에서 찾지 못했습니다.`,
  no_frames: (d) => `렌더 프로세스(${String(d['process'])})에서 완료된 프레임을 찾지 못했습니다.`,
  query_failed: (d) => `트레이스 쿼리에 실패했습니다: ${String(d['message'])}`,
  launch_not_requested: () =>
    '--launch 없이 시작한 세션이라 앱 시작 시간을 재지 않았습니다.',
  launch_time_unreported: () =>
    'am start -W 가 TotalTime 을 보고하지 않았습니다 — 앱이 이미 떠 있었거나 액티비티가 바로 끝났을 수 있습니다.',
  no_cpu_samples: () =>
    'linux.sys_stats 의 CPU 시간 표본이 트레이스에 없습니다.',
  insufficient_samples: (d) =>
    `표본이 ${String(d['samples'])}개뿐이라 구간 차이를 낼 수 없습니다 (최소 ${String(d['required'])}개 필요). 세션이 폴링 주기(1초)보다 짧았을 수 있습니다.`,
  cpu_counters_did_not_advance: (d) =>
    `표본은 ${String(d['samples'])}개 있었지만 CPU 시간 카운터가 처음과 끝이 같습니다 — ` +
    `구간 전체가 절전/유휴 상태였을 수 있습니다.`,
  cpu_counters_not_monotonic: (d) =>
    `CPU ${Array.isArray(d['dropped_cpus']) ? d['dropped_cpus'].join(', ') : String(d['dropped_cpus'])}번의 ` +
    `누적 CPU 시간 카운터가 세션 구간에서 감소했습니다 (세션 중 재부팅 등) — ` +
    `해당 코어를 집계에서 통째로 제외했습니다. 함께 나온 값은 남은 코어만의 것입니다.`,
  cpu_freq_unavailable: () =>
    'ftrace power/cpu_frequency 이벤트가 없어 주파수를 함께 내지 못했습니다 — 사용률만 있는 값입니다.',
  process_not_in_trace: (d) =>
    `대상 앱(${String(d['package'])})의 프로세스가 트레이스에 없습니다 — 세션 동안 실행되지 않았을 수 있습니다.`,
  no_rss_samples: (d) => `프로세스(${String(d['process'])})의 메모리 표본을 찾지 못했습니다.`,
  process_name_stale_in_trace: (d) =>
    `트레이스는 이 프로세스(pid ${String(d['pid'])})를 "${String(d['trace_name'])}" 이라는 이름으로 기록했습니다 — ` +
    `zygote 가 fork 한 직후 이름이 확정되기 전에 관측된 것입니다. ` +
    `대상 앱(${String(d['package'])})임은 실행 직후 기기에서 받아 둔 pid 로 확인했고, ` +
    `보고하는 이름은 그 패키지명입니다.`,
  no_meminfo_samples: () =>
    'linux.sys_stats 의 meminfo 표본이 없어 기기 전체 메모리를 함께 내지 못했습니다.',
  no_log_entries: (d) =>
    `트레이스에 로그 항목이 없습니다 (문턱 ${String(d['min_prio'])}). ` +
    `실제로 아무것도 기록되지 않았거나, traced_probes 가 logd 를 읽지 못했을 수 있습니다 ` +
    `(SELinux 가 logdr 소켓을 막는 에뮬레이터 이미지에서 관측된 적이 있습니다).`,
  log_events_truncated: (d) =>
    `크래시/ANR 목록이 상한 ${String(d['limit'])}건에서 잘렸습니다 — ` +
    `그 뒤에 더 있었는지는 이 결과로 알 수 없습니다. 우선순위별 개수는 잘리지 않았습니다.`,
}

/** 코드 → 한국어 문장. 모르는 코드는 조용히 비우지 않고 코드 자체를 남긴다. */
export function renderReason(reason: MetricReason | null): string | null {
  if (reason === null) return null
  const render = RENDERERS[reason.code] as ((d: Record<string, unknown>) => string) | undefined
  return render === undefined ? reason.code : render(reason.detail ?? {})
}
