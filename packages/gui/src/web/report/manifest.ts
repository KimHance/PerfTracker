import type { Fmt } from './format.js'

/**
 * **보고서의 유일한 확장 지점.**
 *
 * 지표마다 컴포넌트를 만들지 않는다. `result.json` 안의 데이터 모양은 실제로 여섯 가지뿐이고,
 * 각 지표가 여기서 **자기 모양(`kind`)과 데이터 위치(`path`)** 를 선언하면 렌더러는 모양만
 * 안다. 지표가 늘면 이 배열에 한 줄, 새 *모양*이 나올 때만 `kind` 를 하나 늘린다.
 *
 * 실제로 이 도구는 필드가 계속 는다 — 최근에 `cpu.device_timeline` ·
 * `memory.system_timeline` · 앱 빌드 속성 다섯이 한 번에 들어왔고, 그때 화면 코드는
 * 이 배열 말고는 고칠 것이 없어야 한다.
 */

export type BlockKind = 'stat' | 'distribution' | 'series' | 'bars' | 'delta' | 'pairs'

export type SectionId = 'startup' | 'render' | 'cpu' | 'memory' | 'log' | 'context' | 'device'
export type TabId = 'summary' | 'device'
export type MetricId =
  | 'frame' | 'hwui' | 'startup' | 'cpu' | 'memory' | 'log' | 'thermal' | 'network'

export interface BlockBase {
  kind: BlockKind
  title: string
  section: SectionId
  /** 12칸 그리드에서 차지하는 칸 수. */
  span: number
  unit?: string
  /**
   * 이 블록이 속한 지표. `metrics[metric].status` 와 `reason` 을 끌어와 배지·툴팁에 쓴다.
   * 지표에 속하지 않는 블록(기기 정보 · 오버헤드)은 생략한다.
   */
  metric?: MetricId
  /**
   * `result.json` 안의 위치. **점 표기 그대로 읽는다 — 규칙으로 유추하지 않는다.**
   *
   * 같은 `timeline` 이라도 위치가 다르기 때문이다:
   * ```
   * metrics.frame.data.timeline        ← data 바로 아래
   * metrics.memory.data.timeline       ← 여기도
   * metrics.cpu.data.app.timeline      ← cpu 는 app 아래   ★
   * metrics.log.data.app.timeline      ← log 도 app 아래   ★
   * metrics.cpu.data.device_timeline   ← 기기 쪽은 또 다르다
   * metrics.memory.data.system_timeline
   * ```
   * "`data.timeline` 을 보면 된다" 는 규칙을 만들면 cpu 와 log 가 조용히 빈다.
   */
  path?: string
  /**
   * 두 번째 계열색으로 그린다. **경고가 아니라 구분이다** — 이 화면은 판정하지 않으므로
   * 색으로 좋고 나쁨을 말하지 않는다 (규칙 2). 값의 출처가 다르다는 표시일 뿐이다.
   */
  tone?: 'alt'
}

export interface StatBlock extends BlockBase {
  kind: 'stat'
  path: string
  fmt: Fmt
  /** 큰 숫자 아래 한 줄. `l` 라벨 · `p` 경로 · `f` 포맷. */
  sub?: { l: string; p: string; f: Fmt }[]
}

export interface DistributionBlock extends BlockBase {
  kind: 'distribution'
  path: string
  percentilesPath: string
  totalPath: string
  /**
   * 빈 버킷이 이만큼 이어지면 축을 끊는다.
   *
   * **`Infinity` 다 — 접지 않는다.** 꼬리 버킷을 30→50→100ms 로 넓히면서 배열이 101칸에서
   * 61칸이 됐고, 그 폭이면 전부 그려도 한 화면에 들어온다. 접기 로직은 남겨 둔다 —
   * 버킷이 다시 늘거나 아주 좁은 창에서 필요해질 수 있고, 그때 이 숫자만 바꾸면 된다.
   */
  breakAfterEmptyBuckets: number
}

export interface SeriesBlock extends BlockBase {
  kind: 'series'
  path: string
  /** 배열 원소에서 읽을 값 필드. */
  field: string
  /** 같은 축에 얹을 점선 보조선. **부분집합일 때만 쓴다 — 쌓지 않는다.** */
  subField?: string
  subLabel?: string
  /** 단위 변환. 매니페스트에 명시한다 — 렌더러가 추측하지 않는다. */
  transform?: (v: number) => number
  /**
   * 첫 초가 배열에 없는 것이 정상인가.
   *
   * - `cumulative` — 누적 카운터의 델타라 **0초가 없다.** 앞에 뺄 표본이 없어서다.
   *   0 으로 채우면 "그 초에 안 썼다" 는 없던 사실이 된다.
   * - `gauge` — 그 순간의 값이라 0초도 있다.
   * - `count` — 그 초에 센 개수.
   */
  sampling: 'cumulative' | 'gauge' | 'count'
  /** `data` 는 0 이 아닌 데이터 최솟값에서 시작한다 (기기 가용 메모리처럼 0 근처가 없는 계열). */
  baseline: 'zero' | 'data'
  fmt: Fmt
}

export interface BarsBlock extends BlockBase {
  kind: 'bars'
  path: string
  labelField: string
  labelPrefix: string
  valueField: string
  fmt: Fmt
  /** `null` 이면 데이터 최댓값에 맞춘다. */
  scaleMax: number | null
  /** 있으면 이 경로의 값을 분모로 퍼센트를 함께 적는다. 없으면 개수만 낸다. */
  percentOfPath?: string
  /**
   * 라벨별 한 줄 설명. **이 값이 무엇이고 어느 쪽이 나은가**를 적는다.
   *
   * 규칙 2 를 깨지 않는다 — 깨지는 것은 *이 세션의 숫자*에 점수를 매기거나 기준치와
   * 비교할 때다. 여기 적는 것은 지표 자체의 뜻과 방향이고, 그것을 안 적으면 읽는 쪽이
   * `Buffer Stuffing` 1,556장을 보고 `Dropped Frame` 101장보다 심각하다고 읽는다.
   * 없는 라벨은 설명 없이 개수만 나온다 — 기기가 새 이름을 내도 화면은 그대로 돈다.
   */
  labelNotes?: Record<string, string>
}

export interface DeltaBlock extends BlockBase {
  kind: 'delta'
  /** 배열형: 한 배열 안에 before/after 가 같이 있다 (온도 존). */
  labelField?: string
  beforeField?: string
  afterField?: string
  fmt?: Fmt
  /** 객체형: before/after 가 서로 다른 경로에 있다 (기기 상태). */
  beforePath?: string
  afterPath?: string
  keys?: { p: string; l: string; f: Fmt }[]
}

export interface PairsBlock extends BlockBase {
  kind: 'pairs'
  path: string
  /**
   * `p` 는 블록 `path` 기준 **상대** 경로다 (점 표기 가능).
   * `pct` 가 있으면 그 경로를 분모로 비율을 뒤에 붙인다 — 분모도 같은 기준의 상대 경로다.
   */
  keys?: { p: string; l: string; f: Fmt; pct?: string }[]
  /** 표준 key/value 로 안 떨어지는 모양. */
  arrayAs?: 'freq' | 'warnings'
}

export type Block =
  | StatBlock | DistributionBlock | SeriesBlock | BarsBlock | DeltaBlock | PairsBlock

/**
 * `note` 는 **이 지표를 무엇으로 읽으면 되는지**를 한 문장으로 말한다. 값에 대한 평가가
 * 아니라 읽는 법이라 규칙 2 를 깨지 않는다 — "이 앱이 느리다" 가 아니라 "이 숫자는 이런
 * 질문에 답한다" 다.
 */
export const SECTIONS: { id: SectionId; label: string; tab: TabId; note?: string }[] = [
  { id: 'startup', label: '앱 시작', tab: 'summary' },
  {
    id: 'render',
    label: '렌더',
    tab: 'summary',
    note: '**막대가 왼쪽에 몰릴수록 부드럽습니다.** 오른쪽으로 갈수록 오래 걸린 프레임입니다.',
  },
  { id: 'cpu', label: 'CPU', tab: 'summary' },
  { id: 'memory', label: '메모리', tab: 'summary' },
  { id: 'log', label: '로그', tab: 'summary' },
  { id: 'context', label: '맥락', tab: 'summary' },
  { id: 'device', label: '기기 · 앱', tab: 'device' },
]

export const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: '요약' },
  { id: 'device', label: '기기' },
]

export const KNOWN_METRICS: MetricId[] =
  ['frame', 'hwui', 'startup', 'cpu', 'memory', 'log', 'thermal', 'network']

/** 이 화면이 해석할 줄 아는 스키마 메이저. 다르면 헤더가 먼저 말한다. */
export const SCHEMA_MAJOR = 1

export const MANIFEST: Block[] = [
  // ── 앱 시작 ──────────────────────────────────────────────────
  //
  // 요약 타일 여섯 개가 있던 자리다. 다섯은 바로 아래 섹션이 같은 값을 더 자세히 말하고
  // 있어 지웠고, startup 만 남겨 자기 섹션으로 올렸다 — 한 번뿐인 사건이라 시계열도 분포도
  // 없어서 다른 지표와 같은 모양으로는 표현되지 않는다.
  {
    kind: 'stat', section: 'startup', title: '앱 시작', metric: 'startup', span: 3,
    path: 'metrics.startup.data.total_time_ms', fmt: 'int', unit: 'ms',
    sub: [
      { l: '상태', p: 'metrics.startup.data.launch_state', f: 'raw' },
      { l: 'wait', p: 'metrics.startup.data.wait_time_ms', f: 'ms0' },
    ],
  },
  {
    kind: 'pairs', section: 'startup', title: '측정값', metric: 'startup', span: 5,
    unit: 'am start -W', path: 'metrics.startup.data',
    keys: [
      { p: 'total_time_ms', l: 'TotalTime', f: 'ms0' },
      { p: 'wait_time_ms', l: 'WaitTime', f: 'ms0' },
      { p: 'launch_state', l: 'LaunchState', f: 'raw' },
      { p: 'status', l: 'Status', f: 'raw' },
    ],
  },
  {
    kind: 'pairs', section: 'startup', title: '진입점', span: 4, unit: '', path: 'target_app',
    keys: [
      { p: 'launcher_activity', l: '런처 액티비티', f: 'wrap' },
      { p: 'launcher_activity_candidates', l: '후보', f: 'list' },
      { p: 'render_process', l: '렌더 프로세스', f: 'wrap' },
      { p: 'pid', l: 'pid', f: 'raw' },
    ],
  },

  // ── 렌더 ─────────────────────────────────────────────────────
  {
    // **Vitals 가 보는 그 값이다** — UI 스레드 + RenderThread 의 CPU 시간, View 계층만.
    //
    // 트레이스에도 분포가 있다(`metrics.frame.data.buckets`, 서피스 프레임 지속 시간).
    // 화면에는 두지 않는다: 두 장을 나란히 놓았더니 읽는 쪽이 먼저 묻는 것이 "어느 게
    // 진짜냐" 였다. 데이터는 `result.json` 에 그대로 있고, 화면이 답할 질문만 하나로 줄인다.
    //
    // 버전 하한이 없어서 sdk 30 처럼 트레이스가 없는 기기에서도 이 카드는 그려진다.
    kind: 'distribution', section: 'render', title: '프레임 시간 분포',
    metric: 'hwui', unit: 'ms', span: 12, tone: 'alt',
    path: 'metrics.hwui.data.histogram',
    percentilesPath: 'metrics.hwui.data.percentiles',
    totalPath: 'metrics.hwui.data.total_frames',
    breakAfterEmptyBuckets: Infinity,
  },
  {
    // 기기가 프레임마다 붙여 둔 것을 센 것이지 이 화면의 판정이 아니다. 그 사실은 색으로만
    // 말한다 — 카드마다 출처를 문장으로 적으면 화면이 설명서가 된다. 근거는 스키마에 있다.
    kind: 'pairs', section: 'render', title: '프레임 수', metric: 'frame', span: 3,
    unit: '', tone: 'alt', path: 'metrics.frame.data.jank',
    // **분모가 같은 행은 전부 비율을 단다.** 드랍에만 달았더니 `전체` 가 곧 100% 인데
    // 5.2% 가 무엇에 대한 비율인지 화면에서 읽히지 않았다. `전체` 자신은 분모라 달지 않는다.
    keys: [
      { p: 'total_frames', l: '전체', f: 'int' },
      { p: 'janky_frames', l: 'jank_type 붙음', f: 'int', pct: 'total_frames' },
      { p: 'late_frames', l: '마감 넘김', f: 'int', pct: 'total_frames' },
      { p: 'dropped_frames', l: '드랍', f: 'int', pct: 'total_frames' },
    ],
  },
  {
    // 기기가 프레임마다 배정한 마감. 값이 여럿이면 세션 중 주사율이 바뀐 것이다 —
    // 그 사실 없이는 지속 시간을 **무엇에 대해** 읽어야 하는지 알 수 없다.
    kind: 'bars', section: 'render', title: '기기가 준 마감', metric: 'frame', span: 3,
    unit: '', tone: 'alt',
    path: 'metrics.frame.data.deadlines',
    labelField: 'ms', labelPrefix: '', valueField: 'frames', fmt: 'int', scaleMax: null,
    percentOfPath: 'metrics.frame.data.total_frames',
    labelNotes: {
      '8.33': '120Hz. 이 프레임들은 **8.33ms 안에** 끝냈어야 합니다 — 16.67ms 는 60fps 기기의 예산입니다.',
      '16.67': '60Hz. 화면이 이 구간에서 60Hz 로 내려갔습니다 — 요구가 그만큼 느슨해집니다.',
      '11.11': '90Hz.',
      '33.33': '30Hz.',
    },
  },
  {
    // **트레이스에 없는 것만 낸다.** 전체·janky·마감 넘김을 여기서도 내면 위 섹션과 같은
    // 이름이 두 번 나와서 "어느 게 진짜냐" 가 생긴다 — 실제로 그렇게 읽혔다.
    // 그 셋은 `total_frames` 로 이미 분포 카드의 각주에 있다.
    kind: 'pairs', section: 'render', title: '무엇이 느렸나', metric: 'hwui', span: 3,
    unit: '', tone: 'alt', path: 'metrics.hwui.data',
    keys: [
      { p: 'slow_ui_thread', l: 'UI 스레드', f: 'int' },
      { p: 'slow_draw_commands', l: '그리기 명령', f: 'int' },
      { p: 'slow_bitmap_uploads', l: '비트맵 업로드', f: 'int' },
      { p: 'missed_vsync', l: 'vsync 놓침', f: 'int' },
      { p: 'high_input_latency', l: '입력 지연', f: 'int' },
      { p: 'janky_frames', l: 'janky (프레임워크 판정)', f: 'int', pct: 'total_frames' },
    ],
  },
  {
    kind: 'bars', section: 'render', title: 'jank_type', metric: 'frame', span: 3,
    unit: '', tone: 'alt',
    path: 'metrics.frame.data.jank.by_type',
    labelField: 'type', labelPrefix: '', valueField: 'count', fmt: 'int', scaleMax: null,
    percentOfPath: 'metrics.frame.data.jank.total_frames',
    // 기기가 쓰는 이름 그대로가 키다. 번역하지 않는다 — 트레이스를 직접 열어 본 사람이
    // 같은 단어를 찾을 수 있어야 한다.
    labelNotes: {
      'Dropped Frame':
        '만들어 놓고 화면에 못 나간 프레임. **적을수록 좋습니다** — 사람이 끊김으로 보는 것이 이것입니다.',
      'App Deadline Missed':
        '앱이 마감 안에 프레임을 못 냈습니다. **적을수록 좋고**, 원인이 앱 쪽(그리기·메인 스레드)에 있다는 신호입니다.',
      'Buffer Stuffing':
        '앱이 화면보다 빨리 그려 대기열이 쌓인 상태. 프레임 자체는 제때 나가므로 **많다고 곧 끊김은 아니지만** 입력 지연이 늘어납니다.',
      'SurfaceFlinger Stuffing':
        '합성 쪽 대기열이 쌓인 상태. 앱 하나가 아니라 화면 전체 합성 사정입니다.',
      'SurfaceFlinger CPU Deadline Missed':
        '합성기가 CPU 작업 마감을 놓쳤습니다. 앱 밖 원인이라 앱 코드로 줄이기 어렵습니다.',
      'SurfaceFlinger GPU Deadline Missed':
        '합성기가 GPU 작업 마감을 놓쳤습니다. 앱 밖 원인입니다.',
      'Display HAL':
        '디스플레이 드라이버 단계에서 늦었습니다. 앱이 어쩌지 못하는 자리입니다.',
      'Unknown Jank':
        '기기가 원인을 특정하지 못했습니다. 늦었다는 사실만 남습니다.',
      'Prediction Error':
        '기기가 예측한 프레임 시간과 실제가 어긋났습니다. 그 자체가 끊김은 아닙니다.',
    },
  },

  // ── 렌더: 프레임워크가 센 것 ─────────────────────────────────

  // ── CPU: 시계열은 전부 선 ────────────────────────────────────
  {
    kind: 'series', section: 'cpu', title: '앱 CPU', metric: 'cpu', span: 4,
    unit: '% · 1코어 = 100%',
    path: 'metrics.cpu.data.app.timeline', field: 'app_cpu_ms',
    // ms/초 → %. 변환했으므로 fmt 는 단위 없는 n1 이다 (이중 변환 방지).
    transform: (ms) => ms / 10, sampling: 'cumulative', fmt: 'n1', baseline: 'zero',
  },
  {
    kind: 'series', section: 'cpu', title: '기기 CPU', metric: 'cpu', span: 4,
    unit: '% · 전 코어 = 100%',
    path: 'metrics.cpu.data.device_timeline', field: 'busy_pct',
    sampling: 'cumulative', fmt: 'n1', baseline: 'zero',
  },
  {
    kind: 'bars', section: 'cpu', title: '기기 코어별 사용률', metric: 'cpu', span: 4,
    unit: '세션 전체 집계 · %',
    path: 'metrics.cpu.data.device_per_core',
    labelField: 'cpu', labelPrefix: 'CPU ', valueField: 'busy_pct', fmt: 'pct2', scaleMax: 100,
  },
  {
    kind: 'pairs', section: 'cpu', title: '앱 CPU 시간', metric: 'cpu', span: 4, unit: '',
    path: 'metrics.cpu.data.app',
    keys: [
      { p: 'user_ms', l: 'user', f: 'ms0' },
      { p: 'kernel_ms', l: 'kernel', f: 'ms0' },
      { p: 'total_ms', l: '합계', f: 'ms0' },
      { p: 'sampled_ms', l: '표본 구간', f: 'ms0' },
      { p: 'samples', l: '표본 수', f: 'int' },
      { p: 'share_of_device_cpu_pct', l: '기기 CPU 대비', f: 'pct2' },
    ],
  },
  {
    kind: 'pairs', section: 'cpu', title: '클러스터 주파수', metric: 'cpu', span: 4,
    unit: 'avg / max', path: 'metrics.cpu.data.device_frequency', arrayAs: 'freq',
  },

  // ── 메모리 ───────────────────────────────────────────────────
  {
    kind: 'series', section: 'memory', title: '앱 RSS', metric: 'memory', span: 4, unit: 'MB',
    path: 'metrics.memory.data.timeline', field: 'rss_kb',
    transform: (kb) => kb / 1024, sampling: 'gauge', fmt: 'n0', baseline: 'zero',
  },
  {
    kind: 'series', section: 'memory', title: '기기 가용 메모리', metric: 'memory', span: 4,
    unit: 'MB',
    path: 'metrics.memory.data.system_timeline', field: 'mem_available_kb',
    // 0 근처를 지나지 않는 계열이라 0 기준선을 쓰면 선이 화면 위쪽에 눌린 직선이 된다.
    transform: (kb) => kb / 1024, sampling: 'gauge', fmt: 'n0', baseline: 'data',
  },
  {
    kind: 'pairs', section: 'memory', title: '앱 RSS 구성', metric: 'memory', span: 4,
    unit: 'min / avg / max', path: 'metrics.memory.data',
    keys: [
      { p: 'rss_anon', l: 'anon', f: 'mbTriple' },
      { p: 'rss_file', l: 'file', f: 'mbTriple' },
      { p: 'rss_watermark_peak_kb', l: 'watermark peak', f: 'mb0' },
      { p: 'process', l: '프로세스', f: 'raw' },
      { p: 'samples', l: '표본 수', f: 'int' },
    ],
  },
  {
    kind: 'pairs', section: 'memory', title: '기기 메모리', metric: 'memory', span: 4,
    unit: 'min / avg / max', path: 'metrics.memory.data.system',
    keys: [
      { p: 'mem_total_kb', l: '전체', f: 'gb1' },
      { p: 'mem_available', l: '가용', f: 'mbTriple' },
      { p: 'mem_free', l: 'free', f: 'mbTriple' },
      { p: 'cached', l: 'cached', f: 'mbTriple' },
      { p: 'swap_total_kb', l: 'swap 전체', f: 'gb1' },
      { p: 'swap_free', l: 'swap free', f: 'mbTriple' },
    ],
  },

  // ── 로그 ─────────────────────────────────────────────────────
  {
    kind: 'series', section: 'log', title: '앱 로그', metric: 'log', span: 4, unit: '건 / 초',
    path: 'metrics.log.data.app.timeline', field: 'count',
    // error 는 count 의 **부분집합**이라 같은 축에 점선으로 얹는다. 쌓지 않는다.
    subField: 'error', subLabel: 'error', sampling: 'count', fmt: 'int', baseline: 'zero',
  },
  {
    kind: 'pairs', section: 'log', title: '우선순위별', metric: 'log', span: 4,
    unit: '앱 / 기기 전체', path: 'metrics.log.data',
    keys: [
      { p: 'min_prio', l: '수집 문턱', f: 'raw' },
      { p: 'app.total', l: '앱 합계', f: 'int' },
      { p: 'app.by_priority.warn', l: '앱 warn', f: 'int' },
      { p: 'app.by_priority.error', l: '앱 error', f: 'int' },
      { p: 'app.by_priority.fatal', l: '앱 fatal', f: 'int' },
      { p: 'device_total', l: '기기 합계', f: 'int' },
      { p: 'device_by_priority.warn', l: '기기 warn', f: 'int' },
      { p: 'device_by_priority.error', l: '기기 error', f: 'int' },
    ],
  },

  // ── 맥락 ─────────────────────────────────────────────────────
  {
    kind: 'delta', section: 'context', title: '온도 (세션 전 → 후)', metric: 'thermal',
    span: 4, unit: '°C',
    path: 'metrics.thermal.data.zones',
    labelField: 'name', beforeField: 'before_c', afterField: 'after_c', fmt: 'c1',
  },
  {
    kind: 'delta', section: 'context', title: '기기 상태 (전 → 후)', span: 4, unit: '',
    beforePath: 'device.state_before', afterPath: 'device.state_after',
    keys: [
      { p: 'battery_level', l: '배터리', f: 'pct0' },
      { p: 'battery_temp_c', l: '배터리 온도', f: 'c1' },
      { p: 'charging', l: '충전', f: 'bool' },
      { p: 'mem_available_kb', l: '가용 메모리', f: 'mb0' },
      { p: 'screen_brightness', l: '밝기', f: 'int' },
      { p: 'power_save_mode', l: '절전', f: 'bool' },
      { p: 'network', l: '네트워크', f: 'raw' },
      { p: 'animator_duration_scale', l: '애니메이션 배율', f: 'raw' },
    ],
  },
  {
    kind: 'pairs', section: 'context', title: '네트워크', metric: 'network', span: 4,
    unit: 'uid 델타 · 세션 총량', path: 'metrics.network.data',
    keys: [
      { p: 'rx_bytes', l: '수신', f: 'bytes' },
      { p: 'tx_bytes', l: '송신', f: 'bytes' },
      { p: 'rx_packets', l: '수신 패킷', f: 'int' },
      { p: 'tx_packets', l: '송신 패킷', f: 'int' },
      { p: 'uid', l: 'uid', f: 'raw' },
      { p: 'shared_uid_packages', l: 'uid 공유', f: 'list' },
    ],
  },
  {
    // 경고는 **관측이지 평가가 아니다** (예: `charging_during_session`). 헤더에 알약으로
    // 늘어놓는 대신 다른 데이터와 같은 자리에 둔다 — 그래야 매니페스트 한 줄로 관리된다.
    kind: 'pairs', section: 'context', title: '경고', span: 4,
    unit: '측정 조건 관측 · 평가 아님', path: 'warnings', arrayAs: 'warnings',
  },
  {
    kind: 'pairs', section: 'context', title: '측정 비용', span: 4, unit: '',
    path: 'measurement_overhead',
    keys: [
      { p: 'tracing_processes_cpu_time_ms', l: '수집 CPU 시간', f: 'ms0' },
      { p: 'tracing_processes_cpu_share_pct', l: '수집 CPU 몫', f: 'pct2' },
      { p: 'tracing_processes_peak_rss_kb', l: '수집 RSS 최대', f: 'mb1' },
      { p: 'adb_commands_during_session', l: '세션 중 adb 명령', f: 'int' },
      { p: 'trace_buffer_overrun', l: '버퍼 넘침', f: 'bool' },
    ],
  },

  // ── 기기 · 앱 ────────────────────────────────────────────────
  {
    kind: 'pairs', section: 'device', title: '기기', span: 4, unit: '', path: 'device.static',
    keys: [
      { p: 'manufacturer', l: '제조사', f: 'raw' },
      { p: 'model', l: '모델', f: 'raw' },
      { p: 'android_release', l: 'Android', f: 'raw' },
      { p: 'sdk_int', l: 'sdk_int', f: 'int' },
      { p: 'soc_model', l: 'SoC', f: 'raw' },
      { p: 'soc_manufacturer', l: 'SoC 제조사', f: 'raw' },
      { p: 'memory_total_kb', l: '메모리', f: 'gb1' },
      { p: 'abis', l: 'ABI', f: 'list' },
      { p: 'build_fingerprint', l: 'fingerprint', f: 'wrap' },
    ],
  },
  {
    kind: 'pairs', section: 'device', title: '앱', span: 4, unit: '', path: 'target_app',
    keys: [
      { p: 'label', l: '이름', f: 'raw' },
      { p: 'package', l: '패키지', f: 'wrap' },
      { p: 'version_name', l: '버전', f: 'raw' },
      { p: 'version_code', l: 'versionCode', f: 'int' },
      { p: 'debuggable', l: 'debuggable', f: 'bool' },
      { p: 'large_heap', l: 'largeHeap', f: 'bool' },
      { p: 'min_sdk', l: 'minSdk', f: 'int' },
      { p: 'target_sdk', l: 'targetSdk', f: 'int' },
      { p: 'primary_cpu_abi', l: 'ABI', f: 'raw' },
      { p: 'uid', l: 'uid', f: 'raw' },
      { p: 'pid', l: 'pid', f: 'raw' },
      { p: 'install_source', l: '설치 경로', f: 'raw' },
      { p: 'launcher_activity', l: '진입점', f: 'wrap' },
      { p: 'render_process', l: '렌더 프로세스', f: 'wrap' },
    ],
  },
  {
    kind: 'pairs', section: 'device', title: '화면', span: 4, unit: '',
    path: 'device.static.display',
    keys: [
      { p: 'width_px', l: '가로', f: 'int' },
      { p: 'height_px', l: '세로', f: 'int' },
      { p: 'density_dpi', l: 'dpi', f: 'int' },
      { p: 'active_refresh_rate_hz', l: '주사율', f: 'hz' },
      { p: 'supported_refresh_rates_hz', l: '지원 주사율', f: 'list' },
      { p: 'orientation', l: '방향', f: 'raw' },
      { p: 'size_class', l: '크기 구간', f: 'raw' },
      { p: 'opengl_es_version', l: 'OpenGL ES', f: 'raw' },
    ],
  },
  {
    kind: 'bars', section: 'device', title: 'CPU 클러스터 최대 주파수', span: 4, unit: 'GHz',
    path: 'device.static.cpu.clusters',
    labelField: 'cpus', labelPrefix: '', valueField: 'max_freq_khz', fmt: 'ghz2', scaleMax: null,
  },
]
