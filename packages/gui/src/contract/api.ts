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
  start: '/api/sessions',
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
  /**
   * `pm list packages` 가 목록과 함께 주는 값이라 공짜다.
   *
   * **`versionName`("2026.7.1")이 아니라 `versionCode`(정수)인 이유:** 사람이 읽는 버전 이름은
   * `dumpsys package <pkg>` 한 번을 앱마다 따로 불러야 나온다. 설치된 앱이 200개면 왕복 200번이고,
   * CLI 의 `apps` 도 같은 이유로 그것을 하지 않는다. 대상 앱 하나가 정해진 뒤에는
   * `result.json` 의 `target_app.version_name` 에 이름이 실린다 — 기록 목록이 보여 주는 것이 그것이다.
   */
  versionCode: number | null
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
  outDir: string
}

export interface StartedSessionView {
  id: string
  name: string
  serial: string
  runDir: string
  /** 서버 시각 기준 시작 시각(ISO). 경과 시간은 웹이 이것으로 센다. */
  startedAt: string
  /** 이 기기에서 못 재는 지표 — `start` 시점에 이미 아는 사실이다. */
  unsupported: { id: string; reason: string }[]
}

export interface StopRequest {
  offline: boolean
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
  /** 못 잰 지표 수 · 경고 수 · 마킹 수. 세부는 대시보드(미정)가 result.json 에서 읽는다. */
  unsupportedCount: number
  warningCount: number
  markCount: number
}

export interface RenameRequest {
  name: string
}

// ─── 오류 ──────────────────────────────────────────────────────────────────

/** 서버는 실패를 이 모양으로만 낸다. 화면은 `message` 를 그대로 보여 준다 (한국어). */
export interface ApiErrorBody {
  message: string
}
