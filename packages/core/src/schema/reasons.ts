import { POLL_PERIOD_MS } from '../collectors/blocks.js'

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
  /**
   * 프레임 duration 이 버킷에 넣을 수 없는 값이었다 (음수 또는 유한하지 않음).
   * SQL 이 `dur >= 0` 으로 거르므로 정상 트레이스에서는 나오지 않는다.
   * detail: process, duration_ms
   */
  'frame_duration_out_of_range',
  /** trace_processor 쿼리가 실패했다. detail: message */
  'query_failed',
  /** `--launch` 없이 시작한 세션이라 시작 시간을 잴 기회 자체가 없었다. */
  'launch_not_requested',
  /**
   * `am start -W` 는 돌았지만 TotalTime 을 보고하지 않았고, 기기가 그 이유도 말하지 않았다.
   * 기기가 `Status: timeout` 을 낸 경우는 `launch_wait_timed_out` 이다.
   * detail: am_start_status (기기가 낸 `Status:` 원문, 없으면 null)
   */
  'launch_time_unreported',
  /**
   * `am start -W` 가 `Status: timeout` 을 냈다 — ActivityManager 가 실행 완료 보고를
   * 기다리다 포기했고, 그때 TotalTime 은 아예 찍히지 않는다. 앱이 실행되지 않았다는 뜻이
   * **아니다** (실측: 이 상태에서도 앱은 살아 있었고 프레임도 수집됐다).
   * detail: wait_time_ms
   */
  'launch_wait_timed_out',
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
  /**
   * 필요한 `raw/<key>_{before,after}.txt` 가 run 디렉토리에 없거나 비어 있다.
   * **스냅샷 기능이 없던 시절의 옛 run 을 재산출하면 반드시 지나가는 길이다.**
   * `tryShell` 이 명령 실패를 빈 문자열로 흡수하므로 "없다" 와 "비었다" 를 한 코드로 묶는다.
   * detail: key, phase('before' | 'after')
   */
  'snapshot_unavailable',
  /**
   * 원문은 있는데 기대한 절이나 표 머리를 찾지 못했다 (벤더 dumpsys 포맷 차이, 안드로이드
   * 버전 차이). **형식을 추측해서 파싱하지 않는다** — 그러면 뒤바뀐 숫자가 사실 자리에 앉는다.
   * detail: key, section, (있으면) header
   */
  'snapshot_unparsable',
  /** dumpsys thermalservice 출력에 온도 항목이 하나도 없다. */
  'no_thermal_zones',
  /**
   * 온도가 없는 이유가 "센서가 없다" 가 아니라 "HAL 이 안 붙었다" 이다 (`HAL Ready: false`).
   * 두 가지를 한 코드로 묶으면 사용자가 기기 문제인지 도구 문제인지 구분할 수 없다.
   */
  'thermal_hal_not_ready',
  /**
   * before/after 의 존 집합이 달라 일부 존의 델타를 낼 수 없다. 낼 수 있는 것은 내고
   * 못 내는 자리는 null 로 둔다. detail: only_before, only_after
   */
  'thermal_zones_changed',
  /**
   * `target_app.uid` 가 null 이라 per-uid 카운터를 조회할 대상이 없다.
   * (`pm list packages -U` 가 uid 를 주지 않은 경우.) detail: package
   */
  'app_uid_unknown',
  /**
   * 스냅샷에 그 uid 의 행이 없다. 세션 동안 트래픽이 전혀 없었거나 맵에 등재되지 않은 것이다.
   * **0 으로 채워 내지 않는다** — 관측한 0 과 조회하지 못한 것은 다른 사실이다.
   * detail: uid, in_before, in_after
   */
  'uid_not_in_netstats',
  /**
   * 누적 카운터의 after 가 before 보다 작다 (세션 중 재부팅, 앱 재설치로 uid 항목 리셋).
   * 0 으로 뭉개지 않고 사유로 낸다 — CPU collector 가 음수 delta 를 버리는 규칙과 같은 정신이다.
   * detail: counter, before, after
   */
  'counter_went_backwards',
  /**
   * BPF 맵 순회가 재시작되어 같은 uid 가 **서로 다른 값으로** 두 번 찍혔다 (AOSP b/220084230).
   * 값은 마지막 행으로 냈지만 어느 쪽이 맞는지 알 수 없다는 사실을 남긴다.
   * 같은 값으로 두 번 찍힌 경우는 해가 없으므로 이 사유를 달지 않는다.
   * detail: uid, phase
   */
  'netstats_uid_duplicated',
] as const

export type MetricReasonCode = (typeof METRIC_REASON_CODES)[number]

/**
 * sdk_int → 안드로이드 릴리즈 표기. `sdk_too_low` 문장에만 쓴다.
 *
 * 옛 렌더러는 `"Android 12 이상이 필요합니다 (… 최소 sdk_int=${min_sdk})"` 처럼
 * **릴리즈 이름을 하드코딩**하고 숫자는 detail 에서 읽었다. 그것을 쓰는 collector 가
 * frame(31) 하나뿐이라 드러나지 않았을 뿐, 다른 하한을 쓰는 순간
 * `"Android 12 이상이 필요합니다 (… 최소 sdk_int=29)"` 라는 자기모순 문장이 나온다.
 * 모르는 sdk 는 릴리즈 이름 없이 숫자만 말한다 — 지어내지 않는다.
 */
export const ANDROID_RELEASE_BY_SDK: Record<number, string> = {
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
}

const RENDERERS: Record<MetricReasonCode, (d: Record<string, unknown>) => string> = {
  sdk_too_low: (d) => {
    const min = Number(d['min_sdk'])
    const release = ANDROID_RELEASE_BY_SDK[min]
    return (
      `이 기기의 sdk_int=${String(d['sdk_int'])} 로는 수집할 수 없습니다 ` +
      `(최소 sdk_int=${String(d['min_sdk'])}${release !== undefined ? `, Android ${release}` : ''}).`
    )
  },
  data_source_not_registered: (d) =>
    `이 기기에 perfetto 데이터소스가 등록되어 있지 않습니다: ${String(d['data_source'])}`,
  trace_missing: () => '트레이스 원본이 없습니다.',
  render_process_not_found: (d) =>
    `대상 앱(${String(d['package'])})의 렌더 프로세스를 트레이스에서 찾지 못했습니다.`,
  no_frames: (d) => `렌더 프로세스(${String(d['process'])})에서 완료된 프레임을 찾지 못했습니다.`,
  frame_duration_out_of_range: (d) =>
    `렌더 프로세스(${String(d['process'])})의 프레임 duration 에 버킷 범위 밖의 값이 ` +
    `있습니다 (${String(d['duration_ms'])}ms) — 트레이스 쿼리는 성공했고 값 자체가 집계할 수 ` +
    `없는 값입니다.`,
  query_failed: (d) => `트레이스 쿼리에 실패했습니다: ${String(d['message'])}`,
  launch_not_requested: () =>
    '--launch 없이 시작한 세션이라 앱 시작 시간을 재지 않았습니다.',
  launch_time_unreported: (d) =>
    `am start -W 가 TotalTime 을 보고하지 않았습니다` +
    `${d['am_start_status'] != null ? ` (Status: ${String(d['am_start_status'])})` : ''} — ` +
    `앱이 이미 떠 있었거나 액티비티가 바로 끝났을 수 있습니다. ` +
    `앱이 실행됐는지는 이 사유가 말하지 않습니다 (target_app.pid 와 다른 메트릭을 보세요).`,
  launch_wait_timed_out: (d) =>
    `am start -W 가 Status: timeout 을 보고했습니다 — ActivityManager 가 실행 완료 보고를 ` +
    `기다리다 포기해 TotalTime 이 찍히지 않았습니다` +
    `${d['wait_time_ms'] != null ? ` (WaitTime ${String(d['wait_time_ms'])}ms)` : ''}. ` +
    `앱이 실행되지 않았다는 뜻이 아닙니다 — 이 세션에서 시작 시간만 측정되지 않은 것입니다.`,
  no_cpu_samples: () =>
    'linux.sys_stats 의 CPU 시간 표본이 트레이스에 없습니다.',
  // 주기를 문장에 하드코딩하지 않는다. 진실의 출처는 `collectors/blocks.ts` 의
  // `POLL_PERIOD_MS` 하나이고, 그 값이 바뀌면 이 문장도 같이 바뀌어야 한다 —
  // `sdk_too_low` 가 "Android 12" 를 하드코딩하고 있던 것과 정확히 같은 계열이다.
  insufficient_samples: (d) =>
    `표본이 ${String(d['samples'])}개뿐이라 구간 차이를 낼 수 없습니다 ` +
    `(최소 ${String(d['required'])}개 필요). 세션이 폴링 주기(${POLL_PERIOD_MS}ms)보다 짧았을 수 있습니다.`,
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
  snapshot_unavailable: (d) =>
    `세션 ${d['phase'] === 'after' ? '종료' : '시작'} 시점의 ${String(d['key'])} 스냅샷이 ` +
    `이 run 에 없습니다 — 이 도구가 그 명령을 찍기 전에 만들어진 run 이거나, ` +
    `명령이 이 기기에서 실패했거나, 아직 stop 하지 않은 세션입니다.`,
  snapshot_unparsable: (d) =>
    `${String(d['key'])} 원문에서 "${String(d['section'])}" 을 기대한 형식으로 읽지 못했습니다` +
    `${d['header'] != null ? ` (읽은 줄: ${JSON.stringify(d['header'])})` : ''} — ` +
    `형식을 추측해서 값을 만들지 않았습니다. 원본은 run 디렉토리의 raw/ 에 그대로 있습니다.`,
  no_thermal_zones: () => 'dumpsys thermalservice 출력에 온도 항목이 하나도 없습니다.',
  thermal_hal_not_ready: () =>
    'Thermal HAL 이 준비되지 않았다고 기기가 보고했습니다 (HAL Ready: false) — ' +
    '센서가 없는 것이 아니라 HAL 이 붙지 않은 상태입니다.',
  thermal_zones_changed: (d) => {
    const only = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? v.join(', ') : '없음')
    return (
      `세션 전후로 관측된 센서 집합이 달라 일부 존의 변화량을 내지 못했습니다 ` +
      `(시작에만 있던 센서: ${only(d['only_before'])} / 종료에만 있던 센서: ${only(d['only_after'])}). ` +
      `낼 수 있는 존은 그대로 냈고, 못 낸 자리는 null 입니다.`
    )
  },
  app_uid_unknown: (d) =>
    `대상 앱(${String(d['package'])})의 uid 를 알지 못해 네트워크 사용량을 낼 수 없습니다 — ` +
    `이 값은 uid 단위로만 집계됩니다.`,
  uid_not_in_netstats: (d) =>
    `uid ${String(d['uid'])} 의 행이 netstats 스냅샷에 없습니다 ` +
    `(시작: ${d['in_before'] === true ? '있음' : '없음'} / 종료: ${d['in_after'] === true ? '있음' : '없음'}) — ` +
    `부팅 이후 이 uid 로 오간 트래픽이 없었을 수 있습니다. 0 으로 채우지 않았습니다.`,
  counter_went_backwards: (d) =>
    `누적 카운터 ${String(d['counter'])} 가 세션 구간에서 감소했습니다 ` +
    `(${String(d['before'])} → ${String(d['after'])}) — 세션 중 재부팅이나 카운터 리셋이 있었을 수 ` +
    `있습니다. 음수 차이를 0 으로 뭉개지 않았습니다.`,
  netstats_uid_duplicated: (d) =>
    `netstats ${d['phase'] === 'after' ? '종료' : '시작'} 스냅샷에서 uid ${String(d['uid'])} 행이 ` +
    `서로 다른 값으로 두 번 나왔습니다 (BPF 맵 순회 재시작, AOSP b/220084230) — ` +
    `마지막 행을 썼지만 어느 쪽이 맞는지는 이 결과로 알 수 없습니다.`,
}

/** 코드 → 한국어 문장. 모르는 코드는 조용히 비우지 않고 코드 자체를 남긴다. */
export function renderReason(reason: MetricReason | null): string | null {
  if (reason === null) return null
  const render = RENDERERS[reason.code] as ((d: Record<string, unknown>) => string) | undefined
  return render === undefined ? reason.code : render(reason.detail ?? {})
}
