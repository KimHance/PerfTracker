import { z } from 'zod'
import { METRIC_REASON_CODES, type MetricReasonCode } from './reasons.js'

// 1.1.0 — M2 가 metrics 에 startup / cpu / memory / log 를, M3 가 thermal / network 를
// optional 로 더했다. 1.0.0 문서(frame 하나만 있는)는 여전히 이 스키마를 통과한다.
//
// **M3 에서도 1.1.0 그대로 간다.** 1.1.0 은 아직 출시된 적이 없다 (M2 가 병합됐을 뿐
// 릴리스가 없다). 미출시 버전 안에서의 확장은 버전 사유가 아니다 — 지금 1.2.0 을 찍으면
// "1.1.0 이라는 더 좁은 계약이 세상에 존재했다" 는 없던 역사를 만든다.
//
// **출시 후의 규칙 (M4 가 이 표를 그대로 쓴다):**
//   metrics 에 새 키를 .optional() 로 추가        → minor  (옛 문서가 통과한다)
//   metrics 에 새 키를 required 로 추가           → major  (옛 문서가 깨진다)
//   reason_code enum 값 추가                      → minor  (계약이 넓어질 뿐이다)
//   reason_code enum 값 삭제·개명                 → major  (매칭하던 소비자가 깨진다)
//   기존 객체에 optional 필드 추가                → minor
//   기존 객체에 required 필드 추가                → major
//   references[] 항목 추가                        → 버전 사유 아님 (스키마가 아니라 값이다)
//   non-null 필드를 nullable 로 넓히기            → major  (보장을 받던 소비자가 깨진다)
//
// 그래서 새 metrics 키는 **항상 optional 로** 넣는다 — required 로 넣는 순간 major 가 된다.
// M3 가 한 것은 위 표의 minor 항목들(새 키 2개, reason_code 9개 추가, thermal_zones 에
// type/status/source 를 optional 로 추가)과 "버전 사유 아님"(references 1건)뿐이다.
// 출시 후였다면 1.2.0 이었을 것이고, 미출시이므로 1.1.0 그대로다.
export const SCHEMA_VERSION = '1.1.0'

/**
 * `partial` 이면서 `data` 가 **null** 인 결과를 내는 사유 코드들 — 즉 "값이 아예 안 나왔다".
 *
 * 소스 진실은 각 collector 의 `{ collected: false, reason }` 분기다 (거기서 `status` 를
 * 따로 주지 않으면 `partial` 이 된다). 여기 손으로 옮겨 적는 이유는 `z.toJSONSchema()` 가
 * 런타임이라 코드를 훑지 못하기 때문이고, **그래서 이 목록은 낡을 수 있다.**
 * 그 사실을 describe 문구가 직접 말하고, 소비자에게는 `data !== null` 로 판정하라고 시킨다 —
 * 목록을 계약으로 만들면 새 collector 가 생길 때마다 조용히 거짓이 된다.
 *
 * 이 배열의 모든 값이 실재하는 `MetricReasonCode` 인지는 테스트가 고정한다.
 *
 * **`snapshot_unavailable` 은 이 목록에서 유일하게 양쪽에 걸친 코드다.** network 는 시작
 * 스냅샷이 없으면 값을 통째로 못 내지만(`network.ts` — 누적 카운터는 한쪽만으로 뜻이 없다),
 * thermal 은 **종료** 스냅샷만 없을 때 시작 스냅샷의 값을 낸 채 같은 코드를 `partialReason`
 * 으로 붙인다(`thermal.ts`) — `stop` 전 세션을 extract 하면 **반드시** 지나가는 길이다.
 * 그래서 이 코드만 보고 `data` 유무를 추론하면 틀린다. 목록을 계약으로 만들지 않은 이유가
 * 바로 이런 것이고, describe 문구가 그 사실을 소비자에게 직접 말한다.
 */
const DATA_NULL_PARTIAL_CODES = [
  'render_process_not_found',
  'no_frames',
  'frame_duration_out_of_range',
  'no_cpu_samples',
  'insufficient_samples',
  'cpu_counters_did_not_advance',
  'cpu_counters_not_monotonic',
  'process_not_in_trace',
  'no_rss_samples',
  'no_log_entries',
  'launch_time_unreported',
  'launch_wait_timed_out',
  'snapshot_unavailable',
  'snapshot_unparsable',
  'no_thermal_zones',
  'thermal_hal_not_ready',
  'app_uid_unknown',
  'uid_not_in_netstats',
  'counter_went_backwards',
] as const satisfies readonly MetricReasonCode[]

/**
 * 수집 실패와 미지원을 null 로 뭉뚱그리지 않기 위한 상태 구분.
 *
 * 네 값의 뜻이 소스 주석에만 있었고, 그중 `partial` 이 두 가지 상황을 겸한다는 사실은
 * 어디에도 없었다. `perftracker schema` 는 `z.toJSONSchema` 라 주석을 보지 못하므로,
 * `status === 'failed'` 로 문제를 거르는 CI 는 값이 통째로 없는 메트릭을 전부 통과시켰다.
 */
export const MetricStatusSchema = z
  .enum(['collected', 'partial', 'unsupported', 'failed', 'skipped'])
  .describe(
    '이 메트릭의 수집 상태.\n' +
      '- collected: 값이 전부 나왔다. data 는 non-null 이고 reason_code 는 null 이다.\n' +
      '- partial: **두 가지를 겸한다.** (a) 값은 나왔지만 일부가 빠졌다(예: CPU 사용률은 ' +
      '있고 주파수가 없다) — 이때 data 는 non-null 이다. (b) **값이 아예 나오지 않았다** — ' +
      '이때 `data` 는 **null** 이다. 둘 다 reason_code 가 어느 쪽인지 말한다. ' +
      `data 가 null 인 partial 을 내는 reason_code 는 이 버전에서 ${DATA_NULL_PARTIAL_CODES.join(', ')} ` +
      '이다. **이 목록은 참고용이고 계약이 아니다** — 새 collector 가 생기면 늘어난다. ' +
      "판정은 반드시 `data !== null`(또는 `status === 'collected'`)로 하고 이 목록으로 하지 말 것. " +
      '스냅샷 계열(snapshot_unavailable / snapshot_unparsable)이 특히 흔하다: 이 도구가 ' +
      '스냅샷을 찍기 전에 만들어진 옛 run 을 재산출하면 thermal / network 가 반드시 그 길을 지난다.\n' +
      '**`snapshot_unavailable` 은 위 목록에서 유일하게 양쪽에 걸친 코드다.** network 는 시작 ' +
      '스냅샷이 없으면 값을 통째로 내지 못하지만(data null), thermal 은 **종료** 스냅샷만 ' +
      '없을 때 시작 스냅샷의 값을 낸 채 같은 코드를 붙인다(data non-null) — 아직 stop 하지 ' +
      '않은 세션을 extract 하면 반드시 지나가는 길이다. ' +
      '**이 코드로 data 유무를 추론하지 말 것.** 목록을 계약으로 만들지 않은 이유가 이런 ' +
      '것이며, 이 코드가 그 산 증거다.\n' +
      '- unsupported: 이 기기가 이 메트릭을 낼 수 없다 (sdk 하한 미달, 데이터소스 미등록). ' +
      'data 는 null 이다.\n' +
      '- failed: 예외 상황 전용이다 — 트레이스 원본이 없거나(trace_missing) ' +
      'trace_processor 쿼리가 예외로 터진 경우(query_failed). data 는 null 이다.\n' +
      '- skipped: 수집을 시도조차 하지 않았다 (`--launch` 없이 시작한 세션의 startup). ' +
      'data 는 null 이다.\n' +
      '**`failed` 만 걸러서는 수집 실패를 잡지 못한다.** 값이 있어야 하는 소비자는 ' +
      "`status === 'collected'` 이거나 `data !== null` 인지를 보라.",
  )
export type MetricStatus = z.infer<typeof MetricStatusSchema>

/**
 * 모든 메트릭은 status 와 source 를 갖는다. source 는 "어떤 방법으로 잰 값인지"의 기록.
 *
 * `reason_code` 와 `reason` 은 일부러 두 필드다. 앞엣것은 CI 와 LLM 이 매칭하는 안정적인
 * 식별자이고, 뒤엣것은 사람이 읽는 (한국어) 문장이라 언제든 다듬을 수 있다.
 * 산문에게 식별자 노릇을 시키면 문구를 고칠 때마다 소비자가 깨진다.
 */
export function metricResultSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: MetricStatusSchema,
    source: z.string(),
    // 값 집합을 스키마에 실어 내보낸다. "안정적인 키" 라고 말만 하고 type: string 을 내보내면
    // 매처를 쓰는 쪽은 무엇에 매칭해야 하는지 여전히 알 수 없다.
    reason_code: z
      .enum(METRIC_REASON_CODES)
      .nullable()
      .describe('기계가 매칭하는 안정적인 사유 키. 사람용 문장은 reason 에 있다.'),
    reason: z.string().nullable().describe('사람이 읽는 사유. 문구는 다듬힐 수 있으니 매칭에 쓰지 말 것.'),
    data: data.nullable(),
  })
}

export type MetricResult<T> = {
  status: MetricStatus
  source: string
  reason_code: MetricReasonCode | null
  reason: string | null
  data: T | null
}

/** to_ms 가 null 인 버킷은 상한 없는 마지막 버킷(700+). */
export const FrameBucketSchema = z.object({
  from_ms: z.number(),
  to_ms: z.number().nullable(),
  count: z.number().int().nonnegative(),
})
export type FrameBucket = z.infer<typeof FrameBucketSchema>

/**
 * 프로세스 이름의 출처를 스키마에 싣는다. 트레이스가 갓 fork 된 앱을 `zygote64` 로 기록하는
 * 경우가 있어서, 이 도구는 이름이 맞지 않으면 캡처 때 받아 둔 pid 로 대상 앱을 특정한다.
 * 그때 `status` 는 `partial`, `reason_code` 는 `process_name_stale_in_trace` 다.
 */
const PROCESS_NAME_DESCRIPTION =
  '대상 앱 프로세스의 이름. 트레이스의 프로세스 이름이 패키지명(또는 `패키지:서브프로세스`)과 ' +
  '일치했거나, 일치하지 않았을 때는 실행 직후 기기에서 받아 둔 pid 로 대상 앱임을 확인한 뒤 ' +
  '패키지명을 적은 것이다. 후자의 경우 reason_code 가 process_name_stale_in_trace 로 그 사실을 ' +
  '말한다. 둘 중 어느 것으로도 확인되지 않으면 이 메트릭은 값을 내지 않는다 — ' +
  '확인되지 않은 이름이 이 자리에 오는 일은 없다.'

export const FrameDataSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  /** 그 프로세스의 pid. target_app.render_process / target_app.pid 가 여기서 채워진다. */
  pid: z.number().int(),
  total_frames: z.number().int().nonnegative(),
  buckets: z.array(FrameBucketSchema),
  within_16_67ms_ratio: z.number(),
  percentiles: z.object({
    p50: z.number(),
    p90: z.number(),
    p95: z.number(),
    p99: z.number(),
  }),
  mean_ms: z.number(),
  max_ms: z.number(),
})
export type FrameData = z.infer<typeof FrameDataSchema>

export const StartupDataSchema = z.object({
  /** `am start -W` 의 TotalTime — 프로세스 시작부터 첫 프레임까지. */
  total_time_ms: z.number().int().nonnegative(),
  /**
   * `am start -W` 의 LaunchState 원문 (COLD / WARM / HOT). 기기가 보고하지 않으면 null.
   * enum 으로 좁히지 않는다 — 우리가 정하는 값이 아니라 기기가 뱉는 문자열이다.
   */
  launch_state: z.string().nullable(),
})
export type StartupData = z.infer<typeof StartupDataSchema>

export const CpuCoreUsageSchema = z.object({
  cpu: z.number().int(),
  busy_pct: z.number(),
})
export type CpuCoreUsage = z.infer<typeof CpuCoreUsageSchema>

export const CpuFrequencySchema = z.object({
  cpu: z.number().int(),
  samples: z.number().int().nonnegative(),
  min_khz: z.number(),
  max_khz: z.number(),
  avg_khz: z.number(),
})
export type CpuFrequency = z.infer<typeof CpuFrequencySchema>

export const CpuDataSchema = z.object({
  /** 첫 표본과 마지막 표본 사이. 폴링이라 세션 길이와 정확히 같지 않다. */
  sampled_ms: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative(),
  total_busy_pct: z
    .number()
    .describe(
      '코어를 합친 사용률. (총 CPU시간 − idle − iowait) / 총 CPU시간. ' +
        '**기기 전체의 값이며 대상 앱만의 값이 아니다** — /proc/stat 은 프로세스를 구분하지 않는다. ' +
        '누적 카운터가 되감긴 코어는 집계에서 통째로 빠지므로, ' +
        'reason_code 가 cpu_counters_not_monotonic 이면 이 값은 per_core 에 남은 코어만의 것이다.',
    ),
  per_core: z
    .array(CpuCoreUsageSchema)
    .describe(
      '코어별 사용률. 기기의 모든 코어가 항상 들어 있다고 가정하면 안 된다 — ' +
        '카운터가 되감긴 코어는 빠지고, 그 사실은 reason_code 로 알린다.',
    ),
  /**
   * ftrace `power/cpu_frequency` 로 관측한 코어별 주파수(kHz).
   * 이벤트가 하나도 없으면 **null** 이다 — 사용률만 있는 결과가 사용률+주파수인 척하지 않게.
   */
  frequency: z.array(CpuFrequencySchema).nullable(),
})
export type CpuData = z.infer<typeof CpuDataSchema>

/** 세션 구간의 관측 통계. 값은 kB 다 — trace_processor 는 바이트로 주므로 반드시 변환한다. */
export const MemoryStatSchema = z.object({
  min_kb: z.number().int(),
  max_kb: z.number().int(),
  avg_kb: z.number().int(),
})
export type MemoryStat = z.infer<typeof MemoryStatSchema>

export const SystemMemorySchema = z.object({
  mem_total_kb: z.number().int(),
  mem_available: MemoryStatSchema,
  mem_free: MemoryStatSchema,
  cached: MemoryStatSchema,
  swap_total_kb: z.number().int(),
  swap_free: MemoryStatSchema,
})
export type SystemMemory = z.infer<typeof SystemMemorySchema>

export const MemoryDataSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  pid: z.number().int(),
  samples: z.number().int().nonnegative(),
  rss: MemoryStatSchema,
  rss_anon: MemoryStatSchema.nullable(),
  rss_file: MemoryStatSchema.nullable(),
  /**
   * `mem.rss.watermark` (= /proc/pid/status 의 VmHWM). 커널이 기억하는 최고점이다.
   * 이 필드만 세션 구간의 값이 아니라서, 그 사실이 반드시 `.describe()` 에 있어야 한다 —
   * 바로 위 `rss` 는 세션 통계이고 둘이 나란히 놓이면 같은 구간으로 읽힌다.
   */
  rss_watermark_peak_kb: z
    .number()
    .int()
    .nullable()
    .describe(
      '커널이 기억하는 이 프로세스의 최고 RSS(kB). `/proc/<pid>/status` 의 VmHWM 이다.\n' +
        '**이 값만 세션 구간의 값이 아니다 — 프로세스가 시작된 뒤 지금까지의 최고점이다.** ' +
        '옆의 rss.max_kb 는 이 세션에서 1초 주기로 관측한 최댓값이고, 이 값은 그 이전에 찍힌 ' +
        '최고점일 수 있다. 특히 `--launch` 없이 이미 떠 있던 앱을 잰 세션에서는 몇 시간 전, ' +
        '혹은 이전 세션의 최고점이 그대로 실린다 (실측: 연속 세션 두 개가 rss.max_kb 는 ' +
        '399,056 / 393,668 으로 달랐는데 이 값은 둘 다 399,592 였다). ' +
        '"폴링이 놓친 이번 세션의 진짜 피크" 로 읽으면 안 된다. ' +
        '이번 세션 구간의 피크를 원하면 rss.max_kb 를 쓰라. ' +
        'null 은 트레이스에 mem.rss.watermark 카운터가 없었다는 뜻이다.',
    ),
  /** 기기 전체 메모리. linux.sys_stats 의 meminfo 가 없으면 null. */
  system: SystemMemorySchema.nullable(),
})
export type MemoryData = z.infer<typeof MemoryDataSchema>

export const LogEventSchema = z.object({
  tag: z.string(),
  message: z.string(),
})
export type LogEvent = z.infer<typeof LogEventSchema>

/**
 * 이 metric 의 모든 숫자는 **기기 전역**이다. 그 사실이 지금까지 소스 주석에만 있었는데,
 * `perftracker schema` 는 `z.toJSONSchema(ResultSchema)` 라 주석을 보지 못한다 —
 * 스키마만 읽는 CI 와 LLM 에게는 `crashes` 가 대상 앱의 크래시로 보였다.
 * 범위가 한정된 숫자의 한정 조건은 주석이 아니라 `.describe()` 에 있어야 한다.
 */
const LOG_SCOPE =
  '이 값은 **기기 전역**이며 대상 앱만의 값이 아니다 — android.log 데이터소스는 logd 전체를 ' +
  '받고 프로세스로 거르지 않는다. '
const LOG_EVENT_SCOPE =
  '원문을 그대로 실으므로 누구 것인지는 tag/message 로 직접 읽어야 한다. ' +
  `crashes 와 anrs 를 합쳐 최대 ${'200'}건까지만 담는다(ts 오름차순). ` +
  '상한에 닿으면 status 가 partial 이 되고 reason_code 가 log_events_truncated 로 그 사실을 ' +
  '말한다 — 그 뒤에 더 있었는지는 이 결과로 알 수 없다. 개수(total/by_priority)는 잘리지 않는다. '
/**
 * `[]` 와 `null` 은 다른 사실이다. 이 구분이 없던 동안, 이벤트 쿼리가 실패한 세션이
 * "크래시 0건" 을 사실처럼 실어 냈다 — 같은 collector 가 빈 로그 버퍼에 대해서는
 * `no_log_entries` 로 거부하던 바로 그 일이다.
 */
const LOG_EVENT_NULL =
  '**null 은 세지 못했다는 뜻이다** — 이벤트 쿼리가 실패한 경우이며 reason_code 가 ' +
  'query_failed 로 그 사실을 말한다. 빈 배열([])은 "쿼리는 성공했고 관측된 것이 없다" 이다. ' +
  '둘을 같은 뜻으로 읽으면 안 된다.'

export const LogDataSchema = z.object({
  min_prio: z
    .string()
    .describe(
      '이 세션이 android.log 데이터소스에 **요청한** 최소 우선순위(문턱). ' +
        'logd 가 이 문턱으로 걸러 보내므로 아래 개수는 사실상 이 문턱 이상의 줄들이지만, ' +
        '이 도구는 트레이스를 받은 뒤 우선순위로 다시 거르지 않는다 — 개수의 정의는 ' +
        '"트레이스에 있는 것을 센다" 이지 "문턱 이상만 센다" 가 아니다. ' +
        '그래도 문턱 없이는 개수를 읽을 수 없다: "W 118건" 은 무엇이 걸러진 뒤의 숫자인지 ' +
        '모르면 의미가 없다.',
    ),
  total: z
    .number()
    .int()
    .nonnegative()
    .describe(
      `트레이스에 담긴 로그 줄 **전부**의 수. ${LOG_SCOPE}` +
        '우선순위로 거르지 않고 트레이스에 있는 줄을 그대로 센다(min_prio 설명 참고). ' +
        '트레이스 버퍼가 넘쳤다면 그만큼 적다(measurement_overhead.trace_buffer_overrun 참고).',
    ),
  by_priority: z
    .object({
      warn: z.number().int().nonnegative(),
      error: z.number().int().nonnegative(),
      fatal: z.number().int().nonnegative(),
    })
    .describe(
      `W/E/F 세 우선순위의 로그 줄 수. ${LOG_SCOPE}` +
        '세 값의 합은 total 과 다를 수 있다 — total 은 이 셋 밖의 우선순위(문턱보다 낮은 줄이 ' +
        '섞여 온 경우)까지 세기 때문이다. 반대 방향의 누락은 없다.',
    ),
  crashes: z
    .array(LogEventSchema)
    .nullable()
    .describe(
      `세션 동안 관측된 크래시(AndroidRuntime 의 FATAL EXCEPTION, libc 의 Fatal signal). ${LOG_SCOPE}` +
        '크래시는 앱이 아니라 시스템이 찍으므로 앱 프로세스로 거르면 정작 그 줄이 사라진다. ' +
        LOG_EVENT_SCOPE +
        LOG_EVENT_NULL,
    ),
  anrs: z
    .array(LogEventSchema)
    .nullable()
    .describe(
      `세션 동안 관측된 ANR(ActivityManager 의 "ANR in ..."). ${LOG_SCOPE}` +
        'ANR 은 system_server 가 찍는다. ' +
        LOG_EVENT_SCOPE +
        LOG_EVENT_NULL,
    ),
})
export type LogData = z.infer<typeof LogDataSchema>

/**
 * 이 메트릭의 모든 숫자는 **기기 전역**이다. 그 사실이 `.describe()` 에 없으면
 * `perftracker schema` 만 읽는 CI 와 LLM 에게는 "이 앱이 기기를 얼마나 데웠는가" 로 보인다.
 * `z.toJSONSchema` 는 런타임이라 이 주석을 보지 못한다.
 */
const THERMAL_SCOPE =
  '**이 값은 기기 전역이며 대상 앱의 온도가 아니다** — 같은 시간에 돈 다른 앱, 화면 밝기, ' +
  'USB 충전(이 도구는 adb 로 붙으므로 거의 항상 충전 중이다)이 전부 섞인다. '

export const ThermalZoneReadingSchema = z.object({
  name: z
    .string()
    .describe(
      '센서 이름. **벤더가 정하는 임의 문자열이다** — 이 값으로 CPU/피부 온도를 판별하지 말 것. ' +
        '판별은 type 으로 한다.',
    ),
  type: z
    .number()
    .int()
    .nullable()
    .describe(
      '`android.hardware.thermal` 의 TemperatureType 표준 enum: 0=CPU, 1=GPU, 2=BATTERY, ' +
        '3=SKIN, 4=USB_PORT, 5=POWER_AMPLIFIER, 6=BCL_VOLTAGE, 7=BCL_CURRENT, ' +
        '8=BCL_PERCENTAGE, 9=NPU. 기기가 안 주면 null.',
    ),
  before_c: z
    .number()
    .nullable()
    .describe('세션 시작 스냅샷의 온도(°C). **null 은 그 센서가 시작 시점에 없었다는 뜻이다.**'),
  after_c: z
    .number()
    .nullable()
    .describe(
      '세션 종료 스냅샷의 온도(°C). **null 은 두 가지다** — 그 센서가 종료 시점에 없었거나, ' +
        '종료 스냅샷 자체가 없다(아직 stop 하지 않은 세션). 어느 쪽인지는 reason_code 가 말한다. ' +
        '0 과 혼동하면 안 된다: 이 기기들은 실제로 0.0°C 를 보고하는 센서를 갖고 있다.',
    ),
  delta_c: z
    .number()
    .nullable()
    .describe(
      'after_c − before_c. **부호 있는 값이고, 음수가 정상이다** — 실기기 4세션 중 2세션에서 ' +
        'AP 온도가 내려갔다(32.1→30.8, 32.1→31.9). 이 값을 "상승량" 이나 "발열" 로 읽으면 안 된다. ' +
        '어느 한쪽이 null 이면 null 이다. ' +
        '**source 가 `cached` 인 존에서는 이 값이 온도 변화가 아닐 수 있다** — 그 값은 갱신이 ' +
        '올 때만 바뀌고, 안 오면 몇 시간이고 같은 숫자가 남는다. source 설명을 반드시 함께 읽을 것.',
    ),
  status_before: z
    .number()
    .int()
    .nullable()
    .describe(
      '시작 시점 이 센서의 throttling 단계(`mStatus`, THERMAL_STATUS_*: 0=NONE … 6=SHUTDOWN).',
    ),
  status_after: z.number().int().nullable().describe('종료 시점 이 센서의 throttling 단계.'),
  source: z
    .enum(['hal', 'cached'])
    .describe(
      '이 값이 dumpsys 의 어느 절에서 왔는지. `hal` = `Current temperatures from HAL`(덤프 시점에 ' +
        'HAL 에 직접 물은 값, 우선한다), `cached` = `Cached temperatures`(프레임워크가 콜백으로 ' +
        '들고 있던 값). HAL 이 이번에 안 준 센서가 cached 에만 남아 있는 경우가 실기기에서 ' +
        '관측되므로 버리지 않고 싣되, 출처를 함께 싣는다.\n' +
        '**이 항목은 값 두 개(before_c / after_c)를 담으므로 출처도 둘일 수 있다. 어느 한쪽이라도 ' +
        '`cached` 면 이 필드는 `cached` 다** — 아래 경고가 두 값 중 하나에만 해당하더라도 ' +
        '그 존에는 적용되어야 하기 때문이다. 즉 `hal` 은 "두 값 모두 HAL 이 직접 준 값" 이라는 ' +
        '뜻이고, `cached` 는 "적어도 한쪽이 갱신되지 않았을 수 있다" 는 뜻이다. ' +
        '어느 쪽이 그랬는지는 이 결과가 말하지 않는다.\n' +
        '**`cached` 인 존의 delta_c 를 온도 변화로 읽으면 안 된다.** 이 값은 HAL 이 콜백을 ' +
        '보낼 때만 갱신되고, 갱신이 오지 않으면 같은 숫자가 그대로 남는다. ' +
        '실측 근거: 어느 실기기(Android 16)의 cached 전용 존 `PA1THM` 은 약 3시간에 걸친 ' +
        '4세션의 전/후 덤프 8개에서 소수점까지 계속 27.0°C 였고, 같은 기간 HAL 이 주는 `AP` 는 ' +
        '30.8~41.6°C 로 움직였다. 그래서 `cached` 존의 delta_c 0 은 "온도가 안 변했다" 가 아니라 ' +
        '"이 값이 갱신되지 않았다" 일 수 있고, **이 도구는 둘을 구분하지 못한다.**',
    ),
})
export type ThermalZoneReading = z.infer<typeof ThermalZoneReadingSchema>

export const ThermalDataSchema = z.object({
  zones: z
    .array(ThermalZoneReadingSchema)
    .describe(
      `세션 전/후 스냅샷에서 관측된 센서들. ${THERMAL_SCOPE}` +
        '존 하나당 정확히 한 항목이다(전에는 같은 존이 두 절에서 두 번 실렸다).\n' +
        '**순서는 "기기가 보고한 순서" 가 아니다.** 규칙은 이것이다: ' +
        '시작 스냅샷의 `Current temperatures from HAL` 절 순서를 먼저 싣고, 그 절에 없던 센서를 ' +
        '`Cached temperatures` 절 순서로 뒤에 붙이며, 시작 스냅샷에 없고 종료 스냅샷에만 있던 ' +
        '센서가 맨 뒤에 온다. ' +
        '실기기 원문은 `Cached temperatures:` 를 **먼저** 찍고 그 첫 항목이 `PA1THM` 인데, ' +
        '이 배열에서는 `PA1THM` 이 **마지막**이다 — 원문 순서로 읽으면 안 된다. ' +
        '다만 변화량 크기로 정렬하지는 **않는다**: 어느 센서가 중요한지는 이 도구가 말하지 않는다. ' +
        '순서에 의미를 두지 말고 `name` 과 `type` 으로 찾으라.\n' +
        '**전/후 두 점이므로 구간 중 최고 온도는 이 결과에 없다** — 원리적으로 알 수 없다. ' +
        '값이 정확히 0.0 인 존이 실기기에서 관측된다(SUBBAT / SUBBATRAW). ' +
        '"실제 0°C" 인지 "이 기기에 그 센서가 없다" 인지 이 도구는 판별하지 않는다.',
    ),
  device_status_before: z
    .number()
    .int()
    .nullable()
    .describe(
      '시작 시점 기기 전체의 throttling 단계 (`dumpsys thermalservice` 의 `Thermal Status:`). ' +
        'THERMAL_STATUS_*: 0=NONE, 1=LIGHT, 2=MODERATE, 3=SEVERE, 4=CRITICAL, 5=EMERGENCY, 6=SHUTDOWN.',
    ),
  device_status_after: z
    .number()
    .int()
    .nullable()
    .describe('종료 시점 기기 전체의 throttling 단계.'),
  status_override_before: z
    .boolean()
    .nullable()
    .describe(
      '시작 시점의 `IsStatusOverride`. true 면 기기의 throttling 단계가 실제 온도가 아니라 ' +
        '강제 설정된 값이라는 뜻이다 — 그때 device_status_* 는 관측이 아니다.',
    ),
  status_override_after: z.boolean().nullable().describe('종료 시점의 `IsStatusOverride`.'),
  hal_ready_before: z.boolean().nullable().describe('시작 시점의 `HAL Ready`.'),
  hal_ready_after: z.boolean().nullable().describe('종료 시점의 `HAL Ready`.'),
  headroom_thresholds: z
    .array(z.number().nullable())
    .nullable()
    .describe(
      '기기가 보고한 thermal headroom 임계 배열(`Temperature headroom thresholds:`). ' +
        '인덱스가 THERMAL_STATUS_* 0..6 이고, 원문의 `NaN` 은 **null** 로 실린다(JSON 에 NaN 이 없다). ' +
        '**이 도구는 headroom 을 산출하지 않는다** — headroom 은 앱 프로세스 안에서 ' +
        '`PowerManager.getThermalHeadroom()` 으로만 얻을 수 있고 이 도구는 앱에 코드를 넣지 않는다. ' +
        '그래서 이 배열은 위의 섭씨 온도와 **직접 비교할 수 없다**. 기기가 스스로 보고한 사실로만 싣는다. ' +
        'null 은 이 기기가 그 절을 안 찍었다는 뜻이다.',
    ),
})
export type ThermalData = z.infer<typeof ThermalDataSchema>

/**
 * 이 숫자가 **무엇의 합계인지** 가 `.describe()` 에 없으면, `rx_bytes` 는 "이 앱이 받은
 * 바이트" 로 읽힌다. 실제로는 그보다 넓고(같은 uid 의 다른 패키지, loopback), 동시에
 * 좁다(방화벽이 버린 송신은 안 센다). `z.toJSONSchema` 는 주석을 보지 못하므로
 * 그 한정이 반드시 여기 있어야 한다.
 */
const NETWORK_SCOPE =
  '**uid 단위 값이며 패키지 단위가 아니다** — 같은 uid 를 공유하는 다른 패키지(sharedUserId)의 ' +
  '트래픽이 섞이고, 분리할 방법이 없다(맵의 키가 uid 뿐이다). 어느 패키지들이 이 uid 를 ' +
  '쓰는지는 shared_uid_packages 에 있다. ' +
  '**IP 계층의 바이트다** — L2/이더넷 헤더는 빠지고 IP+TCP/UDP 헤더는 들어간다. ' +
  '**loopback 을 포함한 모든 인터페이스의 합계이며 wifi / mobile 로 나뉘지 않는다** ' +
  '(`mAppUidStatsMap` 에 인터페이스 차원이 없다). loopback 통신은 송신과 수신 양쪽에서 ' +
  '두 번 세어진다. 1500바이트를 넘는 큰 패킷(GSO)은 커널이 휴리스틱으로 되계산하므로 ' +
  '고throughput 구간의 값은 정확한 wire 바이트가 아니라 근사치다. ' +
  '방화벽/데이터세이버가 버린 **송신** 패킷은 세지 않고, 버려진 **수신** 패킷은 센다. ' +
  'VPN(TUN) 이 켜져 있으면 같은 트래픽이 앱 uid 와 VPN 앱 uid 양쪽에서 세어진다. '

const NETWORK_INTERVAL =
  '**델타 구간은 세션 구간보다 조금 넓다.** 시작 스냅샷은 `am force-stop` 과 트레이스 시작과 ' +
  '`am start -W` 보다 **앞**에서 찍히므로 앱의 콜드 스타트 준비 구간이 포함되고, 종료 ' +
  '스냅샷은 트레이스를 회수한 **뒤**에 찍히므로 회수에 걸린 시간이 포함된다(트레이스가 클수록 ' +
  '길어진다). ' +
  // 이 문단은 한때 "정확한 두 시점은 state_*.captured_at 이다" 라고 끝났는데 **거짓이었고
  // 바로 앞 문장과 모순이었다.** state_after.captured_at 은 stop 진입 시각이라 트레이스
  // 회수보다 **앞**이고, netstats 종료 스냅샷은 회수가 끝난 **뒤**에 나간다. 그 문장을 믿고
  // 처리량을 계산하면 분자는 회수 구간을 포함하고 분모는 제외한다.
  '**device.state_*.captured_at 은 이 구간의 근사일 뿐 스냅샷을 찍은 시각이 아니다.** ' +
  '두 값은 각각 start / stop 이 시작할 때 찍은 시계다. 특히 state_after.captured_at 은 ' +
  '**트레이스 회수 전**의 시각이라 종료 스냅샷보다 앞선다(실측: 트레이스 0.3~2.1MB 인 ' +
  '4세션에서 0.5~0.7초, 트레이스가 클수록 커진다). ' +
  '그래서 이 바이트를 그 두 시각의 차로 나눠 **처리량(bytes/s)을 계산하면 안 된다** — ' +
  '분자는 회수 구간을 포함하는데 분모는 제외한다. 스냅샷 시각이 필요하면 ' +
  'artifacts.raw 의 raw/netstats_{before,after}.txt 파일 mtime 이 그것에 더 가깝다. '

export const NetworkDataSchema = z.object({
  uid: z.number().int().describe('이 값이 집계된 리눅스 uid. target_app.uid 와 같다.'),
  rx_bytes: z
    .number()
    .int()
    .nonnegative()
    .describe(
      `세션 전/후 스냅샷 사이에 이 uid 가 **받은** 바이트. ${NETWORK_SCOPE}${NETWORK_INTERVAL}` +
        '**0 은 "관측된 바이트가 없었다" 는 뜻이지 "조회하지 못했다" 가 아니다** — ' +
        '조회하지 못한 경우 이 메트릭은 data 가 통째로 null 이고 reason_code 가 그 이유를 말한다.',
    ),
  tx_bytes: z
    .number()
    .int()
    .nonnegative()
    .describe(`같은 구간에 이 uid 가 **보낸** 바이트. ${NETWORK_SCOPE}`),
  // 패킷 필드만 읽는 소비자도 uid 단위라는 한정에 도달해야 한다. 바이트 필드에만 SCOPE 를
  // 싣고 여기 안 실으면, `rx_packets` 만 보는 쪽은 이 숫자가 패키지 단위인 줄 안다.
  rx_packets: z
    .number()
    .int()
    .nonnegative()
    .describe(
      `같은 구간의 수신 패킷 수. GSO 구간에서는 커널이 되계산한 **추정** 개수다. ${NETWORK_SCOPE}`,
    ),
  tx_packets: z
    .number()
    .int()
    .nonnegative()
    .describe(`같은 구간의 송신 패킷 수. 추정이라는 점까지 위와 같다. ${NETWORK_SCOPE}`),
  shared_uid_packages: z
    .array(z.string())
    .nullable()
    .describe(
      '`pm list packages -U` 스냅샷에서 **이 uid 를 쓰는 것으로 관측된 패키지 전부**(시스템 포함). ' +
        '**이 배열의 길이가 위 숫자들의 귀속 범위다.** ' +
        '1개 → 위 숫자는 그 패키지만의 것이다 (그때만 이 메트릭의 status 가 collected 다). ' +
        '2개 이상 → 그 패키지들의 **합계**이고 대상 앱 몫만 떼어 낼 수 없다 ' +
        '(mAppUidStatsMap 의 키가 uid 뿐이다). 그때 status 는 partial 이고 ' +
        'reason_code 는 uid_shared_by_multiple_packages 다. ' +
        '실측 근거: 실기기(sdk 36)에서 uid 1000 을 **86개** 패키지가 공유했다. ' +
        '**null 과 [] 는 다른 사실이다.** ' +
        'null = **열거하지 못했다** — 스냅샷이 없거나, 이 uid 가 속한 안드로이드 user 를 ' +
        '그 목록이 한 줄도 열거하지 않았다. 후자는 삼성 시큐어 폴더(실측 user 150) 같은 경우로, ' +
        '`pm list packages -U` 가 그 user 에 대해 SecurityException 을 stderr 로 내고 ' +
        '**종료 코드 0** 으로 끝나 목록이 조용히 불완전해진다. ' +
        '그런 uid 의 패키지명을 이 도구는 **알 수 없다**. ' +
        '[] = **열거했는데 이 uid 를 쓰는 패키지가 목록에 없었다** (대상 패키지 자신도 없다). ' +
        '어느 쪽이든 status 는 partial 이고 reason_code 가 어느 갈래인지 말한다 ' +
        '(uid_packages_not_enumerable / uid_not_in_package_list). ' +
        '**단, reason_code 자리는 하나뿐이라 netstats_uid_duplicated 가 겹치면 그쪽이 먼저 실린다** — ' +
        '귀속 범위를 판단할 때는 reason_code 가 아니라 **이 배열**을 보라. ' +
        '부계정(secondary user)의 같은 앱은 다른 uid(user*100000 + appId)를 받으며 여기 포함되지 않는다.',
    ),
})
export type NetworkData = z.infer<typeof NetworkDataSchema>

export const CpuClusterSchema = z.object({
  cpus: z.array(z.number().int()),
  max_freq_khz: z.number().int().nullable(),
})
export type CpuCluster = z.infer<typeof CpuClusterSchema>

/** 주사율은 단일 값이 아니다 — 가변 주사율 패널은 세션 중에도 모드가 바뀐다. */
export const DisplayInfoSchema = z.object({
  width_px: z.number().int(),
  height_px: z.number().int(),
  density_dpi: z.number().int(),
  active_refresh_rate_hz: z.number().nullable(),
  supported_refresh_rates_hz: z.array(z.number()),
})
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>

export const DeviceStaticSchema = z.object({
  manufacturer: z.string(),
  model: z.string(),
  android_release: z.string(),
  sdk_int: z.number().int(),
  build_fingerprint: z.string(),
  abis: z.array(z.string()),
  soc_model: z.string().nullable(),
  soc_manufacturer: z.string().nullable(),
  cpu: z.object({
    core_count: z.number().int(),
    clusters: z.array(CpuClusterSchema),
  }),
  memory_total_kb: z.number().int(),
  display: DisplayInfoSchema,
})
export type DeviceStatic = z.infer<typeof DeviceStaticSchema>

export const DeviceStateSchema = z.object({
  captured_at: z.string(),
  battery_level: z.number().int().nullable(),
  battery_temp_c: z.number().nullable(),
  charging: z.boolean().nullable(),
  connection: z.enum(['usb', 'tcp', 'unknown']),
  screen_brightness: z.number().int().nullable(),
  power_save_mode: z.boolean().nullable(),
  network: z.string().nullable(),
  mem_available_kb: z.number().int().nullable(),
  animator_duration_scale: z.number().nullable(),
  thermal_zones: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            '센서 이름. **벤더가 정하는 임의 문자열이다**(`AP` / `SKIN` / ' +
              '`test temperature sensor`). 이 값으로 CPU 온도인지 피부 온도인지 판별하지 말 것 — ' +
              '그 판별은 type 으로 한다. 유일성도 보장되지 않는다: 한 실기기에 `PATHM` 과 ' +
              '`PA1THM` 이 **둘 다** 있고 한 글자 차이의 서로 다른 센서다. ' +
              '이 도구가 존을 동일시하는 키는 이름이 아니라 (type, name) 쌍이다.',
          ),
        celsius: z.number(),
        type: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            '`android.hardware.thermal` 의 TemperatureType 표준 enum: ' +
              '0=CPU, 1=GPU, 2=BATTERY, 3=SKIN, 4=USB_PORT, 5=POWER_AMPLIFIER, ' +
              '6=BCL_VOLTAGE, 7=BCL_CURRENT, 8=BCL_PERCENTAGE, 9=NPU. ' +
              '기기가 안 주면 null. **이 필드가 아예 없는 문서는 M3 이전에 산출된 것이다.**',
          ),
        status: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            '이 센서 기준의 throttling 단계(`mStatus`, THERMAL_STATUS_*: 0=NONE … 6=SHUTDOWN). ' +
              '기기 전체의 단계가 아니라 이 센서의 것이다. ' +
              '**이 필드가 아예 없는 문서는 M3 이전에 산출된 것이다.**',
          ),
        source: z
          .enum(['hal', 'cached'])
          .optional()
          .describe(
            '이 값이 온 절. `hal` = `Current temperatures from HAL`, ' +
              '`cached` = `Cached temperatures`(프레임워크가 콜백으로 들고 있던 값). ' +
              '**`cached` 는 갱신이 올 때만 바뀌므로 오래된 값일 수 있다** — 실기기에서 ' +
              'cached 전용 존 하나가 약 3시간 동안 같은 값이었다. ' +
              '자세한 것은 metrics.thermal 의 zones[].source 설명에 있다. ' +
              '**이 필드가 아예 없는 문서는 M3 이전에 산출된 것이다.**',
          ),
      }),
    )
    .describe(
      '`dumpsys thermalservice` 가 이 시점에 보고한 센서별 온도. ' +
        '**기기 전역이며 대상 앱의 온도가 아니다** — 다른 앱, 화면 밝기, USB 충전이 전부 섞인다. ' +
        '`Current temperatures from HAL` 을 우선하고 거기 없는 센서는 `Cached temperatures` 에서 ' +
        '가져온다.\n' +
        '**존 하나당 한 항목이라는 보장은 `type`/`source` 필드를 가진 문서에만 적용된다.** ' +
        'M3 이전의 파서는 두 절을 구분 없이 긁어 같은 존을 두 번 실었다(실기기 8존이 15항목). ' +
        '이 결과는 `raw/thermalservice_{before,after}.txt` 원문이 run 디렉토리에 남아 있으면 ' +
        'extract 가 그 원문에서 이 배열을 **다시 만들어** 중복을 없앤다 — 같은 방식의 선례가 ' +
        '`target_app.render_process` 다(capture 때 몰랐던 것을 extract 가 더 나은 근거로 채운다). ' +
        '원문이 없으면 capture.json 에 기록된 값을 그대로 옮기며, 그 값에는 중복이 남아 있을 수 ' +
        '있다. 그래서 **`type`/`source` 가 없는 항목이 보이면 중복을 의심해야 한다.** ' +
        '`capture.json` 쪽 값은 그대로 두므로 두 파일의 이 필드가 다를 수 있다.\n' +
        '값이 정확히 `0.0` 인 존이 실기기에서 관측된다(SUBBAT / SUBBATRAW). ' +
        '이 도구는 그것이 "실제 0°C" 인지 "이 기기에 그 센서가 없다" 인지 **판별하지 않는다** — ' +
        '기기가 보고한 값을 그대로 싣는다. ' +
        '세션 구간의 변화량은 metrics.thermal 에 있다.',
    ),
})
export type DeviceState = z.infer<typeof DeviceStateSchema>

export const TargetAppSchema = z.object({
  package: z.string(),
  label: z.string(),
  label_source: z.enum(['apk_resources', 'aapt2', 'package_name']),
  version_name: z.string().nullable(),
  version_code: z.number().int().nullable(),
  uid: z
    .number()
    .int()
    .nullable()
    .describe(
      '이 패키지에 배정된 리눅스 uid (`pm list packages -U` 가 보고한 값). ' +
        '**패키지와 1:1 이 아니다** — `sharedUserId` 를 쓰는 패키지들은 같은 uid 를 공유하고, ' +
        '안드로이드 플랫폼 패키지 수십 개가 uid 1000 을 함께 쓴다(실기기 실측 86개). ' +
        'uid 단위로만 집계되는 값(metrics.network)이 무엇의 합인지는 ' +
        '`metrics.network.data.shared_uid_packages` 가 말한다. ' +
        '**null 은 이 도구가 uid 를 확인하지 못했다는 뜻이다** — 셸 권한이 닿지 않는 ' +
        '안드로이드 user(시큐어 폴더 등)의 앱이 그렇다. 0 이나 -1 로 채우지 않는다.',
    ),
  install_source: z.string().nullable(),
  launcher_activity: z.string().nullable(),
  render_process: z.string().nullable(),
  pid: z.number().int().nullable(),
})
export type TargetApp = z.infer<typeof TargetAppSchema>

export const SessionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  // 'running' 은 아직 stop 하지 않은 run 디렉토리에 extract 를 돌린 경우다.
  // 그런 결과를 'completed' 로 둔갑시키지 않고 있는 그대로 남긴다.
  state: z.enum(['running', 'completed', 'aborted', 'failed']),
  started_at: z.string(),
  // 이 둘이 nullable 인 이유는 state 와 같은 자리에서 나온다. `stop` 이 종료 시각을 쓰기
  // 전까지 이 run 에는 종료 시각이 **없다.** 옛 동작은 그 자리에 started_at 을 넣어
  // "0ms 짜리 세션" 이라는 없던 사실을 만들었다 — 아직 오지 않은 시각을 지어낸 것이다.
  ended_at: z
    .string()
    .nullable()
    .describe(
      '세션이 끝난 시각(= stop 이 원본 회수를 시작한 시각). ' +
        '**null 은 아직 끝나지 않았다는 뜻이다** — state 가 running 인 결과가 그렇다. ' +
        '이 자리에 started_at 이 오는 일은 없다.',
    ),
  duration_ms: z
    .number()
    .int()
    .nullable()
    .describe(
      'ended_at − started_at (ms). **null 은 세션이 아직 끝나지 않아 길이를 잴 수 없다는 ' +
        '뜻이다**(state 가 running). 0 과 혼동하면 안 된다 — 0 은 "길이가 0 인 세션" 이다. ' +
        '진행 중인 세션의 경과 시간이 필요하면 started_at 과 지금 시각으로 직접 구하라. ' +
        '이 도구는 그것을 세션의 길이라고 부르지 않는다.',
    ),
  options: z.object({ launch: z.boolean(), video: z.boolean() }),
})
export type SessionInfo = z.infer<typeof SessionInfoSchema>

/** "부하를 안 준다"를 말로 하지 않고 숫자로 남기는 자리. */
export const MeasurementOverheadSchema = z.object({
  tracing_processes_cpu_time_ms: z
    .number()
    .nullable()
    .describe(
      'traced / traced_probes 가 세션 구간에서 쓴 user+kernel CPU 시간의 합(ms). ' +
        'linux.process_stats 의 runtime.user_ns / runtime.kernel_ns 차이에서 나온다. ' +
        '커널이 clock tick 단위로만 보고하므로 해상도는 10ms 다 — 짧은 세션에서 0 이 나오는 것은 ' +
        '"측정 못 함"이 아니라 "10ms 미만"이라는 뜻이다. ' +
        'perfetto CLI 프로세스도 세는 대상에 들어 있지만, 실측한 트레이스에서는 --detach 직후 ' +
        '종료해 process_stats 스캔에 잡히지 않았다 — 보장이 아니라 관측이며, 잡히면 합계에 들어간다. ' +
        '**이 값은 트레이싱의 총비용이 아니라 체계적인 하한이다.** 필드명대로 트레이싱 ' +
        '"프로세스들" 이 쓴 시간만 담는다 — 커널이 ftrace 이벤트를 링버퍼에 기록하는 비용은 ' +
        '인터럽트당한 프로세스(= 대상 앱일 수 있다)에 청구되므로 여기 들어오지 않는다. ' +
        '켜는 ftrace 이벤트를 줄이면 그 몫도 줄지만 0 이 되지는 않는다. ' +
        'null 은 트레이스에 해당 카운터가 없었다는 뜻이다(record_process_runtime 이 꺼진 옛 캡처).',
    ),
  tracing_processes_cpu_share_pct: z
    .number()
    .nullable()
    .describe(
      '위 CPU 시간을 같은 구간의 기기 전체 CPU 시간(모든 코어 합)으로 나눈 백분율. ' +
        'linux.sys_stats 의 cpu.times.* 가 없으면 분모를 알 수 없어 null 이다.',
    ),
  tracing_processes_peak_rss_kb: z
    .number()
    .nullable()
    .describe(
      '트레이싱 프로세스들의 mem.rss 최댓값을 **프로세스별로 구해 더한 값**(kB). ' +
        'process_stats 표본의 타임스탬프가 프로세스마다 정확히 같지 않아 "동시 최대"를 ' +
        '정확히 낼 수 없으므로, 이 값은 진짜 동시 최대의 상계다. 과소평가하지 않는 쪽을 골랐다. ' +
        '다만 각 프로세스의 최댓값 자체는 **1초 주기 표본의 최댓값**이다(proc_stats_poll_ms: 1000) — ' +
        '표본과 표본 사이에 스쳐 간 순간 최고점은 이 값에 나타나지 않으므로, ' +
        '이 상계가 모든 순간을 덮는다는 뜻은 아니다.',
    ),
  // 이 주의사항은 반드시 스키마에 실려야 한다. `perftracker schema` 는 CI 와 LLM 을 위한
  // 계약으로 팔리는데, 이 필드를 가장 잘못 읽기 쉬운 소비자가 바로 그들이다.
  adb_commands_during_session: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      '**측정 창이 열린 동안** perftracker 를 통해 시도되어 차단된 adb 호출 수. ' +
        '0 이 아니면 그 세션 데이터는 오염된 것이다. ' +
        '이름과 달리 "세션 전체" 가 아니라 창이 열린 구간만 세며, 세는 대상도 둘로 갈린다:\n' +
        '(1) perftracker 자신: `--launch` 세션에서는 트레이스가 시작된 **뒤** 측정 창이 ' +
        '열리기 **전에** perftracker 가 `am start -W` 와 `pidof` 를 기기로 보낸다(한 번의 ' +
        'adb 호출로 합쳐 보낸다). 그 호출은 창 밖이므로 **이 카운터에 잡히지 않는다** — ' +
        '앱을 콜드로 띄우는 것이 그 세션의 목적이므로 의도된 동작이지만, 트레이스 안에 ' +
        '그 두 명령의 흔적이 남는다는 사실은 여기 적혀 있어야 한다. ' +
        '창이 열린 뒤로는 perftracker 가 기기에 아무것도 보내지 않는다.\n' +
        '(2) 다른 프로세스: 0 은 perftracker 가 아무것도 보내지 않았다는 뜻이지 ' +
        '아무도 기기를 건드리지 않았다는 뜻이 아니다. 다른 터미널에서 직접 실행한 adb 는 ' +
        '이 도구를 거치지 않으므로 잡히지 않으며, 도구가 그것을 관측하려면 세션 중에 기기에 ' +
        '물어야 하고 그 행위 자체가 이 도구가 금지하는 것이다.\n' +
        '(3) **아직 stop 하지 않은 세션**(session.state 가 running): 이 카운터의 정본은 stop 이 ' +
        '남기는 값인데 그것이 아직 없다. 그래서 이 값은 활성 세션 포인터에 그때까지 쌓인 ' +
        '누적치이며, **읽은 시점까지의 사실이지 최종값이 아니다 — 세션이 계속 도는 동안 더 늘 수 ' +
        '있다.** stop 한 뒤 다시 extract 하면 최종값이 나온다. 포인터마저 없으면(--force 로 버려진 ' +
        '세션, 포인터를 만든 홈이 아닌 곳에서 연 run 디렉토리 등) 셀 방법이 없어 **null** 이다 — ' +
        '기기에 물어보는 길은 없다. **null 은 0 이 아니다**: 0 은 "세어 봤더니 없었다", ' +
        'null 은 "셀 수 없었다" 이다. null 을 0 으로 접어 읽으면 오염됐을지 모르는 세션이 ' +
        '청정으로 둔갑한다. state 가 running 인 결과에는 같은 사실을 말하는 ' +
        'session_still_running 경고도 함께 실린다.',
    ),
  // 이 필드에도 같은 함정이 있었다: 확인하지 못한 것을 `false` 로 냈다.
  trace_buffer_overrun: z
    .boolean()
    .nullable()
    .describe(
      '트레이스 버퍼가 넘쳐 데이터가 잘렸는지. trace_processor 의 stats 에서 ' +
        'traced_buf* 의 error/data_loss 항목을 세어 판단한다. ' +
        'true 면 이 결과의 모든 숫자가 그만큼 적다 — 특히 metrics.log 의 개수가 그렇다.\n' +
        '**null 은 확인하지 못했다는 뜻이다** — false 가 아니다. 두 경로가 있다: ' +
        '(1) 트레이스 원본이 이 run 에 없다(아직 stop 하지 않은 세션, 또는 트레이스를 잃은 ' +
        'aborted 세션 — artifacts.trace 가 null 이다), (2) stats 쿼리 자체가 실패했다. ' +
        'null 을 false 로 접어 읽으면 확인한 적 없는 세션이 "버퍼 정상" 으로 둔갑한다.',
    ),
})
export type MeasurementOverhead = z.infer<typeof MeasurementOverheadSchema>

/** 판정이 아니라 "누가 이렇게 말했다"는 사실 기록. 값 옆이 아니라 별도 배열에 격리한다. */
export const ReferenceSchema = z.object({
  metric: z.string(),
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  source: z.string(),
  url: z.string(),
})
export type Reference = z.infer<typeof ReferenceSchema>

/** 평가가 아니라 관측된 사건만 담는다. */
export const WarningSchema = z.object({ code: z.string(), message: z.string() })
export type Warning = z.infer<typeof WarningSchema>

export const ArtifactsSchema = z.object({
  trace: z.string().nullable(),
  video: z.string().nullable(),
  raw: z.array(z.string()),
})
export type Artifacts = z.infer<typeof ArtifactsSchema>

export const ResultSchema = z.object({
  schema_version: z.string(),
  tool: z.object({ name: z.string(), version: z.string() }),
  session: SessionInfoSchema,
  device: z.object({
    serial: z.string(),
    static: DeviceStaticSchema,
    state_before: DeviceStateSchema,
    state_after: DeviceStateSchema.nullable(),
  }),
  target_app: TargetAppSchema,
  /**
   * 알려진 collector 는 자기 데이터 스키마로 검증하고, 그 밖의 키는 MetricResult 모양만 본다.
   *
   * 새 메트릭은 **optional** 이다 (schema_version 1.1.0). 1.0.0 시절에 나온 result.json —
   * frame 하나만 있는 문서 — 이 그대로 통과해야 minor 라고 말할 수 있다.
   * 생산자는 항상 레지스트리의 모든 항목을 내보내므로, optional 이라고 해서 이 버전이
   * 실제로 키를 빠뜨리는 일은 없다.
   */
  metrics: z
    .object({
      frame: metricResultSchema(FrameDataSchema),
      startup: metricResultSchema(StartupDataSchema).optional(),
      cpu: metricResultSchema(CpuDataSchema).optional(),
      memory: metricResultSchema(MemoryDataSchema).optional(),
      log: metricResultSchema(LogDataSchema).optional(),
      thermal: metricResultSchema(ThermalDataSchema).optional(),
      network: metricResultSchema(NetworkDataSchema).optional(),
    })
    .catchall(metricResultSchema(z.unknown())),
  measurement_overhead: MeasurementOverheadSchema,
  references: z.array(ReferenceSchema),
  warnings: z.array(WarningSchema),
  artifacts: ArtifactsSchema,
})
export type Result = z.infer<typeof ResultSchema>
