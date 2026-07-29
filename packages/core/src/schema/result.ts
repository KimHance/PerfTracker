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
 * **양쪽에 걸친 코드가 셋 있다.** 같은 코드가 어떤 메트릭에서는 `data: null` 을, 다른
 * 메트릭에서는 `data` 가 있는 `partial` 을 낸다:
 *   - `snapshot_unavailable` — network 는 시작 스냅샷이 없으면 값을 통째로 못 내지만
 *     (누적 카운터는 한쪽만으로 뜻이 없다), thermal 은 **종료** 스냅샷만 없을 때 시작
 *     스냅샷의 값을 낸 채 같은 코드를 붙인다. `stop` 전 세션을 extract 하면 반드시 지난다.
 *   - `process_not_in_trace` — memory 는 값을 통째로 못 내지만, cpu / log 는 기기 전역
 *     값을 낸 채 `app: null` 로 둔다.
 *   - `counter_went_backwards` — network 는 값을 통째로 못 내지만, cpu 는 기기 전역 값을
 *     낸 채 `app: null` 로 둔다.
 * 그래서 이 코드들만 보고 `data` 유무를 추론하면 틀린다. 목록을 계약으로 만들지 않은 이유가
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
      '**위 목록의 코드 셋은 양쪽에 걸친다** — 같은 코드가 메트릭에 따라 data 를 내기도 하고 ' +
      '안 내기도 한다: `snapshot_unavailable`(network 는 data null / thermal 은 non-null), ' +
      '`process_not_in_trace`(memory 는 null / cpu·log 는 기기 전역 값을 낸 채 app 만 null), ' +
      '`counter_went_backwards`(network 는 null / cpu 는 app 만 null). ' +
      '**이 코드들로 data 유무를 추론하지 말 것.** 목록을 계약으로 만들지 않은 이유가 이런 ' +
      '것이며, 이 코드들이 그 산 증거다.\n' +
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

/**
 * 여기에 `within_16_67ms_ratio` 라는 필드가 있었다. 16.67ms(구글의 60fps 예산)를 **이 도구가
 * 직접 비교해서** 낸 비율이었고, 두 가지가 잘못돼 있었다.
 *
 * 1. `references` 는 스스로 "여기 있는 값들은 **비교에 쓰이지 않고 그대로 기록만** 된다" 고
 *    적어 놓고, collector 가 그중 하나를 가져다 실제로 비교했다. 도구가 판정하지 않는다는
 *    규칙을 도구 자신이 어긴 자리다.
 * 2. 그 숫자가 **틀린 방향으로** 읽혔다. 검증 기기(Galaxy S22)는 120Hz 이고 그 기기의 프레임
 *    예산은 8.33ms 다. 도구는 `device.static.display.active_refresh_rate_hz` 로 그것을 **이미
 *    알면서도** 60fps 기준으로 비율을 냈다. 그 기기에서 `0.95` 는 "95% 가 예산 안" 이 아니라
 *    "실제 예산의 두 배 되는 선 아래가 95%" 였다.
 *
 * 기준선은 기기의 주사율·안드로이드 버전·앱의 목표에 따라 달라진다. 그것을 고르는 일은 이
 * 데이터를 소비하는 쪽(CI·리포트·사람)의 몫이고, 재료는 이미 결과에 다 실려 있다.
 */
const BUCKETS_DESCRIPTION =
  '프레임 소요 시간의 분포. **이 도구는 어떤 기준선과도 비교하지 않는다** — 60fps(16.67ms) 든 ' +
  '120Hz(8.33ms) 든, 임계값을 고르고 비율을 내는 일은 이 데이터를 읽는 쪽이 한다. ' +
  '그 판단에 필요한 기기 정보는 device.static.display 의 active_refresh_rate_hz 와 ' +
  'supported_refresh_rates_hz 에 있고, 구글이 공개한 참고치는 references 배열에 출처와 함께 ' +
  '있다 (기록만 되고 비교에 쓰이지 않는다). ' +
  '경계는 [from_ms, to_ms) 반개구간이고 마지막 버킷은 to_ms 가 null (= 상한 없음) 이다. ' +
  '버킷 폭이 구간마다 다르므로 임계값이 버킷 경계와 어긋나면 그 비율은 버킷 폭만큼 근사가 된다.'

/**
 * 시계열의 시간 축. **세션 시작(트레이스의 첫 표본)으로부터 몇 초째인가**를 정수로 센다.
 *
 * 벽시계 시각이 아니라 상대 초인 이유: 트레이스의 시각은 부팅 후 나노초(BOOTTIME)라
 * 그대로 실으면 소비자가 기준점을 따로 알아야 하고, 벽시계로 환산하면 두 시계를 짝지은
 * 스냅샷이 필요해 이 값이 그 스냅샷의 존재 여부에 묶인다. 상대 초는 둘 다 필요 없다.
 *
 * 구간은 `[t_s, t_s+1)` 이다. **값이 없는 초는 배열에 없다** — 0 으로 채우지 않는다.
 * "그 초에 프레임이 0 장이었다" 와 "그 초를 관측하지 못했다" 는 다른 사실이고,
 * 빈 자리를 0 으로 메우면 둘이 같은 모양이 된다.
 */
const TIMELINE_T_DESCRIPTION =
  '세션 시작으로부터 몇 초째인지 (구간은 [t_s, t_s+1)). 값이 없는 초는 배열에 없다 — ' +
  '0 으로 채우지 않는다. 빠진 초를 "0" 으로 읽지 말 것.'

export const FrameTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  /** 그 1초 동안 완결된 프레임 수. 화면이 얼마나 자주 갱신됐는지에 대응한다. */
  count: z.number().int().nonnegative(),
  /** 그 1초 안에서의 중앙값·최댓값. 세션 전체 percentiles 와 같은 단위(ms)다. */
  p50_ms: z.number(),
  max_ms: z.number(),
})
export type FrameTimelinePoint = z.infer<typeof FrameTimelinePointSchema>

const FRAME_TIMELINE_DESCRIPTION =
  '1초 단위로 묶은 프레임 추이. 세션 전체 집계(buckets · percentiles)와 **같은 원본**에서 ' +
  '나오며 같은 규칙으로 미완결 프레임(dur < 0)을 제외한다. 집계만으로는 구분되지 않는 것 ' +
  '(내내 고르게 느렸는지, 특정 구간에서만 튀었는지)을 보려는 값이다. ' +
  '이 배열이 있다고 기기에 더 많은 것을 물은 것은 아니다 — 트레이스에 이미 있던 값을 ' +
  '접지 않고 그대로 낸 것뿐이라 측정 부하는 같다.'

export const FrameJankSchema = z.object({
  /**
   * 꼬리표를 셀 수 있었던 프레임 수. `total_frames` 와 같아야 정상이고, 다르면 트레이스가
   * 두 질의 사이에 다른 답을 준 것이다 — 그 사실을 감추지 않으려고 따로 싣는다.
   */
  total_frames: z.number().int().nonnegative(),
  janky_frames: z
    .number()
    .int()
    .nonnegative()
    .describe('`jank_type` 이 `None` 이 아닌 프레임 수. **어느 꼬리표든 하나라도 붙은 것**을 센다.'),
  late_frames: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '`on_time_finish = 0` 인 프레임 수 — 마감 안에 끝내지 못한 것. `janky_frames` 와 ' +
        '**다른 사실이다**: 꼬리표가 `None` 인데도 늦게 끝난 프레임이 실재한다 ' +
        '(실측 Stream 세션: `None` 240장 중 41장). 반대로 `Buffer Stuffing` 은 꼬리표가 붙어도 ' +
        '`on_time_finish = 1` 인 경우가 대부분이었다.',
    ),
  dropped_frames: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '`jank_type` 에 `Dropped Frame` 이 들어간 프레임 수. `by_type` 에도 같은 값이 있지만, ' +
        '**표시 주기를 통째로 넘긴 프레임**이라 따로 센다 — 사람이 끊김으로 보는 것이 이것이다.',
    ),
  by_type: z
    .array(z.object({ type: z.string(), count: z.number().int().nonnegative() }))
    .describe(
      '꼬리표별 프레임 수, 많은 순. `type` 은 SurfaceFlinger 가 쓰는 원문이다 ' +
        '(`Dropped Frame` · `App Deadline Missed` · `Buffer Stuffing` · ' +
        '`SurfaceFlinger Stuffing` · `Display HAL` 등) — 우리가 정한 분류가 아니다. ' +
        '**합이 `janky_frames` 를 넘을 수 있다**: 한 프레임에 꼬리표가 여러 개 붙으면 ' +
        '(`"App Deadline Missed, Buffer Stuffing"`) 각각에 세어진다.',
    ),
})
export type FrameJank = z.infer<typeof FrameJankSchema>

const FRAME_JANK_DESCRIPTION =
  '**기기가 프레임마다 붙여 둔 꼬리표를 센 것이다 — 이 도구의 판정이 아니다.** ' +
  'SurfaceFlinger 가 `actual_frame_timeline_slice.jank_type` 에 직접 적고, 우리는 개수만 낸다. ' +
  '어느 꼬리표가 심각한지는 정하지 않는다 — 실측에서 `Buffer Stuffing` 이 1,347장으로 ' +
  '압도적이었는데 그 대부분은 마감 안에 끝났다(`on_time_finish = 1`). ' +
  '**`janky_frames / total_frames` 를 그대로 "품질" 로 읽지 말 것.** ' +
  '`dur` 와 같은 테이블·같은 트레이스에서 나오므로 기기에 더 물어보지 않는다. ' +
  '`null` 은 **꼬리표를 읽지 못했다**는 뜻이지 문제가 없었다는 뜻이 아니다.'

export const FrameDataSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  /** 그 프로세스의 pid. target_app.render_process / target_app.pid 가 여기서 채워진다. */
  pid: z.number().int(),
  total_frames: z.number().int().nonnegative(),
  buckets: z.array(FrameBucketSchema).describe(BUCKETS_DESCRIPTION),
  percentiles: z.object({
    p50: z.number(),
    p90: z.number(),
    p95: z.number(),
    p99: z.number(),
  }),
  mean_ms: z.number(),
  max_ms: z.number(),
  timeline: z.array(FrameTimelinePointSchema).optional().describe(FRAME_TIMELINE_DESCRIPTION),
  // `optional` 과 `nullable` 이 서로 다른 말이다 — **필드가 없다**는 이 값을 낼 줄 모르던
  // 시절의 세션이고(`timeline` 과 같은 이유로 optional 이다), **null** 은 이번에 읽지
  // 못했다는 뜻이다. 옛 run 을 `extract` 로 다시 산출할 때 전자가 실제로 나온다.
  jank: FrameJankSchema.nullable().optional().describe(FRAME_JANK_DESCRIPTION),
})
export type FrameData = z.infer<typeof FrameDataSchema>

export const StartupDataSchema = z.object({
  /**
   * `am start -W` 의 TotalTime — 프로세스 시작부터 첫 프레임까지.
   *
   * **`null` 은 기기가 이 값을 내지 않았다는 뜻이다** (보통 `status: "timeout"`).
   * 0 과 혼동하면 안 된다 — 0 은 "0ms 만에 떴다" 이고, 그런 일은 없다.
   * 이 자리가 `null` 이어도 앱은 떴을 수 있다: `target_app.pid` 와 다른 metrics 를 보라.
   */
  total_time_ms: z.number().int().nonnegative().nullable(),
  /**
   * `am start -W` 의 LaunchState 원문 (COLD / WARM / HOT). 기기가 보고하지 않으면 null.
   * enum 으로 좁히지 않는다 — 우리가 정하는 값이 아니라 기기가 뱉는 문자열이다.
   */
  launch_state: z.string().nullable(),
  /**
   * `am start -W` 의 `Status:` 원문. 정상은 `"ok"`, 기다리다 포기하면 `"timeout"`.
   * 기기가 안 찍으면 null. 이것도 우리가 정하는 값이 아니라 기기가 뱉는 문자열이다.
   */
  status: z.string().nullable(),
  wait_time_ms: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      '`am start -W` 의 WaitTime — **호출자가 기다린 시간**이지 앱의 시작 시간이 아니다. ' +
        '`status` 가 `"ok"` 면 TotalTime 에 ActivityManager 자신의 오버헤드가 더해진 값이고, ' +
        '**`status` 가 `"timeout"` 이면 ActivityManager 가 포기한 시점**이다 — 그때 이 값은 ' +
        '앱을 잰 것이 아니라 기기의 임계치다. 실측(SM-A405S / Android 11, 같은 앱 4회): ' +
        '10182 · 10150 · 10147 · 10163ms 로 편차 0.3% — 앱이 11초 걸리든 60초 걸리든 같은 값이 나온다. ' +
        '**그러므로 timeout 일 때 이 값을 시작 시간으로 읽지 말 것.** ' +
        '읽을 수 있는 것은 하한 하나다: "이 앱은 이 기기에서 wait_time_ms 안에 뜨지 못했다".',
    ),
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

/**
 * 이 메트릭의 필드 이름이 `device_` 로 시작하면 **기기 전역**, `app` 아래면 **대상 앱**이다.
 *
 * 예전 이름은 `total_busy_pct` / `per_core` / `frequency` 였고 전부 기기 전역이었다.
 * 한정이 `.describe()` 에만 있었으므로 필드명만 보는 소비자에게 `total_busy_pct` 는
 * "이 앱이 CPU 를 23% 썼다" 로 읽혔다. 앱 단위 값이 옆에 생긴 지금은 그 오독이 더 쉬워지므로
 * 이름 자체에 범위를 넣었다 (`z.toJSONSchema()` 는 런타임이라 소스 주석을 못 본다).
 */
const CPU_DEVICE_SCOPE =
  '**기기 전역이며 대상 앱만의 값이 아니다** — /proc/stat 은 프로세스를 구분하지 않는다. ' +
  '대상 앱의 CPU 는 이 객체의 `app` 에 있다. 이 값은 그 옆에 두고 읽는 맥락이다 ' +
  '(앱이 느린 것이 기기 전체가 바빴기 때문인지 볼 수 있다). '

/** 대상 앱의 프로세스 중 대표가 아닌 것 하나. 대표는 `AppCpuSchema` 본체다. */
export const AppCpuProcessSchema = z.object({
  process: z
    .string()
    .nullable()
    .describe('트레이스가 이 프로세스를 부르는 이름. 트레이스에 이름이 없으면 null 이다.'),
  pid: z.number().int(),
  user_ms: z.number().int().nonnegative(),
  kernel_ms: z.number().int().nonnegative(),
  total_ms: z.number().int().nonnegative(),
})
export type AppCpuProcess = z.infer<typeof AppCpuProcessSchema>

export const CpuTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  /** 그 1초 동안 이 앱이 쓴 CPU 시간 (user + kernel). */
  app_cpu_ms: z.number().nonnegative(),
})
export type CpuTimelinePoint = z.infer<typeof CpuTimelinePointSchema>

/**
 * 기기 전체 사용률의 한 초.
 *
 * 앱 쪽(`CpuTimelinePoint`)이 **시간(ms)** 인 것과 달리 여기는 **백분율**이다. 앱은 분모가
 * 없지만(한 프로세스가 몇 코어를 썼는지는 누적 카운터로 알 수 없다) 기기 전체는 그 초의
 * 총 CPU시간이 곧 분모라, 폴링이 지터를 겪어도 비율이 흔들리지 않는다.
 */
export const DeviceCpuTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  busy_pct: z
    .number()
    .nonnegative()
    .describe(
      '그 1초의 (총 CPU시간 − idle − iowait) / 총 CPU시간, 모든 코어 합산. ' +
        '**1코어=100% 가 아니라 전 코어를 합쳐 100% 다** — 8코어가 전부 바쁘면 100 이다.',
    ),
})
export type DeviceCpuTimelinePoint = z.infer<typeof DeviceCpuTimelinePointSchema>

const CPU_TIMELINE_DESCRIPTION =
  '앱이 **그 1초 동안** 쓴 CPU 시간(user+kernel). ' +
  '`runtime.*` 는 프로세스 시작부터의 **누적값**이라, 이 배열은 이웃한 두 표본의 차이다.\n' +
  '**첫 표본의 초는 배열에 없다** — 그 앞에 뺄 대상이 없기 때문이다. 0 으로 채우면 ' +
  '"그 초에 CPU 를 안 썼다" 는 없던 사실이 된다.\n' +
  '**이 배열의 합은 app.total_ms 이하다.** 두 값의 기준점이 다르기 때문이다: total_ms 는 ' +
  '전체 첫 표본부터 재고, 이 배열은 **0 초 구간의 마지막 표본**부터 잰다. 그 구간 안에 표본이 ' +
  '여럿이면(폴링 지터, 콜드 스타트) 그 사이의 증가분이 이 배열에는 없다 — 실측: 콜드 스타트 ' +
  '세션에서 34,000ms(배열) vs 34,650ms(total_ms). 초당 표본이 하나뿐이면 둘은 같아진다.\n' +
  '둘이 **함께** 놓치는 것은 첫 표본 이전(프로세스 생성부터 첫 폴링까지, 최대 1초)의 몫이고, ' +
  '그것이 app.total_ms 가 하한인 이유다 — 이 배열은 그보다 한 겹 더 낮은 하한이다.\n' +
  '표본 간격이 정확히 1초가 아닐 수 있으므로(폴링 지터) 이 값은 사용률(%)이 아니라 **시간(ms)** 이다.'

export const AppCpuSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  pid: z.number().int(),
  samples: z.number().int().nonnegative().describe('이 프로세스의 runtime 카운터 표본 수.'),
  sampled_ms: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '이 프로세스의 첫 표본과 마지막 표본 사이(ms). **세션 길이가 아니다** — 세션 도중 뜬 ' +
        '프로세스는 이 값이 짧다. 폴링 주기 때문에 세션 길이와 정확히 같은 경우도 없다.',
    ),
  user_ms: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '이 프로세스가 사용자 모드에서 쓴 CPU 시간(ms). linux.process_stats 의 ' +
        '`runtime.user_ns` 가 세션 구간에서 늘어난 양이다(= /proc/<pid>/stat 의 utime).',
    ),
  kernel_ms: z
    .number()
    .int()
    .nonnegative()
    .describe('같은 구간의 커널 모드 CPU 시간(ms). `runtime.kernel_ns` 의 증가량(= stime).'),
  total_ms: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'user_ms + kernel_ms. **이것은 CPU 시간이지 벽시계 시간이 아니다** — 여러 코어에서 ' +
        '동시에 돌면 벽시계보다 클 수 있다.\n' +
        '**커널이 clock tick 단위로만 보고하므로 해상도는 10ms 다** (USER_HZ=100). 짧은 세션의 ' +
        '0 은 "안 썼다" 가 아니라 "10ms 미만" 이다.\n' +
        '**첫 표본 이전의 CPU 시간은 빠진다.** 카운터는 첫 폴링 때 관측된 값에서 시작하므로, ' +
        '`--launch` 로 콜드 스타트한 앱은 프로세스 생성부터 첫 표본까지(최대 1초)의 몫이 ' +
        '들어 있지 않다. 즉 이 값은 하한이다.',
    ),
  share_of_device_cpu_pct: z
    .number()
    .describe(
      '**분모는 같은 구간 기기 전체의 CPU 시간(모든 코어의 cpu.times.* 증가량 합, idle 포함)** ' +
        '이다. 즉 벽시계 시간이 아니라 "벽시계 × 코어 수" 에 가깝고, 100% 는 모든 코어를 ' +
        '내내 이 앱이 썼다는 뜻이다. 8코어 기기에서 코어 하나를 100% 쓰면 이 값은 약 12.5% 다.\n' +
        '**같은 분모를 measurement_overhead.tracing_processes_cpu_share_pct 가 쓴다** — ' +
        '그래야 한 result.json 안의 두 백분율을 서로 비교할 수 있다.\n' +
        '"기기가 실제로 한 일 중 이 앱의 몫" 이 필요하면 이 값을 device_total_busy_pct 로 ' +
        '나누라 (분모가 같은 총 CPU 시간이라 그 비가 성립한다).\n' +
        'reason_code 가 cpu_counters_not_monotonic 이면 분모에서 그 코어들이 빠져 있으므로 ' +
        '이 값은 실제보다 크다.',
    ),
  other_processes: z
    .array(AppCpuProcessSchema)
    .describe(
      '대표 프로세스가 아닌, 이 앱의 것으로 **트레이스가 이름을 붙인** 프로세스들의 CPU 시간. ' +
        '위의 숫자에 **합산되어 있지 않다.**\n' +
        '**왜 합치지 않는가:** CPU 시간은 더해도 이중 계산이 아니지만, 더하려면 이 앱의 ' +
        '프로세스 집합이 완전해야 한다. 그런데 트레이스의 프로세스 이름은 완전하지 않다 — ' +
        'linux.process_stats 는 이름을 최초 관측 때 한 번만 확정하므로 갓 fork 된 앱 본체가 ' +
        '`<pre-initialized>` 로 남는다. 실기기 실측: 대상 앱 uid 의 프로세스 4개 중 이름이 ' +
        '패키지명과 정확히 같은 것은 8.63초를 쓴 **본체가 아니라** 10ms 를 쓴 자식이었다. ' +
        '불완전한 집합의 합을 "이 앱의 CPU" 라고 부르면 누가 빠졌는지조차 결과에 안 남는다. ' +
        '그래서 대표 하나만 위에 싣고 나머지는 각자 pid 를 달고 여기 남긴다.\n' +
        '**`[]` 는 "그런 프로세스를 관측하지 못했다" 이지 "없다" 가 아니다** — 이름이 낡은 ' +
        '서브프로세스는 애초에 후보에 들어오지 못한다. 합계가 필요하면 이 배열의 total_ms 를 ' +
        '직접 더하되, 그것도 하한이라는 사실과 함께 읽으라.',
    ),
  timeline: z.array(CpuTimelinePointSchema).optional().describe(CPU_TIMELINE_DESCRIPTION),
})
export type AppCpuData = z.infer<typeof AppCpuSchema>

export const CpuDataSchema = z.object({
  /** 첫 표본과 마지막 표본 사이. 폴링이라 세션 길이와 정확히 같지 않다. */
  device_sampled_ms: z.number().int().nonnegative(),
  device_samples: z.number().int().nonnegative(),
  device_total_busy_pct: z
    .number()
    .describe(
      '코어를 합친 사용률. (총 CPU시간 − idle − iowait) / 총 CPU시간. ' +
        CPU_DEVICE_SCOPE +
        '누적 카운터가 되감긴 코어는 집계에서 통째로 빠지므로, ' +
        'reason_code 가 cpu_counters_not_monotonic 이면 이 값은 device_per_core 에 남은 ' +
        '코어만의 것이다.',
    ),
  device_per_core: z
    .array(CpuCoreUsageSchema)
    .describe(
      `코어별 사용률. ${CPU_DEVICE_SCOPE}` +
        '기기의 모든 코어가 항상 들어 있다고 가정하면 안 된다 — ' +
        '카운터가 되감긴 코어는 빠지고, 그 사실은 reason_code 로 알린다.',
    ),
  device_frequency: z
    .array(CpuFrequencySchema)
    .nullable()
    .describe(
      `ftrace power/cpu_frequency 로 관측한 코어별 주파수(kHz). ${CPU_DEVICE_SCOPE}` +
        '이벤트가 하나도 없으면 **null** 이다 — 사용률만 있는 결과가 사용률+주파수인 척하지 않게.',
    ),
  device_timeline: z
    .array(DeviceCpuTimelinePointSchema)
    .nullable()
    .optional()
    .describe(
      `기기 전체 사용률의 초당 추이. ${CPU_DEVICE_SCOPE}` +
        '`cpu.times.*` 는 **누적값**이라 이 배열은 이웃한 두 표본의 차이이고, ' +
        'app.timeline 과 같은 이유로 **첫 표본의 초는 배열에 없다.**\n' +
        '집계값(device_total_busy_pct)과 이 배열의 평균은 정확히 같지 않다 — 집계는 전체 ' +
        '첫·마지막 표본의 차이 하나로 내고 이 배열은 초 경계마다 끊기 때문이다.\n' +
        '표본이 없거나 전부 되감겨 초당으로 나눌 수 없으면 **null** 이다. 0 으로 채우지 않는다.',
    ),
  app: AppCpuSchema.nullable().describe(
    '**대상 앱 프로세스 하나가 쓴 CPU 시간.** 프로세스 특정 규칙은 frame / memory 와 같다 ' +
      '(캡처한 pid → 정확한 패키지명 → `패키지:서브프로세스`), 그래서 세 메트릭이 같은 ' +
      '프로세스를 가리킨다.\n' +
      '**null 은 0 이 아니라 "내지 못했다" 이다.** reason_code 가 갈래를 말한다: ' +
      'process_not_in_trace(프로세스를 특정하지 못함) / no_app_cpu_samples(프로세스는 찾았는데 ' +
      'runtime.* 카운터가 없음 — record_process_runtime 이 꺼진 옛 캡처) / ' +
      'counter_went_backwards(누적 카운터가 감소 — pid 재사용 등) / query_failed.',
  ),
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

export const MemoryTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  /** 그 시점에 관측된 앱 프로세스의 RSS. 구간 평균이 아니라 **그 순간의 표본**이다. */
  rss_kb: z.number().int().nonnegative(),
})
export type MemoryTimelinePoint = z.infer<typeof MemoryTimelinePointSchema>

/** 기기 전체 메모리의 한 초. 앱의 RSS(`MemoryTimelinePoint`)와 분모가 다르다. */
export const SystemMemoryTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  mem_available_kb: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '커널의 `MemAvailable` — 스왑 없이 새 프로세스에 내줄 수 있다고 커널이 추산한 양. ' +
        'MemFree 와 다르다 (회수 가능한 캐시를 포함한다).',
    ),
  mem_free_kb: z.number().int().nonnegative().describe('커널의 `MemFree` — 어디에도 쓰이지 않는 양.'),
})
export type SystemMemoryTimelinePoint = z.infer<typeof SystemMemoryTimelinePointSchema>

const MEMORY_TIMELINE_DESCRIPTION =
  '1초 주기로 폴링된 앱 RSS 의 추이. 집계값(rss.avg_kb / max_kb)과 같은 원본에서 나온다. ' +
  '평균만으로는 구분되지 않는 것 — 내내 일정했는지, 계속 우상향했는지 — 을 보려는 값이다. ' +
  '**구간 평균이 아니라 그 순간의 표본**이므로, 표본과 표본 사이의 순간 최고점은 여기에도 없다. ' +
  '이 배열이 있다고 기기에 더 많은 것을 물은 것은 아니다 (폴링 주기는 그대로다).'

export const MemoryDataSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  pid: z.number().int(),
  samples: z.number().int().nonnegative(),
  rss: MemoryStatSchema,
  rss_anon: MemoryStatSchema.nullable(),
  rss_file: MemoryStatSchema.nullable(),
  timeline: z.array(MemoryTimelinePointSchema).optional().describe(MEMORY_TIMELINE_DESCRIPTION),
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
  system_timeline: z
    .array(SystemMemoryTimelinePointSchema)
    .nullable()
    .optional()
    .describe(
      '기기 전체 가용 메모리의 초당 추이. **앱이 아니라 기기 전체다** — 앱의 RSS 가 늘어도 ' +
        '기기 가용이 그만큼 줄지 않을 수 있다(캐시 회수 등).\n' +
        'meminfo 는 누적이 아니라 **그 순간의 값**이라 첫 초도 배열에 있다 (app.timeline · ' +
        'cpu.device_timeline 이 첫 초를 빼는 것과 다르다). 한 초에 표본이 여럿이면 마지막 것을 쓴다.\n' +
        'meminfo 카운터가 없으면 **null** 이다 — system 이 null 인 경우와 같은 원인이다.',
    ),
})
export type MemoryData = z.infer<typeof MemoryDataSchema>

export const LogEventSchema = z.object({
  tag: z.string(),
  message: z.string(),
  pid: z
    .number()
    .int()
    .nullable()
    .describe(
      '이 줄을 **찍은** 프로세스의 pid. 사건의 주체가 아니라 기록자다 — ANR 은 ' +
        'system_server 가 찍으므로 여기 system_server 의 pid 가 온다(실측 확인). ' +
        '대상 앱이 직접 찍은 줄인지는 metrics.log.data.app.pid 와 비교해서 판단하라. ' +
        '**null 은 트레이스가 이 줄의 프로세스를 특정하지 못했다는 뜻이다** — ' +
        'android_logs 는 utid 만 갖고 있어 thread/process 테이블을 거쳐야 하는데 ' +
        'linux.process_stats 가 없거나 그 스레드를 못 본 경우가 있다.',
    ),
  process: z
    .string()
    .nullable()
    .describe('그 프로세스의 이름(트레이스 기준). pid 와 같은 규칙으로 null 일 수 있다.'),
})
export type LogEvent = z.infer<typeof LogEventSchema>

/**
 * `device_` 접두어가 없던 시절의 `total` / `by_priority` / `crashes` / `anrs` 는 전부
 * 기기 전역이었고, 그 한정이 `.describe()` 에만 있었다. 이제 앱 단위 값이 옆에 생기므로
 * **접두어로 범위를 이름에 넣는다** — `total` 이라는 이름으로 앱 단위 값과 기기 전역 값이
 * 각각 존재하는 상태가 가장 나쁘다.
 */
const LOG_DEVICE_SCOPE =
  '이 값은 **기기 전역**이며 대상 앱만의 값이 아니다 — android.log 데이터소스는 logd 전체를 ' +
  '받고 프로세스로 거르지 않는다. 대상 앱만의 개수는 `app` 에 있다. ' +
  '실측 대조(같은 세션, SM-S901N / Android 16): 기기 전역 W 1,095 / E 412 인데 대상 앱 ' +
  '프로세스만은 W 24 / E 13 이었다 — **45배 / 32배 차이다.** '
const LOG_EVENT_SCOPE =
  `crashes 와 anrs 를 합쳐 최대 ${'200'}건까지만 담는다(ts 오름차순). ` +
  '상한에 닿으면 status 가 partial 이 되고 reason_code 가 log_events_truncated 로 그 사실을 ' +
  '말한다 — 그 뒤에 더 있었는지는 이 결과로 알 수 없다. 개수는 잘리지 않는다. '
/**
 * `[]` 와 `null` 은 다른 사실이다. 이 구분이 없던 동안, 이벤트 쿼리가 실패한 세션이
 * "크래시 0건" 을 사실처럼 실어 냈다 — 같은 collector 가 빈 로그 버퍼에 대해서는
 * `no_log_entries` 로 거부하던 바로 그 일이다.
 */
const LOG_EVENT_NULL =
  '**null 은 세지 못했다는 뜻이다** — 이벤트 쿼리가 실패한 경우이며 reason_code 가 ' +
  'query_failed 로 그 사실을 말한다. 빈 배열([])은 "쿼리는 성공했고 관측된 것이 없다" 이다. ' +
  '둘을 같은 뜻으로 읽으면 안 된다.'

export const LogTimelinePointSchema = z.object({
  t_s: z.number().int().nonnegative().describe(TIMELINE_T_DESCRIPTION),
  /** 그 1초에 이 앱이 찍은 줄 수 (min_prio 이상만). */
  count: z.number().int().nonnegative(),
  /** 그중 ERROR 이상. 나머지가 곧 WARN 은 아니다 — min_prio 아래는 애초에 안 잡힌다. */
  error: z.number().int().nonnegative(),
})
export type LogTimelinePoint = z.infer<typeof LogTimelinePointSchema>

const LOG_TIMELINE_DESCRIPTION =
  '1초 단위로 묶은 **앱 프로세스**의 로그 발생 추이 (기기 전역이 아니다). ' +
  'app.total / app.by_priority 와 같은 원본·같은 필터에서 나온다. ' +
  '어느 구간에서 에러가 몰렸는지를 보려는 값이고, 그 구간의 프레임·메모리와 t_s 로 맞춰 볼 수 ' +
  '있다. min_prio 아래 우선순위는 여기에도 없다.'

export const AppLogSchema = z.object({
  process: z.string().describe(PROCESS_NAME_DESCRIPTION),
  pid: z.number().int(),
  total: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '이 프로세스가 찍은 로그 줄의 수. android_logs 를 utid → thread → **upid** 로 걸러 센다 ' +
        '(pid 가 아니다 — pid 는 재사용될 수 있고 그러면 남의 로그가 섞인다).\n' +
        '**시간으로 자르지 않는다**: 이 프로세스가 트레이스 구간 안에서 찍은 줄 전부이고, ' +
        '첫 process_stats 표본 이전(콜드 스타트 구간)의 줄도 포함된다.\n' +
        '**0 은 관측이다** — 이 값이 나온 시점에 기기 전역 개수는 이미 0 이 아니었으므로 ' +
        '(그렇지 않으면 이 메트릭 전체가 no_log_entries 로 값을 내지 않는다) 로그 경로가 ' +
        '살아 있었다는 것이 확인된 상태다. 반대로 앱을 **특정하지 못한** 경우 이 객체 자체가 ' +
        'null 이다.',
    ),
  by_priority: z
    .object({
      warn: z.number().int().nonnegative(),
      error: z.number().int().nonnegative(),
      fatal: z.number().int().nonnegative(),
    })
    .describe(
      '이 프로세스가 찍은 W/E/F 세 우선순위의 줄 수. 세 값의 합은 total 과 다를 수 있다 — ' +
        'total 은 이 셋 밖의 우선순위까지 세기 때문이다.',
    ),
  timeline: z.array(LogTimelinePointSchema).optional().describe(LOG_TIMELINE_DESCRIPTION),
})
export type AppLogData = z.infer<typeof AppLogSchema>

export const LogDataSchema = z.object({
  min_prio: z
    .string()
    .describe(
      '이 세션이 android.log 데이터소스에 **요청한** 최소 우선순위(문턱). ' +
        'logd 가 이 문턱으로 걸러 보내므로 아래 개수는 사실상 이 문턱 이상의 줄들이지만, ' +
        '이 도구는 트레이스를 받은 뒤 우선순위로 다시 거르지 않는다 — 개수의 정의는 ' +
        '"트레이스에 있는 것을 센다" 이지 "문턱 이상만 센다" 가 아니다. ' +
        '그래도 문턱 없이는 개수를 읽을 수 없다: "W 118건" 은 무엇이 걸러진 뒤의 숫자인지 ' +
        '모르면 의미가 없다. app 과 device_* 양쪽에 똑같이 적용된다.',
    ),
  app: AppLogSchema.nullable().describe(
    '**대상 앱 프로세스가 찍은 로그만** 센 것. 프로세스 특정 규칙은 frame / memory / cpu 와 ' +
      '같다, 그래서 네 메트릭이 같은 프로세스를 가리킨다.\n' +
      '**null 은 0 이 아니라 "내지 못했다" 이다.** reason_code 가 갈래를 말한다 ' +
      '(process_not_in_trace / query_failed). ' +
      '**앱이 한 줄도 안 찍은 것은 null 이 아니라 total: 0 이다** — 둘을 같게 읽으면 안 된다.\n' +
      '**크래시와 ANR 은 여기 없다.** 아래 device_crashes / device_anrs 설명을 보라 — ' +
      '앱 pid 로 거르면 ANR 이 통째로 사라지기 때문이다.',
  ),
  device_total: z
    .number()
    .int()
    .nonnegative()
    .describe(
      `트레이스에 담긴 로그 줄 **전부**의 수. ${LOG_DEVICE_SCOPE}` +
        '우선순위로 거르지 않고 트레이스에 있는 줄을 그대로 센다(min_prio 설명 참고). ' +
        '트레이스 버퍼가 넘쳤다면 그만큼 적다(measurement_overhead.trace_buffer_overrun 참고).',
    ),
  device_by_priority: z
    .object({
      warn: z.number().int().nonnegative(),
      error: z.number().int().nonnegative(),
      fatal: z.number().int().nonnegative(),
    })
    .describe(
      `W/E/F 세 우선순위의 로그 줄 수. ${LOG_DEVICE_SCOPE}` +
        '세 값의 합은 device_total 과 다를 수 있다 — device_total 은 이 셋 밖의 우선순위 ' +
        '(문턱보다 낮은 줄이 섞여 온 경우)까지 세기 때문이다. 반대 방향의 누락은 없다.',
    ),
  device_crashes: z
    .array(LogEventSchema)
    .nullable()
    .describe(
      '세션 동안 관측된 크래시(AndroidRuntime 의 FATAL EXCEPTION, libc 의 Fatal signal). ' +
        '**기기 전역이며 대상 앱으로 거르지 않는다 — 그것이 의도다.** ' +
        '거르면 앱이 죽은 뒤 다른 프로세스가 남긴 줄이 사라진다. 대신 각 항목이 **찍은 ' +
        '프로세스의 pid/process** 를 함께 실으므로, 대상 앱 것만 보려면 ' +
        'data.app.pid 와 비교해 직접 거르라.\n' +
        '실측(SM-S901N / Android 16): 네이티브 크래시를 내는 `libc` 태그 줄은 **그 프로세스 ' +
        '자신이** 찍었다(대상 앱 pid, 두 세션에서 각각 9줄). `AndroidRuntime` 태그도 그것을 ' +
        '내는 프로세스 자신이 찍는 것으로 관측됐다(기기 logcat 의 `RuntimeInit` 시작 줄이 ' +
        '그 명령 자신의 pid 로 찍혔다). **다만 `FATAL EXCEPTION` 줄 자체는 이 저장소가 ' +
        '실기기에서 한 줄도 보지 못했다** — 관측한 세션에 0건이었고, 확인하려면 사용자의 앱을 ' +
        '실제로 죽여야 한다. 그래서 자바 크래시가 항상 앱 프로세스로 찍힌다고 **단정하지 ' +
        '않으며**, 거르지 않는 이유가 여기에도 있다. ' +
        LOG_EVENT_SCOPE +
        LOG_EVENT_NULL,
    ),
  device_anrs: z
    .array(LogEventSchema)
    .nullable()
    .describe(
      '세션 동안 관측된 ANR(ActivityManager 의 "ANR in ..."). ' +
        '**기기 전역이며 대상 앱으로 거를 수 없다.** ' +
        '실측(SM-S901N / Android 16): 이 트레이스의 `ActivityManager` 태그 16줄은 **전부 ' +
        'system_server(pid 2414)가 찍었다.** ANR 은 앱이 아니라 system_server 가 기록하므로 ' +
        '대상 앱 pid 로 걸렀다면 ANR 이 **하나도 남지 않았을 것이다.** ' +
        '어느 앱의 ANR 인지는 message 의 "ANR in <패키지>" 로 읽으라 — 항목의 pid/process 는 ' +
        '기록자(system_server)이지 멈춘 앱이 아니다. ' +
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
  orientation: z
    .enum(['portrait', 'landscape', 'square'])
    .nullable()
    .optional()
    .describe(
      '`wm size` 가 보고한 **물리 해상도**의 가로세로 비교. 세션 중 기기가 실제로 어느 방향을 ' +
        '보고 있었는지가 아니다 — 회전은 세션 중에도 바뀌고 이 도구는 그것을 추적하지 않는다. ' +
        '폴더블은 접힘 상태에 따라 이 값이 달라진다. 확인하지 못했으면 null.',
    ),
  size_class: z
    .enum(['small', 'normal', 'large', 'xlarge'])
    .nullable()
    .optional()
    .describe(
      '안드로이드 화면 크기 구간. 짧은 변을 dp 로 환산해 320/480/720 경계로 가른다 ' +
        '(width_px·height_px·density_dpi 에서 계산한 값이며 기기가 준 값이 아니다). ' +
        '셋 중 하나라도 0 이면 null.',
    ),
  opengl_es_version: z
    .string()
    .nullable()
    .optional()
    .describe(
      '`ro.opengles.version` 원문(예: `196610`). **10진 문자열이지만 의미는 16진 인코딩이다** — ' +
        '상위 16비트가 major, 하위 16비트가 minor라 196610 = 0x30002 = OpenGL ES 3.2 다. ' +
        '이 도구는 해석하지 않고 기기가 준 값을 그대로 싣는다.',
    ),
})
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>

/**
 * 이 도구를 **돌린 컴퓨터**. 기기가 아니다.
 *
 * 왜 남기는가: 같은 앱·같은 기기인데 수치가 다른 두 세션을 비교할 때, 호스트가 달랐다는
 * 사실이 후보에서 빠지면 원인을 기기에서만 찾게 된다. adb 왕복 지연과 트레이스 회수 속도는
 * 호스트에 달렸고, 그 둘은 측정 창 **밖**이지만 세션 전체 길이에는 들어간다.
 */
export const HostInfoSchema = z.object({
  os: z.string().describe('node `process.platform` 원문 (`darwin` / `linux` / `win32`).'),
  arch: z.string().describe('node `process.arch` 원문 (`arm64` / `x64`).'),
  node: z.string().describe('이 도구를 실행한 node 버전.'),
})
export type HostInfo = z.infer<typeof HostInfoSchema>

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
  launcher_activity: z
    .string()
    .nullable()
    .describe(
      '`--launch` 가 `am start -n <package>/<이 값>` 으로 실제로 띄운 액티비티. ' +
        '진입점이 여러 개인 앱에서는 이 도구가 그중 하나를 고른 것일 수 있고, 그때는 ' +
        'launcher_activity_candidates 에 후보 전체가 들어간다.',
    ),
  /**
   * 진입점이 **둘 이상**이라 그중 하나를 골라야 했을 때의 후보 전체 (기기가 준 순서 그대로).
   * 고를 필요가 없었으면 `null` 이다 — "후보가 없었다"(`[]`)와 다른 뜻이다.
   *
   * 디버그 빌드에서 흔하다: LeakCanary 같은 라이브러리가 자기 런처 아이콘을 추가하면
   * 그 앱은 LAUNCHER 액티비티를 둘 갖게 된다.
   */
  launcher_activity_candidates: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      '진입점이 여러 개여서 launcher_activity 를 이 도구가 고른 경우의 후보 전체. ' +
        '고르지 않았으면 null. 이 값이 있으면 launcher_activity 는 기기가 지정해 준 것이 ' +
        '아니라 선택된 것이다.',
    ),
  render_process: z.string().nullable(),
  pid: z.number().int().nullable(),

  /**
   * 아래 다섯은 전부 `dumpsys package <패키지>` 한 번의 출력에서 나온다 — `version_name` ·
   * `install_source` 를 읽으려고 이미 돌리던 명령이라 **기기 왕복이 늘지 않는다.**
   *
   * 다섯 모두 `null` 이 "그 줄을 찾지 못했다" 는 뜻이다. 특히 `debuggable: false` 는
   * "릴리스 빌드임을 확인했다" 이고 `null` 은 "모른다" 라 서로 바꿔 쓸 수 없다 —
   * 디버그 빌드를 재고 릴리스라고 읽는 것이 이 도구에서 가장 비싼 착각이다.
   */
  debuggable: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      '`flags=[ ... DEBUGGABLE ... ]` 의 유무. **true 면 이 세션은 릴리스 빌드를 잰 것이 ' +
        '아니다** — 디버그 빌드는 JIT·검증·로깅이 달라 수치를 릴리스와 비교할 수 없다. ' +
        '이 도구는 그 사실을 판정하지 않고 적기만 한다. null 은 확인하지 못한 것.',
    ),
  large_heap: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      '`flags=[ ... LARGE_HEAP ... ]` 의 유무 (`android:largeHeap="true"`). ' +
        'metrics.memory 의 RSS 를 읽을 때 상한이 다르다는 사실이 여기 있다.',
    ),
  min_sdk: z.number().int().nullable().optional().describe('`minSdk=` 원문.'),
  target_sdk: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      '`targetSdk=` 원문. 기기의 sdk_int 와 다를 수 있고, 그 차이가 곧 플랫폼이 이 앱에 ' +
        '적용하는 호환 동작의 범위다.',
    ),
  primary_cpu_abi: z
    .string()
    .nullable()
    .optional()
    .describe(
      '`primaryCpuAbi=` — 이 앱이 **실제로 실행되는** ABI. 기기가 지원하는 목록 ' +
        '(device.static.abis)의 부분집합이며, 64비트 기기에서 32비트로 도는 앱이 여기서 갈린다. ' +
        'APK 에 네이티브 코드가 없으면 기기가 `null` 을 찍고 이 값도 null 이다.',
    ),
})
export type TargetApp = z.infer<typeof TargetAppSchema>

/**
 * 측정 중 **사람이** 남긴 사건 하나. 도구가 관측한 것이 아니라 사람이 적은 것이다.
 *
 * 왜 필요한가: `metrics.*.timeline` 은 초 단위 시계열이지만 그 안의 어느 구간이 "홈 진입"
 * 이고 어느 구간이 "스크롤" 인지는 데이터에 없다. 그 대응을 아는 것은 기기 앞에 있던
 * 사람뿐이고, 그 사람이 그 순간에 적어 두지 않으면 다시는 복원되지 않는다.
 *
 * 절대 시각이 아니라 **세션 시작으로부터의 경과**인 것은 시계열과 같은 축에 놓기 위해서다 —
 * `timeline[].second` 와 `offset_ms / 1000` 이 같은 0 을 기준으로 한다.
 */
export const MarkSchema = z.object({
  offset_ms: z
    .number()
    .int()
    .describe('세션 시작(session.started_at)으로부터의 경과(ms). timeline 의 second 와 같은 축이다.'),
  label: z.string().describe('사람이 적은 이름. 이 도구는 내용을 해석하지 않는다.'),
})
export type Mark = z.infer<typeof MarkSchema>

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
  options: z.object({ launch: z.boolean() }),
  /**
   * `[]` 는 **"아무도 아무것도 적지 않았다"** 는 사실이다 (규칙 3 의 예외가 아니라 그 자체다).
   * CLI 로 잰 세션은 마킹을 남길 방법이 없으므로 항상 비어 있고, GUI 세션만 값을 가진다.
   *
   * optional 인 것은 이 필드가 없던 시절의 run 디렉토리를 그대로 다시 산출하기 위해서다.
   */
  marks: z
    .array(MarkSchema)
    .optional()
    .describe(
      '측정 중 사람이 남긴 이벤트 라벨. 시간순(오름차순). ' +
        '**도구가 관측한 것이 아니라 사람이 적은 것이다** — 정확도는 적은 사람의 손에 달려 있다. ' +
        '빈 배열은 아무도 적지 않았다는 뜻이고, 필드 자체가 없으면 마킹 개념이 없던 시절의 문서다.',
    ),
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
  raw: z.array(z.string()),
})
export type Artifacts = z.infer<typeof ArtifactsSchema>

/**
 * **이 파일만 받은 사람에게 어디를 봐야 하는지 알려 준다.**
 *
 * 필드의 함정은 전부 스키마의 `.describe()` 에 있는데, `result.json` 자체에는 `schema_version`
 * 숫자만 있었다. 그래서 이 파일만 건네받은 소비자(특히 LLM)는 이런 결론을 낼 수 있었다:
 * `adb_commands_during_session: 0` → "측정이 깨끗했다". 실제로는 "perftracker 가 아무것도
 * 보내지 않았다" 일 뿐이고 다른 프로세스가 기기를 만졌는지는 이 도구가 모른다.
 *
 * 값이 상수인데도 파일에 싣는 이유가 그것이다 — 스키마를 **읽으러 가는 길**은 파일 안에
 * 있어야 하고, 밖에 있으면 그 길을 모르는 사람이 함정을 그대로 밟는다.
 */
export const SCHEMA_HELP =
  '필드의 뜻과 함정(특히 null 과 0 의 차이)은 `perftracker schema` 가 내는 JSON Schema 에 있습니다. ' +
  '값을 해석하기 전에 그것부터 읽으세요.'

export const ResultSchema = z.object({
  schema_version: z.string(),
  schema_help: z
    .string()
    .optional()
    .describe(
      '이 파일을 해석하려면 무엇을 먼저 읽어야 하는지. **값은 항상 같다** — 안내이지 데이터가 아니다. ' +
        'optional 인 것은 이 필드가 없던 시절의 result.json 을 그대로 읽기 위해서다.',
    ),
  tool: z.object({
    name: z.string(),
    version: z.string(),
    /** optional 인 것은 이 필드가 없던 시절의 result.json 을 그대로 읽기 위해서다. */
    host: HostInfoSchema.optional(),
  }),
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
