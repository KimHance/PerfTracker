import { POLL_PERIOD_MS } from '../collectors/blocks.js'
import { DIAGNOSE_COPY, fillCopy } from '../copy/diagnose.js'

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
  /**
   * 렌더 프로세스는 특정했지만 `actual_frame_timeline_slice` 에 그 프로세스의 프레임이
   * 하나도 없었다 — 세션 동안 화면이 갱신되지 않았거나(백그라운드), 앱이 HWUI 를 쓰지
   * 않을 수 있다. 프로세스 자체를 특정하지 못한 경우는 `process_not_in_trace` 다.
   * detail: process
   */
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
   * 프로세스는 찾았지만 `runtime.user_ns` / `runtime.kernel_ns` 카운터가 없다.
   * `record_process_runtime: true` 가 없던 시절의 캡처가 이 길을 지난다.
   * `no_cpu_samples`(기기 전역 표본 없음)와 다른 사실이다 — 이쪽은 그 프로세스만의 문제다.
   * detail: process, pid
   */
  'no_app_cpu_samples',
  /**
   * **이 기기의 sdk 로는 앱 단위 CPU 를 낼 수 없다.** 추측이 아니라 확정이다 —
   * `record_process_runtime` 은 perfetto v44 에서 생긴 필드이고, 그 이전 기기는 그 필드가
   * 든 config 를 **거부한다**(실측 sdk 30: `No field named "record_process_runtime"`).
   * 그래서 `blocks.ts` 가 sdk 35 미만에서는 그 필드를 빼고 보낸다.
   * detail: sdk_int, min_sdk, process, pid
   */
  'app_cpu_sdk_too_low',
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
   *
   * **이 한 코드가 세 갈래를 낸다. `detail` 이 어느 쪽인지 명시한다:**
   *   - `found: false` — **절 자체가 없다.** 그 안드로이드 버전·벤더 출력에 그 절이 아예
   *     없다는 뜻일 수 있다 (netstats 의 `mAppUidStatsMap` 은 sdk 34 부터다).
   *   - `found: true` + `header` — 절은 있는데 **표 머리글이 다르다.** 컬럼 순서를 모르므로
   *     한 행도 읽지 않는다.
   *   - `found: true` + `rows: 0` — 머리는 맞았는데 **행을 한 개도 못 읽었다** (아래 참고).
   *
   * 소비자의 대응이 갈린다: 첫째는 "이 기기에서는 낼 수 없다", 나머지 둘은 "형식이 바뀌었다".
   * 옛 detail 은 이 셋을 `header` 키의 **부재**로만 갈랐고 그 규칙은 이 표에도 렌더러에도
   * 없었다 — 소비자가 추론해야 했다. 지금은 `found` 가 명시한다.
   *
   * **표 머리는 맞았는데 행을 한 개도 못 읽은 경우도 이 코드다** (detail.rows === 0).
   * 머리 고정은 컬럼 순서만 지키고 행의 모양은 지키지 않으므로, 벤더가 행만 다르게 찍으면
   * 0행을 읽고도 파싱이 "성공" 한다. 그것을 uid 부재로 흘려보내면 도구가 관측하지 않은
   * 원인("트래픽이 없었다")을 대게 된다. 표가 실제로 비어 있을 수도 있고 이 도구는 둘을
   * 구분하지 못하므로, 사유 문장이 원인을 단정하지 않고 머리 다음 줄 원문을 함께 남긴다.
   * detail: key, section, phase, found, (있으면) header, rows, first_line
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
   * 표는 읽었는데 **그 uid 의 행만** 없다. 세션 동안 트래픽이 전혀 없었거나 맵에 등재되지
   * 않은 것이다. **0 으로 채워 내지 않는다** — 관측한 0 과 조회하지 못한 것은 다른 사실이다.
   *
   * 표를 **0행** 읽은 경우는 이 코드가 아니라 `snapshot_unparsable` 이다. 둘을 한 코드로
   * 묶으면 형식 드리프트가 "트래픽이 없었다" 로 보고된다.
   * detail: uid, in_before, in_after, rows_before, rows_after
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
  /**
   * **이 숫자는 한 앱의 것이 아니다.** 이 uid 를 쓰는 패키지가 둘 이상 관측됐고
   * (`sharedUserId`), `mAppUidStatsMap` 의 키는 uid 뿐이라 분리할 방법이 없다.
   * 실기기 실측: uid 1000 을 **86개** 패키지가 공유한다.
   *
   * 값은 하나도 빠짐없이 실린다 — `status` 가 `partial` 인 것은 값이 없어서가 아니라
   * 그 값이 무엇의 합인지를 `status` 만 읽는 소비자에게도 알리기 위해서다.
   * 어느 패키지들인지는 `metrics.network.data.shared_uid_packages` 에 전부 있다.
   * detail: uid, package_count
   */
  'uid_shared_by_multiple_packages',
  /**
   * `dumpsys gfxinfo <패키지>` 가 렌더링 집계를 내지 않았다.
   *
   * **기기가 아니라 앱의 성질이다** — Unity · Vulkan · OpenGL 로 그리는 앱은 HWUI 를 쓰지
   * 않아 이 통계가 없다 (안드로이드 Vitals 도 같은 이유로 그 앱들을 집계하지 않는다).
   * 세션 중 앱이 한 번도 렌더링하지 않은 경우도 여기로 온다.
   * detail: package
   */
  'hwui_stats_unavailable',
  /**
   * HWUI 카운터가 **세션 델타가 아니라 프로세스 시작 이후 누적**이다.
   *
   * 세션 전후로 앱 프로세스가 바뀌었다는 뜻이고, `--launch` 세션은 **항상** 여기 해당한다
   * (`start` 가 force-stop 후 콜드로 띄운다). 그 프로세스가 세션 안에서 시작했으므로 누적값이
   * 곧 세션값이지만, 세션 중 앱이 여러 번 죽었다면 **마지막 시작 이후**만 담는다.
   * detail: package
   */
  'hwui_counters_since_process_start',
  /**
   * 이 uid 를 쓰는 패키지를 **열거하지 못했다.** `shared_uid_packages` 가 null 인 경우다.
   *
   * **`detail` 이 두 갈래를 명시한다:**
   *   - `packages_snapshot: false` — `pm list packages -U` 스냅샷 자체가 이 run 에 없다
   *     (그 명령을 찍기 전에 만들어진 run 이거나 원본이 유실됐다).
   *   - `packages_snapshot: true` + `uid_user_id` / `enumerated_user_ids` — 스냅샷은 있는데
   *     **이 uid 가 속한 안드로이드 user 를 그 목록이 한 줄도 열거하지 않았다.**
   *     실기기에서 `pm list packages -U` 는 삼성 시큐어 폴더(user 150)를 열거하지 못하고
   *     (`SecurityException: Shell does not have permission to access user 150` — stderr 로만
   *     나가고 종료 코드는 0 이다), 그런데 `dumpsys netstats` 에는 그 user 의 uid 행이 있다.
   *     이 도구는 그런 uid 의 패키지명을 **알 수 없다** — 그것이 사실이므로 그대로 말한다.
   *
   * 여기서 `[]` 를 내면 "이 uid 를 쓰는 패키지가 없다" 는 거짓이 된다.
   * detail: uid, packages_snapshot, (스냅샷이 있으면) uid_user_id, enumerated_user_ids
   */
  'uid_packages_not_enumerable',
  /**
   * 목록은 이 uid 의 안드로이드 user 를 열거했는데 이 uid 를 쓰는 패키지가 **하나도 없다** —
   * 측정 대상 패키지 자신도 없다. `shared_uid_packages` 가 `[]` 인 경우다.
   *
   * `uid_packages_not_enumerable`(= null) 과 다른 사실이다: 이쪽은 열거에 성공했다.
   * 그래도 `collected` 가 아닌 이유는, 대상 패키지가 그 uid 에 없는 채로 "이 앱의 값" 이라고
   * 내보내면 관측하지 않은 귀속을 사실로 만드는 것이기 때문이다 (세션 도중 앱이 삭제됐거나
   * 매니페스트의 uid 가 이 스냅샷과 다른 기기·시점의 것일 수 있다).
   * detail: uid, package
   */
  'uid_not_in_package_list',
  /**
   * **진단 블록 전용** — 메트릭에는 실리지 않고 `diagnose.app_slices_open_reason_code` 에만 온다.
   *
   * 앱 slice(`atrace_apps` 가 여는 앱 자신의 slice)가 **실릴 수 있던 조건이었는지 모른다.**
   * sdk ≤30 에서 앱 slice 는 debuggable 또는 profileable 앱에만 열리는데, 이 앱은 debuggable 이
   * 아니거나(`false`) 그것을 읽지 못했고(`null`), profileable 은 읽을 출처가 없다
   * (기능 문서 열린 질문 3). 판정은 `session/diagnose.ts` 의 `appSliceOpen` 하나다.
   *
   * 앱이 slice 를 **남겼는지가 아니다** — 그것은 트레이스가 말하고, atrace 마커에 태그가 없어
   * 프레임워크 slice 와 가를 수도 없다 (결정 8). 그래서 이 코드가 붙어도 slice 수 · 표는 잰 그대로다.
   * detail: sdk_int, debuggable(false | null)
   */
  'app_slices_open_unknown',
  /**
   * **진단 블록 전용** — 블록 `reason_code` 에만 온다 (plan D35).
   *
   * 원본에 CPU 별 `ftrace_cpu_*` 통계가 0행이다 — ftrace 가 안 돌았다. slice 0개는 "재 봤더니
   * 없었다" 가 아니므로 블록은 `partial` 이고 slice 수 · 표 · 잃은 이벤트 수가 null 이다.
   * 켜기 오류만 있고 ftrace 는 돈 경우는 이 코드가 아니라 `ftrace_setup_errors` 다 (plan D38 — 값이
   * 있음 · 없음이 정반대인 둘을 한 코드로 두면 기계가 가를 수 없다).
   * detail: ftrace_cpu_stats(0), setup_errors
   */
  'ftrace_not_recorded',
  /**
   * **진단 블록 전용** — 블록 `reason_code` 에만 온다 (plan D37 · D38).
   *
   * ftrace 는 돌았는데(CPU 별 통계가 있다) traced_probes 가 켜다 오류를 냈다(`ftrace_setup_errors` > 0).
   * 오류가 atrace 의 것인지 다른 이벤트의 것인지 원본이 말하지 않아 일부가 빠졌을 수 있다.
   * **잰 수 · 표는 그대로다** — `process_name_stale_in_trace` 처럼 값 있는 `partial`. 실측: gfx · input
   * 카테고리를 켠 원본은 벤더 gfx 이벤트(`mdss` · `dpu` · `sde` …) 28개가 이 기기에 없어 오류 28 인데
   * slice 33만–38만이 실렸다.
   * detail: setup_errors, ftrace_cpu_stats
   */
  'ftrace_setup_errors',
  /**
   * **`target_app` 컴파일 상태 전용** — 메트릭에는 실리지 않고 `target_app.compile_state_{start,end}_reason_code`
   * 에만 온다 (기능 문서 baseline-profile BP-2).
   *
   * `dumpsys package <pkg>` 출력에 `Dexopt state:` 절이 없다. 그 안드로이드 버전 · 벤더 출력에 절이
   * 아예 없을 수 있다 (실측 꼴은 sdk 36 하나 — 열린 질문 1).
   */
  'dexopt_state_section_missing',
  /**
   * **`target_app` 컴파일 상태 전용.** `Dexopt state:` 절은 있는데 대상 패키지의 `[<pkg>]` 줄이 없다.
   * detail: package
   */
  'dexopt_state_package_missing',
  /**
   * **`target_app` 컴파일 상태 전용.** 절도 패키지 줄도 있는데 dex 줄의 꼴을 모른다 — **형식을 추측해
   * 채우지 않는다** (결정 12). 모르는 줄이 하나라도 있거나 dex 줄이 하나도 없으면 이 코드다.
   * `snapshot_unparsable` 과 같은 정신이다.
   * detail: line (모르는 첫 줄 원문 · dex 줄이 하나도 없었으면 null)
   */
  'dexopt_state_unparsable',
  /**
   * **`target_app` 컴파일 상태 전용.** 그 시점의 `dumpsys package` 출력이 없다 — 명령이 실패했거나
   * (기기 끊김), 아직 `stop` 하지 않은 세션을 `extract` 했거나, 끝 상태를 기록하지 않은 도구가 멈춘 run 이다.
   * detail: phase('start' | 'end'), cause('command_failed' | 'session_running' | 'not_recorded'), (있으면) exit_code
   */
  'dexopt_state_unavailable',
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
  no_frames: (d) =>
    `렌더 프로세스(${String(d['process'])})에서 프레임을 하나도 찾지 못했습니다 — ` +
    '세션 동안 화면이 갱신되지 않았거나(백그라운드), 앱이 HWUI 를 쓰지 않을 수 있습니다.',
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
  no_app_cpu_samples: (d) =>
    `대상 앱 프로세스(${String(d['process'])}, pid ${String(d['pid'])})의 CPU 시간 카운터가 ` +
    `트레이스에 없습니다. 이 기기의 sdk 로는 낼 수 있는 값이므로(sdk_int=${String(d['sdk_int'])}), ` +
    `record_process_runtime 이 꺼진 채로 찍힌 옛 캡처를 다시 산출한 경우입니다. ` +
    `기기 전역 값은 그대로 실었고 앱 단위 값만 내지 못했습니다 (0 으로 채우지 않았습니다).`,
  app_cpu_sdk_too_low: (d) =>
    `이 기기의 sdk_int=${String(d['sdk_int'])} 로는 앱 단위 CPU 를 낼 수 없습니다 ` +
    `(최소 sdk_int=${String(d['min_sdk'])}). ProcessStatsConfig 의 record_process_runtime 이 ` +
    `perfetto v44 에서 생겼고 그 이전 기기는 이 필드가 든 config 를 거부하므로, 아예 보내지 ` +
    `않았습니다. 기기 전역 값은 그대로 실었습니다.`,
  process_name_stale_in_trace: (d) =>
    `트레이스는 이 프로세스(pid ${String(d['pid'])})를 "${String(d['trace_name'])}" 이라는 이름으로 기록했습니다 — ` +
    `zygote 가 fork 한 직후 이름이 확정되기 전에 관측된 것입니다. ` +
    `대상 앱(${String(d['package'])})임은 실행 직후 기기에서 받아 둔 pid 로 확인했고, ` +
    `보고하는 이름은 그 패키지명입니다.`,
  no_meminfo_samples: () =>
    'linux.sys_stats 의 meminfo 표본이 없어 기기 전체 메모리를 함께 내지 못했습니다.',
  no_log_entries: (d) =>
    `트레이스에 로그 항목이 하나도 없습니다 (문턱 ${String(d['min_prio'])}). ` +
    `android.log 는 등록돼 있어도 logd 의 logdr 소켓 접근이 막히면 한 줄도 내지 않습니다 — ` +
    `실측: 같은 config 로 SM-A405S(Android 11)가 0줄, SM-F936N(Android 16)이 1,021줄이었습니다. ` +
    `앱이 실제로 아무것도 안 찍었을 수도 있습니다. 이 둘은 트레이스만으로 구분되지 않습니다.`,
  log_events_truncated: (d) =>
    `크래시/ANR 목록이 상한 ${String(d['limit'])}건에서 잘렸습니다 — ` +
    `그 뒤에 더 있었는지는 이 결과로 알 수 없습니다. 우선순위별 개수는 잘리지 않았습니다.`,
  snapshot_unavailable: (d) =>
    `세션 ${d['phase'] === 'after' ? '종료' : '시작'} 시점의 ${String(d['key'])} 스냅샷이 ` +
    `이 run 에 없습니다 — 이 도구가 그 명령을 찍기 전에 만들어진 run 이거나, ` +
    `명령이 이 기기에서 실패했거나, 아직 stop 하지 않은 세션입니다.`,
  snapshot_unparsable: (d) => {
    const tail = '형식을 추측해서 값을 만들지 않았습니다. 원본은 run 디렉토리의 raw/ 에 그대로 있습니다.'
    // 절 자체가 없는 것은 "형식이 달랐다" 와 다른 사실이다 — 그 안드로이드 버전·벤더 출력에
    // 그 절이 아예 없다는 뜻일 수 있다. 옛 문장은 둘을 "기대한 형식으로 읽지 못했습니다" 로
    // 뭉쳤고, 가르는 단서는 detail 의 `header` 키가 없다는 것뿐이었다.
    if (d['found'] === false) {
      return (
        `${String(d['key'])} 원문에 "${String(d['section'])}" 절이 없습니다 — ` +
        `이 안드로이드 버전이나 벤더 출력에 그 절이 아예 없을 수 있습니다. ${tail}`
      )
    }
    // 머리는 맞았는데 행이 0개인 경우. **원인을 단정하지 않는다** — 표의 행 모양이 다른 것과
    // 표가 실제로 비어 있는 것을 이 도구는 구분하지 못하고, 어느 쪽이라고 말하면 관측하지
    // 않은 것을 사실로 내보내는 것이 된다.
    if (d['rows'] === 0) {
      return (
        `${String(d['key'])} 원문의 "${String(d['section'])}" 표 머리는 기대와 같았지만 ` +
        `행을 한 개도 읽지 못했습니다` +
        `${d['first_line'] != null ? ` (머리 다음 줄: ${JSON.stringify(d['first_line'])})` : ''} — ` +
        `행의 모양이 기대와 다르거나 표가 실제로 비어 있습니다. **이 도구는 둘을 구분하지 못합니다.** ` +
        `${tail}`
      )
    }
    return (
      `${String(d['key'])} 원문에서 "${String(d['section'])}" 을 기대한 형식으로 읽지 못했습니다` +
      `${d['header'] != null ? ` (읽은 줄: ${JSON.stringify(d['header'])})` : ''} — ${tail}`
    )
  },
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
    // 표에서 몇 행을 읽었는지를 같이 말한다. "표에 400행 있었는데 내 uid 만 없다" 와
    // "표를 거의 못 읽었다" 는 소비자에게 전혀 다른 신호이고, 행 수 없이는 가를 수 없다.
    `표에서 읽은 행은 시작 ${String(d['rows_before'] ?? '?')}행 / 종료 ${String(d['rows_after'] ?? '?')}행입니다. ` +
    `부팅 이후 이 uid 로 오간 트래픽이 없었을 수 있습니다. 0 으로 채우지 않았습니다.`,
  counter_went_backwards: (d) =>
    `누적 카운터 ${String(d['counter'])} 가 세션 구간에서 감소했습니다 ` +
    `(${String(d['before'])} → ${String(d['after'])}) — 세션 중 재부팅이나 카운터 리셋이 있었을 수 ` +
    `있습니다. 음수 차이를 0 으로 뭉개지 않았습니다.`,
  netstats_uid_duplicated: (d) =>
    `netstats ${d['phase'] === 'after' ? '종료' : '시작'} 스냅샷에서 uid ${String(d['uid'])} 행이 ` +
    `서로 다른 값으로 두 번 나왔습니다 (BPF 맵 순회 재시작, AOSP b/220084230) — ` +
    `마지막 행을 썼지만 어느 쪽이 맞는지는 이 결과로 알 수 없습니다.`,
  hwui_counters_since_process_start: (d) =>
    `${String(d['package'])} 의 HWUI 수치는 세션 전후 차이가 아니라 **프로세스 시작 이후 누적**` +
    `입니다 — 세션 중 프로세스가 새로 떴습니다(--launch 세션은 항상 그렇습니다). ` +
    `그 프로세스가 세션 안에서 시작했으므로 세션값과 같지만, 앱이 여러 번 죽었다면 ` +
    `마지막 시작 이후만 담습니다.`,
  hwui_stats_unavailable: (d) =>
    `${String(d['package'])} 가 dumpsys gfxinfo 로 렌더링 집계를 내지 않았습니다 — ` +
    `HWUI(View 계층)로 그리지 않는 앱이거나(Unity · Vulkan · OpenGL) 세션 중 한 번도 ` +
    `렌더링하지 않았습니다. Unity·Vulkan·OpenGL 앱이 그렇고, 그것은 Vitals 와 같은 한계입니다.`,
  uid_shared_by_multiple_packages: (d) =>
    `uid ${String(d['uid'])} 를 패키지 ${String(d['package_count'])}개가 함께 씁니다 — ` +
    `이 숫자는 그 ${String(d['package_count'])}개가 주고받은 것의 **합계**이고 대상 앱 몫만 ` +
    `떼어 낼 수 없습니다 (mAppUidStatsMap 의 키가 uid 뿐입니다). ` +
    `값은 전부 실었습니다. 어느 패키지들인지는 data.shared_uid_packages 에 있습니다.`,
  uid_packages_not_enumerable: (d) =>
    d['packages_snapshot'] === false
      ? `이 run 에 pm list packages -U 스냅샷이 없어 uid ${String(d['uid'])} 를 어느 패키지가 ` +
        `쓰는지 확인하지 못했습니다 — data.shared_uid_packages 가 null 인 이유입니다. ` +
        `값은 전부 실었지만 그것이 몇 개 패키지의 합인지는 이 결과로 알 수 없습니다.`
      : `uid ${String(d['uid'])} 는 안드로이드 user ${String(d['uid_user_id'])} 의 것인데, ` +
        `pm list packages -U 목록은 user ` +
        `${Array.isArray(d['enumerated_user_ids']) && d['enumerated_user_ids'].length > 0 ? d['enumerated_user_ids'].join(', ') : '없음'}` +
        ` 만 열거했습니다 — 이 셸 권한으로는 그 user 의 패키지를 볼 수 없습니다 ` +
        `(삼성 시큐어 폴더 등. 기기는 이 거부를 stderr 로만 말하고 종료 코드는 0 입니다). ` +
        `그래서 패키지명을 **알 수 없고**, 빈 배열 대신 null 을 냈습니다 — ` +
        `[] 는 "이 uid 를 쓰는 패키지가 없다" 라는 다른 사실입니다.`,
  uid_not_in_package_list: (d) =>
    `uid ${String(d['uid'])} 를 쓰는 패키지가 pm list packages -U 목록에 하나도 없습니다 — ` +
    `측정 대상(${String(d['package'])}) 자신도 그 uid 로 등재되어 있지 않습니다. ` +
    `목록은 이 uid 의 안드로이드 user 를 열거했으므로 "못 봤다" 가 아니라 "없다" 입니다. ` +
    `값은 전부 실었지만 이 숫자를 그 패키지의 것이라고 말할 근거를 확인하지 못했습니다.`,
  // 진단 모드의 새 문구라 단어형이다 (DM-15) — 문장은 이 표가 아니라 문구 모음이 주인이고
  // 정본은 디자인 문서 `## 문구` 표다. 기존 사유 문장(합쇼체)은 그대로 둔다 (plan D10).
  app_slices_open_unknown: (d) =>
    fillCopy(
      d['debuggable'] === false ? DIAGNOSE_COPY.reasonNotDebuggable : DIAGNOSE_COPY.reasonDebuggableUnknown,
      d['sdk_int'] !== undefined ? { sdk: String(d['sdk_int']) } : {},
    ),
  ftrace_not_recorded: () => DIAGNOSE_COPY.reasonFtraceNoStats,
  ftrace_setup_errors: (d) =>
    fillCopy(DIAGNOSE_COPY.reasonFtraceSetupErrors, d['setup_errors'] != null ? { count: String(d['setup_errors']) } : {}),
  // baseline-profile 의 새 문구도 단어형이다 (BP-6 · DM-15 규칙) — 평가 낱말 · 권유 0.
  dexopt_state_section_missing: () =>
    'dumpsys package 출력에 Dexopt state 절 없음 — 이 기기 · 안드로이드 버전의 출력 꼴이 다를 수 있음 · 꼴을 추측해 채우지 않음',
  dexopt_state_package_missing: (d) =>
    `Dexopt state 절에 ${String(d['package'])} 줄 없음 — 꼴을 추측해 채우지 않음`,
  dexopt_state_unparsable: (d) =>
    d['line'] != null
      ? `Dexopt state 절에 꼴을 모르는 줄 있음 (${JSON.stringify(String(d['line']).trim())}) — 꼴을 추측해 채우지 않음`
      : 'Dexopt state 절에 대상 패키지의 dex 줄 없음 — 꼴을 추측해 채우지 않음',
  dexopt_state_unavailable: (d) => {
    const when = d['phase'] === 'start' ? '세션 시작' : '세션 끝'
    if (d['cause'] === 'session_running') return `아직 stop 하지 않은 세션 — ${when} 컴파일 상태를 읽지 않음`
    if (d['cause'] === 'not_recorded') return `이 run 에 ${when} 컴파일 상태 기록 없음 — 그것을 읽기 전의 도구가 멈춘 run`
    const code = d['exit_code'] != null ? ` (종료 코드 ${String(d['exit_code'])})` : ''
    return `${when} dumpsys package 출력을 받지 못함${code} — 기기 연결이 끊겼을 수 있음`
  },
}

/** 코드 → 한국어 문장. 모르는 코드는 조용히 비우지 않고 코드 자체를 남긴다. */
export function renderReason(reason: MetricReason | null): string | null {
  if (reason === null) return null
  const render = RENDERERS[reason.code] as ((d: Record<string, unknown>) => string) | undefined
  return render === undefined ? reason.code : render(reason.detail ?? {})
}
