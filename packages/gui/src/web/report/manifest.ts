import { COMPILE_REPORT_COPY as CC } from './compile-copy.js'
import { DIAGNOSE_REPORT_COPY as DX } from './diagnose-copy.js'
import type { Fmt } from './format.js'
import { LABEL_WORDS as LW, READABILITY_COPY as RC } from './readability-copy.js'

/**
 * **보고서의 유일한 확장 지점.**
 *
 * 지표마다 컴포넌트를 만들지 않는다. `result.json` 안의 데이터 모양은 실제로 여덟 가지뿐이고,
 * 각 지표가 여기서 **자기 모양(`kind`)과 데이터 위치(`path`)** 를 선언하면 렌더러는 모양만
 * 안다. 지표가 늘면 이 배열에 한 줄, 새 *모양*이 나올 때만 `kind` 를 하나 늘린다 (아홉째가 `dexstates`).
 *
 * 실제로 이 도구는 필드가 계속 는다 — 최근에 `cpu.device_timeline` ·
 * `memory.system_timeline` · 앱 빌드 속성 다섯이 한 번에 들어왔고, 그때 화면 코드는
 * 이 배열 말고는 고칠 것이 없어야 한다.
 */

export type BlockKind =
  | 'stat' | 'distribution' | 'series' | 'bars' | 'delta' | 'pairs' | 'frametimeline' | 'slicetable'
  | 'dexstates'

export type SectionId =
  'startup' | 'render' | 'cpu' | 'memory' | 'log' | 'context' | 'device' | 'diagnose'
export type TabId = 'summary' | 'device' | 'diagnose'
export type MetricId = 'hwui' | 'frame' | 'startup' | 'cpu' | 'memory' | 'log' | 'thermal' | 'network'

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
   * **지표가 아닌 블록의 껍데기**(`status` · `reason_code` · `reason`) 위치. `metric` 과 같은 일을 한다 —
   * 배지 · 제목 툴팁 · 값 없는 자리의 코드. 진단 블록(`diagnose`)이 메트릭과 같은 껍데기를 쓰지만
   * `metrics` 밖에 있어서다 (기능 문서 결정 5). 둘 다 주면 `metric` 이 이긴다.
   */
  statePath?: string
  /**
   * **진단 세션에만** 쓰는 카드 단위. 평소 세션은 `unit` 그대로다 — 같은 카드가 세션 종류에 따라
   * 읽는 법이 달라지는 자리(측정 비용: 진단 세션의 slice 비용은 앱 프로세스 몫이라 여기 안 잡힌다)에만.
   */
  diagnoseUnit?: string
  /**
   * `result.json` 안의 위치. **점 표기 그대로 읽는다 — 규칙으로 유추하지 않는다.**
   *
   * 같은 `timeline` 이라도 위치가 다르기 때문이다:
   * ```
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
  /**
   * 섹션이 `subTabs` 를 가질 때 이 블록이 속한 서브탭.
   *
   * **섹션에 서브탭이 있으면 필수다.** 없으면 어느 탭에도 안 그려져 조용히 사라진다 —
   * 그것을 매니페스트 테스트가 막는다.
   */
  sub?: string
  // **읽는 법 문장 칸(`note`)은 없다** (report-readability 결정 3 · RR-5). 카드 위 설명 문장을 지우고 각주
  // 단어로 바꿨다 — 각주는 뷰모델의 `footnote` 가 실제로 일어난 일(프레임 수 · 버킷 칸 수)만 적는다.
}

/**
 * 큰 숫자 아래 세우는 막대. **이 화면에서 유일하게 값을 기준선에 대는 자리다.**
 *
 * 규칙 2(판정하지 않는다)의 의도적 예외이고, 그래서 조건이 붙는다:
 *
 * 1. **경계는 우리가 정하지 않는다.** `source` 가 그 근거이고 축 라벨 툴팁으로 나간다 —
 *    구간 색이 "이 도구의 등급" 으로 읽히면 안 된다.
 * 2. **점수를 매기지 않는다.** 구간에 이름도 점수도 붙이지 않는다. 색과 위치뿐이다.
 * 3. **값이 없으면 막대도 없다.** 빈 막대를 그리면 `0ms` 로 읽힌다.
 */
export interface GaugeSpec {
  /** 막대의 오른쪽 끝. 이 값을 넘으면 꽉 찬다. */
  max: number
  /** 구간 경계(오름차순). 값이 넘긴 경계의 개수가 곧 구간 번호다. */
  bands: number[]
  /** 축 오른쪽에 적을 짧은 말. */
  axisLabel: string
  /** 경계의 출처. 툴팁으로 나간다 — 우리가 매긴 것이 아니라는 표시. */
  source: string
  /**
   * **값이 없는 것 자체가 나쁜 소식인 경우.** 여기 적힌 `reason_code` 로 값이 비었으면
   * 막대를 마지막 구간으로 꽉 채운다.
   *
   * 위 3번의 경계선이라 아무 결측에나 쓰지 않는다. `launch_wait_timed_out` 은
   * ActivityManager 가 **기다리다 포기한** 것이라 "못 쟀다" 와 "오래 걸렸다" 가 같은
   * 사건이다 — 그 자리를 비워 두면 세션 중 가장 나쁜 소식이 화면에서 가장 조용해진다.
   * 반대로 `launch_not_requested`(`--launch` 를 안 준 세션)는 나쁜 일이 아니므로 넣지 않는다.
   */
  worstWhen?: { codes: string[]; label: string }
}

export interface StatBlock extends BlockBase {
  kind: 'stat'
  path: string
  fmt: Fmt
  /**
   * 큰 숫자 아래 한 줄. `l` 라벨 · `p` 경로 · `f` 포맷.
   *
   * 이름이 `subline` 인 것은 `BlockBase.sub`(서브탭 소속)와 겹치지 않기 위해서다 — 둘 다
   * `sub` 였다면 이 값(객체 배열)이 서브탭 검사에 걸려 "값이 있으니 sub 를 가졌다" 로
   * 잘못 읽힌다.
   */
  subline?: { l: string; p: string; f: Fmt }[]
  gauge?: GaugeSpec
}

export interface DistributionBlock extends BlockBase {
  kind: 'distribution'
  path: string
  percentilesPath: string
  /**
   * 백분위 옆에 세울 비율 하나. `countPath / totalPath` 를 퍼센트로 낸다.
   *
   * **마감(8.33ms·16.67ms)을 여기 두지 않는다.** 프레임마다 마감이 다르든 세션 중에 바뀌든
   * 그 비교는 기기가 이미 프레임 단위로 끝냈고, 읽는 쪽이 알고 싶은 것은 "그래서 몇 %가
   * 걸렸나" 하나다.
   *
   * 분자·분모가 **백분위와 같은 지표**여야 한다 — 출처가 갈리면 옆에 선 숫자끼리 모집단이
   * 달라진다.
   */
  share?: { label: string; countPath: string; totalPath: string }
  /** 각주 `{frames} 프레임 · 버킷 {buckets}칸` 의 프레임 수 경로. 못 읽으면 프레임 수 토막을 뺀다 — 지어내지 않는다. */
  framesPath?: string
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
   *
   * `why` 는 **그 값 하나에 딸린 이유** 칸이다 (같은 기준의 상대 경로). 값이 `null` 이면 `값 없음`
   * 옆에 `code` 를, 문장(`reason`)은 행 툴팁으로 낸다 — stat 카드의 관례를 행 하나로 옮긴 것이다.
   * 값이 있으면 코드를 붙이지 않는다.
   *
   * 블록 `path` 가 빈 문자열이면 **문서 루트**가 기준이다 — 서로 다른 갈래의 값을 한 카드에 모을 때
   * (`artifacts.trace` · `diagnose.trace_bytes`) 라벨을 루트 경로 그대로 쓰려는 것이다.
   *
   * `w` 는 **경로 라벨의 단어 줄**이다 (report-readability RR-6 · 결정 2). 있으면 라벨이 두 줄 — 단어 한 줄 +
   * 경로(`l`) 원문 한 줄. `l` 은 그대로라 ⌘F · grep 이 `result.json` 에 닿는다. 단어의 정본은 디자인 문서
   * `## 문구` 표이고 `readability-copy.ts` 의 `LABEL_WORDS` 가 그 모음이다. 기기 원문 라벨(`TotalTime` ·
   * `Janky frames`)에는 달지 않는다 — 한 줄 그대로.
   */
  keys?: { p: string; l: string; w?: string; f: Fmt; pct?: string; why?: { code: string; reason: string } }[]
  /** 표준 key/value 로 안 떨어지는 모양. */
  /** 표준 key/value 로 안 떨어지는 모양. `list` 는 배열 하나를 그대로 줄줄이 낸다. */
  arrayAs?: 'freq' | 'list'
  /** `arrayAs: 'list'` 에서 각 항목의 어느 필드를 왼쪽/오른쪽에 쓸지. */
  listFields?: { label: string; value: string }
  /** `arrayAs: 'list'` 가 **빈 배열**일 때의 문장. 빈 배열은 "재 봤더니 없었다" 다. */
  emptyLabel?: string
}

/**
 * **프레임 하나가 막대 하나인 시간축.** 분포(`distribution`)와 축이 다르다 — 가로가 지속
 * 시간이 아니라 **경과 시각**이고, 그래서 마킹 세로선이 얹힌다.
 *
 * 이 모양은 데이터가 `[경과 ms, 앱 ms, 표시 ms, 마감 ms]` 배열의 배열이라 다른 여섯 중
 * 어느 것으로도 안 그려진다: `series` 는 초마다 값 하나를 가정하고(한 초에 프레임이 120장
 * 온다), `distribution` 은 가로가 시간이 아니다.
 */
export interface FrameTimelineBlock extends BlockBase {
  kind: 'frametimeline'
  path: string
}

/**
 * **이름 한 줄에 갈래 셋 × 수 셋인 표.** 진단 블록의 slice 이름별 표가 이 모양이다
 * (`[{name, main_thread: {count, sum_ms, max_ms} | null, other_threads, async_tracks}]`).
 *
 * `pairs` 는 열이 셋이고 정렬이 없고, `bars` 는 값이 하나다 — 이름이 수천 줄이고 읽는 쪽이 열을 골라
 * 다시 세우는 표는 다른 모양이다. **판정하지 않는다** (규칙 2): 처음 순서는 이름의 코드 단위 순이고,
 * 순위 · 강조 · 상위 N 이 없고, 행마다 색 · 굵기 · 아이콘이 같다. 순서는 보는 사람이 열 머리를
 * 누를 때만 바뀐다 (기능 문서 결정 7 · DM-13).
 */
export interface SliceTableBlock extends BlockBase {
  kind: 'slicetable'
  path: string
  /** 행 이름 필드. */
  nameField: string
  nameLabel: string
  /** 갈래 — 행 원소에서 읽을 필드와 머리. 갈래가 `null` 이면 그 이름의 slice 가 그 갈래에 없다. */
  groups: { field: string; label: string }[]
  /** 갈래 하나 안의 수 — 필드 · 머리 · 포맷. */
  stats: { field: string; label: string; fmt: Fmt }[]
  /** 카드 단위. `{n}` 자리에 행 수가 들어간다 (표가 있을 때만). */
  rowsUnit: string
}

/** 단어 줄 + 경로 줄 라벨 (RR-6) — `path` 는 화면에 찍히는 경로 원문이다 (⌘F). */
export interface WordPath {
  word: string
  path: string
}

/**
 * 때 하나 — 컴파일 카드의 `바꾸기 전` · `시작` · `끝`. 배열이 `null` 이면 그 때 행을 모든 dex 줄에서 빼고 기록 칸에
 * 한 행(`값 없음` + `code` · 문장은 행 title)으로 낸다. 경로는 문서 루트 기준 (점 표기 그대로).
 */
export interface DexTime {
  word: string
  /** 기록 칸에 찍는 경로 줄 (`compile_state_start`). */
  label: string
  path: string
  code: string
  reason: string
}

/**
 * **dex 줄마다 머리 행 + 값 행인 표** (baseline-profile BP-8 · 결정 14 · 16). 줄 하나에 칸이 여럿이고(경로 ·
 * ABI · 불 셋 · status · reason · location) 때가 셋이라 8종 어느 것으로도 안 그려진다 (`pairs` 는 값 하나 ·
 * `delta` 는 전/후 숫자 둘).
 *
 * 모양 둘이 같은 종류다 — `when` 은 요약 탭 컴파일 카드(위 기록 칸 · 때 행 · 위치 행), `slice` 는 진단 탭
 * 컴파일 상태 slice(머리 행에 `location` · `oat 파일 상태` · 값 행 칸 둘). **판정하지 않는다** (결정 6):
 * 상태 문자열은 같은 색 · 굵기 · 등폭이고 행 순서는 기기 원문 순 · 강조 · 순위 · 차이 칸 0.
 */
export interface DexStatesWhenBlock extends BlockBase {
  kind: 'dexstates'
  rows: 'when'
  /** 시작 상태 배열 — **키가 없으면 옛 파일**이라 카드째 `수집 안 함` (BP-8 · HANDOFF ①). */
  path: string
  /**
   * 바꾼 기록 객체 (`session.compile`). 있으면 `fields` 를 기록 칸에, 없으면(시작 키는 있음) `바꾸지 않음` 한 행
   * (결정 15 · 배지 밖). 경로 줄은 `field` 의 이름이다.
   */
  record: { path: string; fields: { field: string; word: string; fmt: Fmt; mono?: true }[]; none: WordPath & { value: string } }
  /**
   * 때 순서 — 줄 맞춤의 훑는 순서이고 때 행 순서다. `onlyIf` 가 있으면 그 경로가 객체일 때만 그 때가 있다
   * (`바꾸기 전` 은 `--compile` 세션에만).
   */
  times: (DexTime & { onlyIf?: string })[]
  /** 표 머리 — 때 · 컴파일 필터 · 컴파일 이유 · 위치 행 라벨. */
  cols: { when: string; status: WordPath; reason: WordPath; location: WordPath }
  /** 머리 행 2 — 필드 이름 그대로 넷. */
  lineFields: { field: string; fmt: Fmt }[]
  lineMissing: string
}

export interface DexStatesSliceBlock extends BlockBase {
  kind: 'dexstates'
  rows: 'slice'
  path: string
  /** 배열이 `null` 인 이유 짝 (문서 루트 기준) — 블록 껍데기가 아니라 이 칸의 것 (BP-7 · `dalvik_not_recorded`). */
  why: { code: string; reason: string }
  /** 머리 행 2 — `status`(oat 파일 상태 · 결정 14). */
  headField: WordPath
  cols: { filter: WordPath; reason: WordPath }
  /** `[]` — 재 봤더니 0개. */
  emptyLabel: string
}

export type DexStatesBlock = DexStatesWhenBlock | DexStatesSliceBlock

export type Block =
  | StatBlock | DistributionBlock | SeriesBlock | BarsBlock | DeltaBlock | PairsBlock
  | FrameTimelineBlock | SliceTableBlock | DexStatesBlock

/**
 * 보고서 섹션 순서. 요약 탭 맨 위 `지표` 섹션(타일 8)은 블록이 아니라 여기 없다 — 아래 `TILES` · `ReportPage`.
 * 섹션에 읽는 법 문장을 두지 않는다 (report-readability 결정 3).
 */
export const SECTIONS: {
  id: SectionId
  label: string
  tab: TabId
  /** 이 섹션이 서브탭으로 나뉘어 있으면 여기 적는다. 없으면 섹션은 서브탭 없이 하나다. */
  subTabs?: { id: string; label: string }[]
}[] = [
  { id: 'startup', label: '앱 시작', tab: 'summary' },
  {
    id: 'render',
    label: '렌더',
    tab: 'summary',
    subTabs: [
      { id: 'distribution', label: '분포' },
      { id: 'timeline', label: '타임라인' },
    ],
  },
  { id: 'cpu', label: 'CPU', tab: 'summary' },
  { id: 'memory', label: '메모리', tab: 'summary' },
  { id: 'log', label: '로그', tab: 'summary' },
  { id: 'context', label: '맥락', tab: 'summary' },
  { id: 'device', label: '기기 · 앱', tab: 'device' },
  { id: 'diagnose', label: DX.section, tab: 'diagnose' },
]

/**
 * 레일의 탭. **`diagnose` 는 진단 세션에만 나온다** (`header.ts` 의 `tabsFor`) — 평소 보고서는 탭이
 * 둘 그대로다. 진단 여부의 기준은 `session.options.diagnose === true` 하나다.
 */
export const TABS: { id: TabId; label: string; onlyDiagnose?: true }[] = [
  { id: 'summary', label: '요약' },
  { id: 'device', label: '기기' },
  { id: 'diagnose', label: DX.tab, onlyDiagnose: true },
]

export const KNOWN_METRICS: MetricId[] =
  ['hwui', 'frame', 'startup', 'cpu', 'memory', 'log', 'thermal', 'network']

/**
 * **일부러 안 그리는 지표.** 푸터의 "무시한 지표" 에서 뺀다.
 *
 * 그 경고는 *몰라서* 안 그린 것을 잡으려고 있다 — 새 지표가 생겼는데 아무도 매니페스트에
 * 안 넣은 상황. 여기 적힌 것은 이유가 있어 뺀 것이라 매번 경고를 띄우면 진짜 신호가 묻힌다.
 *
 * **지금은 비어 있다.** 한동안 `frame` 이 여기 있었는데 — 화면엔 없고 `result.json` 에만
 * 남아서 **사람은 보고서를, LLM 은 파일을 보며 다른 숫자를 들게 됐다.** 그래서 수집을
 * 아예 접었다. 여기에 무언가를 넣기 전에 그 비대칭을 감당할 수 있는지 먼저 볼 것.
 */
export const NOT_DRAWN_METRICS: MetricId[] = []

/** 이 화면이 해석할 줄 아는 스키마 메이저. 다르면 헤더가 먼저 말한다. */
export const SCHEMA_MAJOR = 1

export const MANIFEST: Block[] = [
  // ── 앱 시작 ──────────────────────────────────────────────────
  //
  // 요약 타일은 맨 위 `지표` 섹션으로 돌아왔다 (`TILES` · report-readability RR-4). 같은 값을 두 번 크게
  // 쓰지 않으므로 이 카드는 **큰 숫자 없이** 게이지와 아래 줄만 그린다 (결정 10) — 숫자는 타일과
  // `측정값` 카드의 TotalTime 행에 있다. 값이 없으면 `값 없음` · `수집 안 함` 을 본문 크기로 낸다.
  {
    kind: 'stat', section: 'startup', title: '앱 시작', metric: 'startup', span: 3,
    path: 'metrics.startup.data.total_time_ms', fmt: 'int', unit: 'ms',
    // 경계는 구글이 정한 것이고 우리는 옮겨 적기만 한다 — `references` 의
    // `excessive cold startup time`(5,000ms)이 마지막 경계다.
    gauge: {
      max: 5000,
      bands: [1000, 2000, 3000, 4000, 5000],
      axisLabel: '기준 5,000ms',
      source: 'Android Vitals — app startup time (콜드 5초)',
      worstWhen: { codes: ['launch_wait_timed_out'], label: '타임아웃' },
    },
    subline: [
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
      { p: 'pid', l: 'pid', w: LW.pid, f: 'raw' },
    ],
  },

  // ── 렌더 ─────────────────────────────────────────────────────
  {
    // **Vitals 가 보는 그 값이다** — UI 스레드 + RenderThread 의 CPU 시간, View 계층만.
    //
    // **렌더는 이 한 경로뿐이다.** 트레이스로도 같은 것을 재던 시절이 있었는데, 화면이
    // 하나만 그리게 되자 나머지가 `result.json` 에만 남아 사람과 LLM 이 다른 숫자를 봤다.
    // 버전 하한이 없어서 sdk 30 처럼 트레이스가 없는 기기에서도 이 카드는 그려진다.
    kind: 'distribution', section: 'render', title: '프레임 시간 분포',
    metric: 'hwui', unit: 'ms', span: 12, tone: 'alt', sub: 'distribution',
    // 읽는 법 문장(평가 낱말 `부드럽`)이 있던 자리 — 각주 단어 `{frames} 프레임 · 버킷 {buckets}칸` 으로 (RR-5).
    path: 'metrics.hwui.data.histogram',
    framesPath: 'metrics.hwui.data.total_frames',
    percentilesPath: 'metrics.hwui.data.percentiles',
    share: {
      label: 'jank',
      countPath: 'metrics.hwui.data.janky_frames',
      totalPath: 'metrics.hwui.data.total_frames',
    },
    breakAfterEmptyBuckets: Infinity,
  },
  {
    // **라벨은 `dumpsys gfxinfo` 의 줄 이름 그대로다 — 번역하지 않는다.** 옮기는 순간
    // 원문과 대조할 수 없고("그리기 명령" 을 gfxinfo 에서 grep 할 수 없다), 옮긴 말이
    // 원문보다 정확할 수도 없다. 기기가 영어로 준 것은 영어로 싣는다.
    kind: 'pairs', section: 'render', title: '프레임 수', metric: 'hwui', span: 6,
    unit: 'dumpsys gfxinfo', tone: 'alt', sub: 'distribution', path: 'metrics.hwui.data',
    keys: [
      { p: 'total_frames', l: 'Total frames rendered', f: 'int' },
      { p: 'janky_frames', l: 'Janky frames', f: 'int', pct: 'total_frames' },
      { p: 'deadline_missed', l: 'Frame deadline missed', f: 'int', pct: 'total_frames' },
    ],
  },
  {
    // **프레임 수가 아니다.** 한 프레임이 여러 항목에 잡히고, 실측에서 High input latency 가
    // 전체 프레임 수를 넘었다 (2,759 대 1,682 · 8,503 대 7,514 · 33 대 26). 그래서 이 카드에는
    // `pct` 를 달지 않는다 — 분모가 없는 값에 비율을 붙이면 100% 넘는 숫자가 나온다.
    kind: 'pairs', section: 'render', title: '원인별 횟수', metric: 'hwui', span: 6,
    unit: 'dumpsys gfxinfo', tone: 'alt', sub: 'distribution', path: 'metrics.hwui.data',
    keys: [
      { p: 'slow_ui_thread', l: 'Slow UI thread', f: 'int' },
      { p: 'slow_draw_commands', l: 'Slow issue draw commands', f: 'int' },
      { p: 'slow_bitmap_uploads', l: 'Slow bitmap uploads', f: 'int' },
      { p: 'missed_vsync', l: 'Missed Vsync', f: 'int' },
      { p: 'high_input_latency', l: 'High input latency', f: 'int' },
    ],
  },

  {
    // **`hwui` 와 같은 것을 두 번 말하지 않는다.** 이쪽은 개수도 백분위도 없고 "언제" 만
    // 답한다 — 그래서 같은 이름의 숫자가 두 벌이 되지 않는다.
    //
    // sdk 31 하한이 있는 유일한 렌더 카드다. 그 미만 기기에서는 카드가 남고 배지가
    // `기기 미지원` · `sdk_too_low` 를 말한다 — 사라지면 "원래 안 재는 것" 으로 읽힌다.
    kind: 'frametimeline', section: 'render', title: '시간별 프레임', metric: 'frame',
    span: 12, unit: 'ms · perfetto frametimeline', sub: 'timeline',
    // 읽는 법 두 문장이 있던 자리 — 각주 단어로 (RR-5 · 뷰모델 `footnote`).
    path: 'metrics.frame.data',
  },

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
      // 요약 타일 `앱 RSS 최대` 와 같은 값 · 같은 문자열 (RR-4 · 디자인 결정 1) — 이 행이 없으면 타일 값이
      // 화면 어느 카드에도 없다.
      { p: 'rss.max_kb', l: 'rss.max_kb', w: LW['rss.max_kb'], f: 'mb0' },
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
    // 제목이 "우선순위별" 이었다. 무엇의 우선순위인지도, 앱 것인지 기기 것인지도 그 말로는
    // 알 수 없다. **경로 줄은 스키마 필드 경로 그대로다** — `result.json` 에서 그대로 찾을 수
    // 있어야 한다. 우리말 단어는 그 위 한 줄로 더할 뿐 경로를 바꾸지 않는다 (RR-6 · 결정 2).
    kind: 'pairs', section: 'log', title: 'logcat 줄 수', metric: 'log', span: 4,
    unit: 'metrics.log.data', path: 'metrics.log.data',
    keys: [
      { p: 'min_prio', l: 'min_prio', w: LW.min_prio, f: 'raw' },
      { p: 'app.total', l: 'app.total', w: LW['app.total'], f: 'int' },
      { p: 'app.by_priority.warn', l: 'app.by_priority.warn', w: LW['app.by_priority.warn'], f: 'int' },
      { p: 'app.by_priority.error', l: 'app.by_priority.error', w: LW['app.by_priority.error'], f: 'int' },
      { p: 'app.by_priority.fatal', l: 'app.by_priority.fatal', w: LW['app.by_priority.fatal'], f: 'int' },
      { p: 'device_total', l: 'device_total', w: LW.device_total, f: 'int' },
      { p: 'device_by_priority.warn', l: 'device_by_priority.warn', w: LW['device_by_priority.warn'], f: 'int' },
      { p: 'device_by_priority.error', l: 'device_by_priority.error', w: LW['device_by_priority.error'], f: 'int' },
    ],
  },
  {
    // **기기 전역이며 대상 앱으로 거르지 않는다 — 그것이 의도다.** 앱이 죽은 뒤 다른
    // 프로세스가 남긴 줄이 사라지기 때문이고, ANR 은 애초에 system_server 가 찍는다
    // (앱 pid 로 걸렀다면 하나도 안 남는다 — 스키마의 실측 근거 참고).
    //
    // `[]`(재 봤더니 없었다)와 `null`(로그를 못 받아 모른다)이 다른 문장이 되어야 한다.
    // sdk 30 처럼 logdr 접근이 막힌 기기에서는 후자이고, 그때 "크래시 없음" 이라고 하면
    // 없던 사실을 만드는 것이다.
    kind: 'pairs', section: 'log', title: '크래시', metric: 'log', span: 2,
    unit: 'logcat · 기기 전역', path: 'metrics.log.data.device_crashes', arrayAs: 'list',
    listFields: { label: 'tag', value: 'message' }, emptyLabel: '크래시 없음',
  },
  {
    kind: 'pairs', section: 'log', title: 'ANR', metric: 'log', span: 2,
    unit: 'logcat · 기기 전역', path: 'metrics.log.data.device_anrs', arrayAs: 'list',
    listFields: { label: 'tag', value: 'message' }, emptyLabel: 'ANR 없음',
  },

  // ── 맥락 ─────────────────────────────────────────────────────
  {
    kind: 'delta', section: 'context', title: '온도 (세션 전 → 후)', metric: 'thermal',
    span: 4, unit: '°C',
    path: 'metrics.thermal.data.zones',
    labelField: 'name', beforeField: 'before_c', afterField: 'after_c', fmt: 'c1',
  },
  {
    // **온도와 다른 축이다.** 섭씨는 센서가 몇 도인지고, 이쪽은 기기가 그 열 때문에 성능을
    // 실제로 깎고 있었는지다 — 2 이상이면 그 세션의 CPU·프레임 숫자를 "이 앱이 느리다" 로
    // 읽으면 안 된다. 이름은 AOSP 의 `THERMAL_STATUS_*` 그대로이고 우리가 매긴 등급이 아니다.
    //
    // **`hal_ready` 와 `status_override` 는 여기 두지 않는다.** 안드로이드 문서가 "NONE 이
    // 계속 나오는 것이 스로틀이 없다는 뜻은 아니다 — 그 기기가 지원하지 않는 것일 수 있다"
    // 고 말하고 그 둘이 그것을 가르는 재료이긴 하지만, **평소엔 아무 뜻이 없고 이상할 때만
    // 뜻이 생기는 값**이다. 늘 `예/아니오` 로 고정된 두 줄은 읽는 사람에게 할 일을 주지
    // 않는다 — 그런 것은 카드가 아니라 경고 자리다. 값은 `result.json` 에 그대로 있다.
    kind: 'pairs', section: 'context', title: '스로틀 단계', metric: 'thermal', span: 4,
    unit: 'dumpsys thermalservice', path: 'metrics.thermal.data',
    keys: [
      // 같은 섹션의 온도·기기 상태 카드가 `전 → 후` 로 말한다. 여기만 스키마 경로를 쓰면
      // 읽는 사람이 두 어휘를 오간다 — 두 줄뿐이라 경로가 없어도 모호하지 않다.
      { p: 'device_status_before', l: '시작', f: 'thermal' },
      { p: 'device_status_after', l: '종료', f: 'thermal' },
    ],
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
      { p: 'uid', l: 'uid', w: LW.uid, f: 'raw' },
      { p: 'shared_uid_packages', l: 'uid 공유', f: 'list' },
    ],
  },
  {
    // 경고는 **관측이지 평가가 아니다** (예: `charging_during_session`). 헤더에 알약으로
    // 늘어놓는 대신 다른 데이터와 같은 자리에 둔다 — 그래야 매니페스트 한 줄로 관리된다.
    kind: 'pairs', section: 'context', title: '경고', span: 4,
    unit: '측정 조건 관측 · 평가 아님', path: 'warnings', arrayAs: 'list',
    listFields: { label: 'code', value: 'message' }, emptyLabel: '경고 없음',
  },
  {
    // **진단 세션에서는 읽는 법이 달라진다.** atrace slice 를 남기는 비용은 앱 프로세스 자신의
    // 몫이라 이 다섯 칸(트레이싱 프로세스만 센다)에 안 잡힌다 — 그 사실을 단위 칸에 둔다 (DM-13 ·
    // DM-14). 평소 세션에는 붙지 않는다: 붙이면 없는 비용을 있는 것처럼 말한다.
    kind: 'pairs', section: 'context', title: '측정 비용', span: 4, unit: '',
    diagnoseUnit: DX.overheadUnit,
    path: 'measurement_overhead',
    keys: [
      { p: 'tracing_processes_cpu_time_ms', l: '수집 CPU 시간', f: 'ms0' },
      { p: 'tracing_processes_cpu_share_pct', l: '수집 CPU 몫', f: 'pct2' },
      { p: 'tracing_processes_peak_rss_kb', l: '수집 RSS 최대', f: 'mb1' },
      { p: 'adb_commands_during_session', l: '세션 중 adb 명령', f: 'int' },
      { p: 'trace_buffer_overrun', l: '버퍼 넘침', f: 'bool' },
    ],
  },
  {
    // **측정 조건이라 맥락 끝 · 전폭 · 지표 아님** (baseline-profile 결정 16 — 요약 타일에 없다). 위는 기록 칸(바꾼
    // 기록 · 못 읽은 때), 아래는 dex 줄마다 머리 행 둘 + 때 행 + 위치 행. 상태 문자열을 칠하지 않고 바뀐 칸을
    // 가르지 않는다 — 바뀐 사실은 경고 카드의 `compile_state_changed` 행이 말한다 (BP-3).
    kind: 'dexstates', rows: 'when', section: 'context', title: CC.cardApp, span: 12, unit: '',
    path: 'target_app.compile_state_start',
    record: {
      path: 'session.compile',
      fields: [
        { field: 'value', word: CC.recValue, fmt: 'raw', mono: true },
        { field: 'command', word: CC.recCommand, fmt: 'wrap', mono: true },
        { field: 'elapsed_ms', word: CC.recElapsed, fmt: 'ms0' },
      ],
      none: { word: CC.recNone, path: 'session.compile', value: CC.notChanged },
    },
    times: [
      {
        word: CC.whenBefore, label: 'compile_state_before', onlyIf: 'session.compile',
        path: 'session.compile.compile_state_before',
        code: 'session.compile.compile_state_before_reason_code',
        reason: 'session.compile.compile_state_before_reason',
      },
      {
        word: CC.whenStart, label: 'compile_state_start', path: 'target_app.compile_state_start',
        code: 'target_app.compile_state_start_reason_code', reason: 'target_app.compile_state_start_reason',
      },
      {
        word: CC.whenEnd, label: 'compile_state_end', path: 'target_app.compile_state_end',
        code: 'target_app.compile_state_end_reason_code', reason: 'target_app.compile_state_end_reason',
      },
    ],
    cols: {
      when: CC.colWhen,
      status: { word: CC.colFilter, path: 'status' },
      reason: { word: CC.colReason, path: 'reason' },
      location: { word: CC.colLocation, path: 'location' },
    },
    lineFields: [
      { field: CC.fieldAbi, fmt: 'raw' },
      { field: CC.fieldPrimaryAbi, fmt: 'bool' },
      { field: CC.fieldSecondaryDex, fmt: 'bool' },
      { field: CC.fieldPublicDex, fmt: 'bool' },
    ],
    lineMissing: CC.lineMissing,
  },

  // ── 기기 · 앱 ────────────────────────────────────────────────
  {
    kind: 'pairs', section: 'device', title: '기기', span: 4, unit: '', path: 'device.static',
    keys: [
      { p: 'manufacturer', l: '제조사', f: 'raw' },
      { p: 'model', l: '모델', f: 'raw' },
      { p: 'android_release', l: 'Android', f: 'raw' },
      { p: 'sdk_int', l: 'sdk_int', w: LW.sdk_int, f: 'int' },
      { p: 'soc_model', l: 'SoC', f: 'raw' },
      { p: 'soc_manufacturer', l: 'SoC 제조사', f: 'raw' },
      { p: 'memory_total_kb', l: '메모리', f: 'gb1' },
      { p: 'abis', l: 'ABI', f: 'list' },
      { p: 'build_fingerprint', l: 'fingerprint', w: LW.fingerprint, f: 'wrap' },
    ],
  },
  {
    kind: 'pairs', section: 'device', title: '앱', span: 4, unit: '', path: 'target_app',
    keys: [
      { p: 'label', l: '이름', f: 'raw' },
      { p: 'package', l: '패키지', f: 'wrap' },
      { p: 'version_name', l: '버전', f: 'raw' },
      { p: 'version_code', l: 'versionCode', w: LW.versionCode, f: 'int' },
      { p: 'debuggable', l: 'debuggable', w: LW.debuggable, f: 'bool' },
      { p: 'large_heap', l: 'largeHeap', w: LW.largeHeap, f: 'bool' },
      { p: 'min_sdk', l: 'minSdk', w: LW.minSdk, f: 'int' },
      { p: 'target_sdk', l: 'targetSdk', w: LW.targetSdk, f: 'int' },
      { p: 'primary_cpu_abi', l: 'ABI', f: 'raw' },
      { p: 'uid', l: 'uid', w: LW.uid, f: 'raw' },
      { p: 'pid', l: 'pid', w: LW.pid, f: 'raw' },
      { p: 'install_source', l: '설치 경로', f: 'raw' },
      { p: 'launcher_activity', l: '진입점', f: 'wrap' },
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

  // ── 진단 (진단 세션에만 — 탭째로) ────────────────────────────
  //
  // 경로 줄은 **스키마 필드 경로 그대로**다 (logcat 카드와 같은 이유 — `result.json` 에서 그대로 찾을 수
  // 있어야 한다) · 그 위에 우리말 단어 줄 (RR-6). 이름의 정본은 README 「`diagnose`」. 카드 단위 칸은
  // 비운다 — `diagnose` 는 뜻 없는 글자였다 (RR-6). 블록 껍데기(`status` · `reason`)는 다섯 카드가
  // 다 끌어온다 — 배지와 제목 툴팁. 블록 `status` 는 **트레이스에서 읽은 칸**의 상태이고, 앱 slice
  // 열림은 그와 따로 가므로(README) 자기 행에 자기 이유를 단다.
  {
    kind: 'pairs', section: 'diagnose', title: DX.cardScope, span: 4, unit: '',
    statePath: 'diagnose', path: 'diagnose',
    keys: [
      { p: 'atrace_categories', l: 'atrace_categories', w: LW.atrace_categories, f: 'dots' },
      { p: 'atrace_apps', l: 'atrace_apps', w: LW.atrace_apps, f: 'dots' },
      {
        p: 'app_slices_open', l: 'app_slices_open', w: LW.app_slices_open, f: 'bool',
        why: { code: 'app_slices_open_reason_code', reason: 'app_slices_open_reason' },
      },
    ],
  },
  {
    kind: 'pairs', section: 'diagnose', title: DX.cardCounts, span: 4, unit: '',
    statePath: 'diagnose', path: 'diagnose',
    keys: [
      { p: 'trace_slices', l: 'trace_slices', w: LW.trace_slices, f: 'int' },
      { p: 'target_process_slices', l: 'target_process_slices', w: LW.target_process_slices, f: 'int' },
      { p: 'target_process_slices_unfinished', l: 'target_process_slices_unfinished', w: LW.target_process_slices_unfinished, f: 'int' },
      { p: 'target_process_slice_names_unfolded', l: 'target_process_slice_names_unfolded', w: LW.target_process_slice_names_unfolded, f: 'int' },
      { p: 'ftrace_overrun_events', l: 'ftrace_overrun_events', w: LW.ftrace_overrun_events, f: 'int' },
      // JIT 컴파일 slice 수 (BP-7) — 블록 status 와 따로 가는 이유를 행에 단다 (열림 행과 같은 꼴). 컴파일 상태
      // slice 는 칸이 넷이라 아래 `컴파일 상태 slice` 카드(dexstates)가 그린다.
      {
        p: 'target_process_jit_slices', l: 'target_process_jit_slices', w: CC.jitWord, f: 'int',
        why: { code: 'target_process_jit_slices_reason_code', reason: 'target_process_jit_slices_reason' },
      },
    ],
  },
  {
    // 원본은 진단 블록 밖(`artifacts.trace`)에 있다 — 그래서 이 카드만 루트 기준 경로로 적는다.
    // 더 깊이 보려면 이 파일을 Perfetto UI 로 연다 (시간축 그림은 이 화면에 없다 · 결정 6).
    kind: 'pairs', section: 'diagnose', title: DX.cardSource, span: 4, unit: '',
    statePath: 'diagnose', path: '',
    keys: [
      { p: 'artifacts.trace', l: 'artifacts.trace', w: LW['artifacts.trace'], f: 'path' },
      { p: 'diagnose.trace_bytes', l: 'diagnose.trace_bytes', w: LW['diagnose.trace_bytes'], f: 'bytes' },
    ],
  },
  {
    // 컴파일 상태 slice (BP-7 · BP-8) — `slice 이름별` 표 위 · 전폭. 머리 행 1 = `location` 원문 · 머리 행 2 =
    // `oat 파일 상태`/`status` (결정 14 — 이 `status` 는 oat 파일 상태 · 컴파일 필터는 `filter`) · 값 행 칸 둘.
    // `null` 이면 그 칸의 이유 짝(블록 껍데기가 아니다 — dalvik 안 켠 원본은 블록이 collected 다).
    kind: 'dexstates', rows: 'slice', section: 'diagnose', title: CC.cardSlices, span: 12, unit: '',
    statePath: 'diagnose', path: 'diagnose.target_process_compile_state_slices',
    why: {
      code: 'diagnose.target_process_compile_state_slices_reason_code',
      reason: 'diagnose.target_process_compile_state_slices_reason',
    },
    headField: { word: CC.colOatStatus, path: 'status' },
    cols: {
      filter: { word: CC.colFilter, path: 'filter' },
      reason: { word: CC.colReason, path: 'reason' },
    },
    emptyLabel: CC.slicesEmpty,
  },
  {
    kind: 'slicetable', section: 'diagnose', title: DX.cardNames, span: 12,
    statePath: 'diagnose', path: 'diagnose.target_process_slice_names',
    rowsUnit: DX.tableUnit,
    nameField: 'name', nameLabel: DX.colName,
    groups: [
      { field: 'main_thread', label: DX.groupMain },
      { field: 'other_threads', label: DX.groupOther },
      { field: 'async_tracks', label: DX.groupAsync },
    ],
    stats: [
      { field: 'count', label: DX.colCount, fmt: 'int' },
      { field: 'sum_ms', label: DX.colSum, fmt: 'n1' },
      { field: 'max_ms', label: DX.colMax, fmt: 'n1' },
    ],
  },
]

/**
 * **요약 타일 — 들어가는 자리** (report-readability RR-4 · 결정 9 · 10 · 12).
 *
 * 지표마다 하나 · 보고서 섹션 순 · **값이 바뀌어도 순서와 수가 그대로**다 (결정 1 — 위계는 값이 아니라 종류로).
 * 값으로 고르거나 칠하지 않는다: 색 · 굵기 · 아이콘이 값에 따라 바뀌는 칸이 없고, `references` 를 안 쓴다.
 *
 * 타일 값은 **아래 카드의 같은 값과 같은 문자열**이다 — 경로 · 포맷을 그 카드 행과 똑같이 적고 시험이 대조한다
 * (`RR-4 타일 값 = 카드 값`). `frame` 만 예외다: 개수 · 백분위가 없는 지표라 **수집 상태**(`status` 원문)를 낸다 —
 * `frames_seen` 을 `hwui` 프레임 수 옆에 세우면 README 가 막은 비교를 화면이 부른다.
 *
 * 타일은 블록이 아니다 — `MANIFEST` 밖이라 레일 배지에 세지 않는다 (같은 값의 카드가 이미 센다 · 결정 12).
 * `unit` 은 카드 값에 단위가 없는 둘(`장` · `줄`)에만 — 나머지는 포맷이 단위를 붙인다(`ms` · `MB`).
 */
export interface TileSpec {
  metric: MetricId
  word: string
  path: string
  fmt: Fmt
  unit?: string
}

export const TILES: TileSpec[] = [
  { metric: 'startup', word: RC.tileStartup, path: 'metrics.startup.data.total_time_ms', fmt: 'ms0' },
  { metric: 'hwui', word: RC.tileHwui, path: 'metrics.hwui.data.total_frames', fmt: 'int', unit: RC.unitFrames },
  { metric: 'frame', word: RC.tileFrame, path: 'metrics.frame.status', fmt: 'raw' },
  { metric: 'cpu', word: RC.tileCpu, path: 'metrics.cpu.data.app.total_ms', fmt: 'ms0' },
  { metric: 'memory', word: RC.tileMemory, path: 'metrics.memory.data.rss.max_kb', fmt: 'mb0' },
  { metric: 'log', word: RC.tileLog, path: 'metrics.log.data.app.total', fmt: 'int', unit: RC.unitLines },
  { metric: 'thermal', word: RC.tileThermal, path: 'metrics.thermal.data.device_status_after', fmt: 'thermal' },
  { metric: 'network', word: RC.tileNetwork, path: 'metrics.network.data.rx_bytes', fmt: 'bytes' },
]
