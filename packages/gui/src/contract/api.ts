/**
 * GUI 서버와 웹이 공유하는 **유일한** 계약.
 *
 * 이 파일은 `@perftracker/core` 를 import 하지 않는다. core 의 타입을 그대로 흘리면
 * 웹이 core 의 수집 사정(파싱 소스, reason_code, adb 상태)에 묶여 버린다 — 그것은
 * core 가 이미 data/domain 으로 갈라 놓은 경계를 다시 무너뜨리는 일이다.
 * 서버가 core → 이 계약으로 옮기고, 웹은 이 계약만 본다.
 *
 * 값이 `null` 이면 **모른다**는 뜻이다 (core 의 규칙 3과 같다). 화면은 `null` 을
 * 0 이나 빈 문자열로 바꿔 보여 주지 않는다 — 모르는 것은 모른다고 쓴다.
 */

/** 웹이 부르는 엔드포인트. 문자열을 양쪽에서 각자 적지 않기 위해 여기 모은다. */
export const API = {
  env: '/api/env',
  doctor: '/api/doctor',
  devices: '/api/devices',
  apps: (serial: string) => `/api/devices/${encodeURIComponent(serial)}/apps`,
  appDetail: (serial: string, pkg: string) =>
    `/api/devices/${encodeURIComponent(serial)}/apps/${encodeURIComponent(pkg)}`,
  start: '/api/sessions',
  sessions: '/api/sessions',
  stop: (serial: string) => `/api/sessions/${encodeURIComponent(serial)}/stop`,
  marks: (serial: string) => `/api/sessions/${encodeURIComponent(serial)}/marks`,
  mark: (serial: string, index: number) => `/api/sessions/${encodeURIComponent(serial)}/marks/${index}`,
  abort: (serial: string) => `/api/sessions/${encodeURIComponent(serial)}`,
  runs: '/api/runs',
  run: (id: string) => `/api/runs/${encodeURIComponent(id)}`,
} as const

// ─── 환경 ──────────────────────────────────────────────────────────────────

export interface EnvView {
  version: string
  /** 찾아낸 adb 실행 파일 경로. 못 찾았으면 null. */
  adbPath: string | null
  /**
   * 결과가 저장되는 디렉토리 (`perftracker gui -o` 로 정해진 값).
   *
   * **화면은 이 값을 표시만 하고 정하지 않는다.** 예전에는 브라우저가 `'runs'` 를 박아
   * 보냈는데, `-o` 로 다른 곳을 지정하면 파일은 `runs/` 에 쌓이고 목록은 지정한 곳을 읽어서
   * **측정은 성공했는데 기록이 하나도 안 보이는** 상태가 됐다. 정하는 곳은 하나여야 한다.
   */
  outDir: string
}

// ─── 기기 ──────────────────────────────────────────────────────────────────

export type DeviceState = 'device' | 'unauthorized' | 'offline' | 'unknown'

export interface DeviceSpecView {
  androidRelease: string
  sdkInt: number
  socModel: string | null
  coreCount: number
  memoryTotalKb: number
  widthPx: number
  heightPx: number
  refreshHz: number | null
}

export interface DeviceView {
  serial: string
  model: string | null
  state: DeviceState
  /**
   * 측정 세션이 진행 중이면 null 이다 — 스펙을 읽으려면 기기에 adb 를 보내야 하고,
   * 그것은 측정 창을 깨는 일이다 (core 규칙 1). `measuring` 로 구분한다.
   */
  spec: DeviceSpecView | null
  /** 이 기기에서 다른 세션이 돌고 있다. GUI 는 이 기기를 선택 불가로 그린다. */
  measuring: boolean
  /** 이 기기에서 잴 수 없는 지표. 서버가 doctor 와 같은 판정으로 채운다. */
  metrics: MetricSupportView[]
}

// ─── 지표 지원 여부 ────────────────────────────────────────────────────────

/** 지표 id 는 result.json 의 `metrics` 키와 같다. */
export type MetricId = 'frame' | 'startup' | 'cpu' | 'memory' | 'log' | 'thermal' | 'network'

/** 화면에 그리는 순서. 서버 응답이 비어 있어도 이 순서로 자리를 잡는다. */
export const METRIC_ORDER: readonly MetricId[] = [
  'frame',
  'startup',
  'cpu',
  'memory',
  'log',
  'thermal',
  'network',
]

export interface MetricSupportView {
  id: MetricId
  ok: boolean
  /** 왜 되는지/안 되는지. 툴팁에 그대로 쓴다. 서버가 doctor 의 문장을 넘긴다. */
  reason: string
}

// ─── 앱 ────────────────────────────────────────────────────────────────────

export interface AppView {
  packageName: string
  label: string
}

/**
 * **고른 앱 하나에 대해서만** 읽는 정보.
 *
 * 목록에 버전을 싣지 않는 이유: 사람이 읽는 버전 이름(`2026.7.1`)은 `dumpsys package <pkg>` 를
 * 앱마다 따로 불러야 나온다. 설치된 앱이 82개면 왕복 82번이고, CLI 의 `apps` 도 같은 이유로
 * 그것을 하지 않는다. 대신 `versionCode`(정수)를 실어 봤더니 `2126060861` 같은 값이 사람이
 * 읽는 자리에 앉아 아무에게도 쓸모가 없었다 — 그래서 목록에서는 아예 뺐다.
 *
 * 대상이 하나로 정해진 뒤에는 왕복 한 번이면 되므로 그때 읽는다.
 */
export interface AppDetailView {
  packageName: string
  /** 사람이 읽는 버전. 못 읽었으면 null (`-` 로 그린다). */
  versionName: string | null
}

// ─── 진단 ──────────────────────────────────────────────────────────────────

export interface DoctorCheckView {
  name: string
  ok: boolean
  detail: string
  /** requirement 실패는 막힌 것, capability 실패는 이 기기가 원래 못 재는 것. */
  kind: 'requirement' | 'capability'
}

// ─── 세션 ──────────────────────────────────────────────────────────────────

export interface StartRequest {
  serial: string
  packageName: string
  name: string | null
  launch: boolean
  force: boolean
  // outDir 은 없다 — 서버가 `EnvView.outDir` 로 이미 알고 있다. 위 주석 참조.
}

export interface StartedSessionView {
  id: string
  name: string
  serial: string
  runDir: string
  /**
   * **서버가 실제로 한 일**을 CLI 의 말로 옮긴 줄. 화면은 이것을 그대로 찍고 조립하지 않는다.
   * 예전에는 브라우저가 스스로 만들었고, 그래서 `-o` 처럼 서버만 아는 값이 어긋났다.
   */
  command: string
  /** 서버 시각 기준 시작 시각(ISO). 경과 시간은 웹이 이것으로 센다. */
  startedAt: string
  /** 이 기기에서 못 재는 지표 — `start` 시점에 이미 아는 사실이다. */
  unsupported: { id: string; reason: string }[]
}

export interface StopRequest {
  offline: boolean
}

export interface StopResult {
  run: RunView
  /** 서버가 실제로 한 일. `StartedSessionView.command` 와 같은 이유로 서버가 적는다. */
  command: string
}

/**
 * 측정 중 사람이 남긴 마킹.
 *
 * **저장소는 브라우저가 아니라 서버(활성 세션 포인터 파일)다.** 브라우저에 들고 있으면
 * 새로고침에 사라지고, 무엇보다 같은 세션에 `perftracker mark` 로 남긴 마킹을 GUI 가
 * 정지할 때 덮어써 버린다. 두 입구가 같은 자리에 쓴다.
 *
 * 서버에 쓰는 것은 기기 접촉이 아니다 — core 의 `appendMark` 는 `AdbClient` 를 받지 않는다.
 */
export interface MarkView {
  /** 세션 시작으로부터의 경과(ms). 절대 시각이 아니라 경과인 것은 세션 사이 비교를 위해서다. */
  offsetMs: number
  label: string
}

/**
 * **지금 기기에서 돌고 있는 세션.** 정본은 서버(활성 세션 포인터 파일)다.
 *
 * 왜 필요한가: 브라우저를 새로고침하면 화면의 탭 상태가 통째로 사라진다. 그런데 기기의
 * 측정은 계속 돌고 있어서, 화면은 그 기기를 "다른 탭에서 측정 중" 으로 잠그면서도 정작
 * 그 탭이 없어 **정지시킬 방법이 없는 막다른 길**이 됐다. 화면이 물어볼 곳이 필요하다.
 *
 * 덤으로 터미널에서 `perftracker start` 로 연 세션도 화면에 나타난다 — 같은 파일을 보므로
 * GUI 가 연 것인지 CLI 가 연 것인지 구분하지 않는다.
 */
export interface ActiveSessionView {
  id: string
  name: string
  serial: string
  packageName: string
  runDir: string
  /** 세션 시작 시각(ISO). 경과 시간은 화면이 이것으로 이어서 센다 — 0 부터 다시 세지 않는다. */
  startedAt: string
  launch: boolean
  /** 지금까지 쌓인 마킹. GUI 가 남긴 것과 `perftracker mark` 로 남긴 것이 함께 온다. */
  marks: MarkView[]
  /** 이 기기에서 못 재는 지표. `start` 때 확정된 사실을 그대로 들고 있다. */
  unsupported: { id: string; reason: string }[]
}

// ─── 기록 ──────────────────────────────────────────────────────────────────

export interface RunView {
  id: string
  name: string
  runDir: string
  serial: string
  model: string | null
  packageName: string
  appLabel: string
  appVersion: string | null
  /** 세션 시작 시각(ISO). */
  at: string
  durationMs: number
  launch: boolean
  /** 못 잰 지표 수 · 경고 수 · 마킹 수. 세부는 보고서가 `result.json` 에서 직접 읽는다. */
  unsupportedCount: number
  warningCount: number
  markCount: number
}

/**
 * **보고서의 입력. `result.json` 그대로다.**
 *
 * 이 파일의 다른 타입들과 규칙이 다르고, 그것이 의도다. 다른 화면은 core 타입을 그대로 쓰지
 * 않고 서버가 뷰로 옮겨 준다 — 화면이 core 의 내부 모양에 묶이지 않게 하려는 것이다.
 * 보고서는 반대다: 읽는 대상이 core 의 **내부 타입이 아니라 이 도구가 세션마다 내는 공개
 * 산출물**이고, 그 산출물에는 이미 `schema_version` 이 붙어 있으며 CI·LLM 같은 다른 소비자가
 * 같은 파일을 같은 모양으로 읽는다. 옆에 GUI 전용 뷰를 하나 더 두면 계약이 둘이 되고,
 * 필드가 늘 때마다 두 곳을 고쳐야 하며, 안 고친 쪽이 조용히 낡는다.
 *
 * 구조를 타입으로 다시 적지 않는 이유도 같다 — 보고서 렌더러는 매니페스트의 경로 문자열로
 * 읽고(`readPath`), **필드 부재 / `null` / 값** 세 상태를 런타임에 가른다. 타입을 적어 두면
 * 스키마를 두 벌 유지하게 되는데, 정본은 `perftracker schema` 가 내는 JSON Schema 다.
 */
export type ReportDocument = Record<string, unknown>

/**
 * 기록 목록 + **목록에 안 잡히는 폴더 수.**
 *
 * `runs` 배열은 끝난 세션만이다. 그런데 `start` 가 죽었거나 `--force` 로 밀린 폴더가
 * 디스크에 남고, "전체 지우기" 는 그것까지 지운다 — 다이얼로그가 "기록 5건" 이라고 하면서
 * 7개를 지우면 그 문장이 거짓이 된다. 그래서 수를 함께 준다.
 */
export interface RunsView {
  runs: RunView[]
  /** 기록이 아닌 run 폴더 수 (측정 중인 것 제외). */
  incompleteCount: number
  /** 지금 측정 중이라 지우지 않을 폴더 수. */
  activeCount: number
}

/** 전체 지우기 결과. 무엇을 지웠고 무엇을 남겼는지 말한다. */
export interface ClearRunsResult {
  records: number
  incomplete: number
  skippedActive: number
}

// ─── 오류 ──────────────────────────────────────────────────────────────────

/** 서버는 실패를 이 모양으로만 낸다. 화면은 `message` 를 그대로 보여 준다 (한국어). */
export interface ApiErrorBody {
  message: string
}

// ─── 서버 없이 보는 보고서 ─────────────────────────────────────────────────

/**
 * **한 파일짜리 보고서가 문서에 심어 두는 전역의 이름.**
 *
 * 계약이라 여기 둔다 — 쓰는 쪽(`report/standalone.ts`)과 읽는 쪽(`web/main.tsx` ·
 * `web/report/ReportPage.tsx`)이 다른 계층이고, 이름이 어긋나면 **빈 화면**이 된다.
 * 조용히 깨지는 종류라 양쪽에 따로 적어 두지 않는다.
 */
export const INLINE_REPORT_GLOBAL = '__PERFTRACKER_REPORT__'
