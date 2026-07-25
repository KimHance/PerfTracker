import { z } from 'zod'
import { METRIC_REASON_CODES, type MetricReasonCode } from './reasons.js'

export const SCHEMA_VERSION = '1.0.0'

/** 수집 실패와 미지원을 null 로 뭉뚱그리지 않기 위한 상태 구분. */
export const MetricStatusSchema = z.enum(['collected', 'partial', 'unsupported', 'failed', 'skipped'])
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

export const FrameDataSchema = z.object({
  process: z.string(),
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
  tracing_processes_cpu_time_ms: z.number().nullable(),
  tracing_processes_cpu_share_pct: z.number().nullable(),
  tracing_processes_peak_rss_kb: z.number().nullable(),
  // 이 주의사항은 반드시 스키마에 실려야 한다. `perftracker schema` 는 CI 와 LLM 을 위한
  // 계약으로 팔리는데, 이 필드를 가장 잘못 읽기 쉬운 소비자가 바로 그들이다.
  adb_commands_during_session: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '측정 창이 열린 동안 perftracker 를 통해 시도되어 차단된 adb 호출 수. ' +
        '0 이 아니면 그 세션 데이터는 오염된 것이다. ' +
        '역은 성립하지 않는다: 0 은 perftracker 가 아무것도 보내지 않았다는 뜻이지 ' +
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
   * 닫힌 object 로 두면 M2 가 collector 를 "등록" 하는 게 아니라 이 선언을 다시 써야 한다
   * (그리고 zod 가 등록되지 않은 메트릭을 조용히 벗겨낸다).
   */
  metrics: z.object({ frame: metricResultSchema(FrameDataSchema) }).catchall(
    metricResultSchema(z.unknown()),
  ),
  measurement_overhead: MeasurementOverheadSchema,
  references: z.array(ReferenceSchema),
  warnings: z.array(WarningSchema),
  artifacts: ArtifactsSchema,
})
export type Result = z.infer<typeof ResultSchema>
