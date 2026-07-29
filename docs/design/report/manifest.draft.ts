/**
 * **매니페스트 초안.** 실제 코드가 아니라 계약을 눈으로 보라고 둔 파일이다.
 *
 * 요점은 하나: **지표가 자기 모양(kind)과 데이터 위치(path)를 선언하고, 렌더러는 모양만 안다.**
 * 새 지표가 생기면 여기 한 줄이 늘 뿐 새 컴포넌트를 쓰지 않는다.
 *
 * 타입 이름·구조는 자유롭게 바꿔도 된다. 바꾸면 안 되는 것은 `CONTRACT.md` 의 규칙 넷이다.
 *
 * **`samples/low-end.json` 으로 먼저 돌려 볼 것.** 그 세션은 `frame` 과 `network` 가 통째로
 * 없고(`status: unsupported`) `cpu.data.app` 이 `null` 이다 — 아래 매니페스트의 절반이
 * "값 없음" 으로 떨어진다. 그 상태가 정상적으로 그려지면 나머지는 쉽다.
 */

export type BlockKind = 'distribution' | 'series' | 'bars' | 'delta' | 'pairs' | 'stat'

export interface BlockBase {
  kind: BlockKind
  title: string
  /** 같은 섹션끼리 묶인다. 섹션 이름 자체는 화면이 정한다. */
  section: 'summary' | 'render' | 'cpu' | 'memory' | 'log' | 'context' | 'device'
  /**
   * `result.json` 안의 위치. **점 표기 그대로 읽는다 — 규칙으로 유추하지 않는다.**
   * 경로가 없거나 `null` 이면 블록은 사라지지 않고 "수집 안 함" 으로 남는다.
   */
  path: string
  /**
   * 이 블록이 어느 지표에 속하는지. 렌더러가 `metrics[metric].status` 와 `reason` 을
   * 같이 띄우려면 필요하다. 지표에 속하지 않는 블록(기기 정보 등)은 생략.
   */
  metric?: 'frame' | 'startup' | 'cpu' | 'memory' | 'log' | 'thermal' | 'network'
  unit?: string
}

/** 히스토그램. **이 프로젝트에서 막대는 여기 하나뿐이다.** */
export interface DistributionBlock extends BlockBase {
  kind: 'distribution'
  /** 백분위 점선을 얹을 위치. 이미 데이터에 있는 값이라 계산이 아니다. */
  percentilesPath?: string
  /**
   * 빈 버킷이 이만큼 이어지면 축을 끊는다. **끊었다는 사실을 화면에 적어야 한다** —
   * 조용히 줄이면 166ms 짜리 한 프레임이 70ms 옆에 붙는다.
   */
  breakAfterEmptyBuckets: number
}

/** 시계열. **선이다.** `null` 인 초에서 끊는다. */
export interface SeriesBlock extends BlockBase {
  kind: 'series'
  /** 배열 원소에서 읽을 값 필드. */
  field: string
  /** 같은 축에 얹을 두 번째 선 (부분집합일 때만 — 쌓지 않는다). */
  subField?: string
  /** 단위 변환. 매니페스트에 명시한다 — 렌더러가 추측하지 않는다. */
  transform?: (v: number) => number
  /**
   * 첫 초가 배열에 없는 것이 정상인가.
   * 누적 카운터(cumulative)는 델타를 못 내서 첫 초가 없고, 순간값(gauge)은 있다.
   * 화면이 "왜 여기가 비었지" 를 설명할 수 있어야 하므로 선언한다.
   */
  sampling: 'cumulative' | 'gauge' | 'count'
}

export const REPORT_MANIFEST: BlockBase[] = [
  // ── 요약 타일 ────────────────────────────────────────────────
  { kind: 'stat', section: 'summary', title: '프레임', path: 'metrics.frame.data.total_frames', metric: 'frame', unit: '개' },
  { kind: 'stat', section: 'summary', title: '앱 CPU', path: 'metrics.cpu.data.app.total_ms', metric: 'cpu', unit: 'ms' },
  { kind: 'stat', section: 'summary', title: '앱 RSS 최대', path: 'metrics.memory.data.rss.max_kb', metric: 'memory', unit: 'kB' },
  { kind: 'stat', section: 'summary', title: '다운로드', path: 'metrics.network.data.rx_bytes', metric: 'network', unit: 'bytes' },
  { kind: 'stat', section: 'summary', title: '시작', path: 'metrics.startup.data.total_time_ms', metric: 'startup', unit: 'ms' },
  { kind: 'stat', section: 'summary', title: '경고 · 에러', path: 'metrics.log.data.app.total', metric: 'log', unit: '건' },

  // ── 렌더: 이 프로젝트의 유일한 막대 ───────────────────────────
  {
    kind: 'distribution', section: 'render', title: '프레임 지속 시간 분포',
    path: 'metrics.frame.data.buckets', metric: 'frame', unit: 'ms',
    percentilesPath: 'metrics.frame.data.percentiles',
    breakAfterEmptyBuckets: 5,
  } as DistributionBlock,

  // ── 시계열: 전부 선. path 가 지표마다 다르다는 것이 요점 ────────
  {
    kind: 'series', section: 'cpu', title: '앱 CPU', unit: '% (1코어 = 100%)',
    path: 'metrics.cpu.data.app.timeline', field: 'app_cpu_ms', metric: 'cpu',
    sampling: 'cumulative', transform: (ms) => ms / 10,
  } as SeriesBlock,
  {
    kind: 'series', section: 'cpu', title: '기기 CPU', unit: '% (전 코어 = 100%)',
    path: 'metrics.cpu.data.device_timeline', field: 'busy_pct', metric: 'cpu',
    sampling: 'cumulative',
  } as SeriesBlock,
  {
    kind: 'series', section: 'memory', title: '앱 RSS', unit: 'MB',
    path: 'metrics.memory.data.timeline', field: 'rss_kb', metric: 'memory',
    sampling: 'gauge', transform: (kb) => kb / 1024,
  } as SeriesBlock,
  {
    kind: 'series', section: 'memory', title: '기기 가용 메모리', unit: 'MB',
    path: 'metrics.memory.data.system_timeline', field: 'mem_available_kb', metric: 'memory',
    sampling: 'gauge', transform: (kb) => kb / 1024,
  } as SeriesBlock,
  {
    kind: 'series', section: 'log', title: '경고 · 에러', unit: '건 / 초',
    path: 'metrics.log.data.app.timeline', field: 'count', subField: 'error', metric: 'log',
    sampling: 'count',
  } as SeriesBlock,

  // ── 나머지 모양들 ────────────────────────────────────────────
  { kind: 'bars', section: 'cpu', title: '기기 코어별 사용률', path: 'metrics.cpu.data.device_per_core', metric: 'cpu', unit: '%' },
  { kind: 'delta', section: 'context', title: '온도 (세션 전 → 후)', path: 'metrics.thermal.data.zones', metric: 'thermal', unit: '°C' },
  { kind: 'pairs', section: 'memory', title: '앱 RSS 구성', path: 'metrics.memory.data', metric: 'memory' },
  { kind: 'pairs', section: 'device', title: '기기', path: 'device.static' },
  { kind: 'pairs', section: 'device', title: '앱', path: 'target_app' },
  { kind: 'pairs', section: 'device', title: '화면', path: 'device.static.display' },
  { kind: 'delta', section: 'device', title: '기기 상태 (전 → 후)', path: 'device' },
  { kind: 'pairs', section: 'device', title: '도구 · 호스트', path: 'tool' },
  { kind: 'pairs', section: 'context', title: '측정 자신의 비용', path: 'measurement_overhead' },
]
