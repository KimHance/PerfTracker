import { z } from 'zod'
import { METRIC_REASON_CODES, type MetricReasonCode } from './reasons.js'

// 1.1.0 — metrics 에 startup / cpu / memory / log 를 optional 로 추가 (필드 추가는 minor).
// 1.0.0 문서는 여전히 이 스키마를 통과한다. required 로 올리면 그것이 깨지고, 그건 major 다.
export const SCHEMA_VERSION = '1.1.0'

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
      'data 가 null 인 partial 은 render_process_not_found, no_frames, no_cpu_samples, ' +
      'insufficient_samples, process_not_in_trace, no_rss_samples, no_log_entries, ' +
      'launch_time_unreported, launch_wait_timed_out 등에서 나온다.\n' +
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
  thermal_zones: z.array(z.object({ name: z.string(), celsius: z.number() })),
})
export type DeviceState = z.infer<typeof DeviceStateSchema>

export const TargetAppSchema = z.object({
  package: z.string(),
  label: z.string(),
  label_source: z.enum(['apk_resources', 'aapt2', 'package_name']),
  version_name: z.string().nullable(),
  version_code: z.number().int().nullable(),
  uid: z.number().int().nullable(),
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
  ended_at: z.string(),
  duration_ms: z.number().int(),
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
        '물어야 하고 그 행위 자체가 이 도구가 금지하는 것이다.',
    ),
  trace_buffer_overrun: z.boolean(),
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
    })
    .catchall(metricResultSchema(z.unknown())),
  measurement_overhead: MeasurementOverheadSchema,
  references: z.array(ReferenceSchema),
  warnings: z.array(WarningSchema),
  artifacts: ArtifactsSchema,
})
export type Result = z.infer<typeof ResultSchema>
