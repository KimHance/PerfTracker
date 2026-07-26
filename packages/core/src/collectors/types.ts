import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import type { MetricReason } from '../schema/reasons.js'
import type { SnapshotPair, SnapshotSpec } from './snapshots.js'

export interface CollectorEnv {
  sdkInt: number
  dataSources: string[]
}

/**
 * `am start -W` 가 낸 것. `session/start.ts` 의 `parseAmStart` 결과가 그대로 담긴다.
 *
 * `status` 와 `waitTimeMs` 가 optional 인 것은 이 필드들이 없던 시절의 `session.json` 을
 * 그대로 읽기 위해서다 — 필드 추가는 형식 버전을 올릴 이유가 아니다.
 */
export interface AmStartResult {
  /** 프로세스 시작부터 첫 프레임까지. 기기가 보고하지 않으면 null. */
  totalTimeMs: number | null
  /** COLD / WARM / HOT / UNKNOWN. 기기가 뱉는 문자열 그대로다. */
  launchState: string | null
  /**
   * `am start -W` 의 `Status:` 원문 (`ok` / `timeout` / ...).
   * **TotalTime 이 없을 때 그 이유를 아는 유일한 단서**라 버리지 않는다.
   */
  status?: string | null
  /** `WaitTime:`. TotalTime 이 없어도 이건 오는 경우가 많다 (실측). */
  waitTimeMs?: number | null
}

/**
 * capture 단계에서만 알 수 있고 트레이스에는 없는 사실.
 * `extractRun` 이 `session.json` 에서 조립해 넣는다 — capture.json 의 버전을 올리지 않는 이유다.
 */
export interface CaptureFacts {
  /** `am start -W` 가 보고한 값. `--launch` 없이 시작했으면 null. */
  startup: AmStartResult | null
  /**
   * 사용자가 `--launch` 를 줬는지.
   * `startup` 이 null 인 이유가 "안 켰다"(skipped)인지 "켰는데 못 읽었다"(partial)인지를 가른다.
   */
  launchRequested: boolean
  /**
   * `am start -W` 직후 기기가 알려 준 앱 프로세스의 pid. `--launch` 없이 시작했거나
   * `pidof` 가 답하지 못했으면 null.
   *
   * 트레이스만으로는 갓 fork 된 앱 프로세스를 이름으로 찾지 못하는 경우가 있어서 필요하다.
   * 자세한 이유는 `collectors/appProcess.ts` 에 있다.
   */
  appPid: number | null
  /**
   * `raw/<key>_before.txt` / `raw/<key>_after.txt` 의 원문. key 는 명령의 이름이다
   * (`thermalservice`, `netstats`, ...).
   *
   * **collector 가 `captureSnapshots()` 로 선언했는지와 무관하게 채워진다.** 이 맵은
   * `capture.json` 의 `artifacts.raw` 를 훑어 만들기 때문이다. 그래서 `dumpsys
   * thermalservice` 처럼 `collectDeviceState()` 가 예전부터 찍어 오던 원문도 여기 들어오고,
   * **M3 이전에 찍힌 run 디렉토리도 그대로 열린다** — capture.json 의 형식 버전을
   * 올리지 않는 이유가 이것이다.
   *
   * 값이 없는 자리는 null 이다: 파일이 없거나(옛 run, 아직 stop 하지 않은 세션),
   * 명령이 실패해 빈 파일이 남았거나. **`''` 는 오지 않는다.**
   */
  snapshots: Record<string, SnapshotPair>
}

/**
 * 모든 collector 가 받는 기본 컨텍스트 — 트레이스를 읽든 안 읽든 공통이다.
 * `ExtractContext` 는 여기에 `tp` 를 얹은 것뿐이고, 트레이스가 필요 없는 collector
 * (`CaptureCollector`) 는 이 기본형을 그대로 받는다. `tp` 가 없다고 "capture 전용"
 * 컨텍스트인 것은 아니다 — 두 종류 collector 가 공유하는 바닥이라서 이 자리에 있다.
 */
export interface BaseExtractContext {
  packageName: string
  /**
   * `capture.json` 의 `target_app.uid`. `pm list packages -U` 가 uid 를 주지 않았거나
   * 시스템 앱이면 null 이다. uid 없이는 per-uid 카운터를 조회할 대상이 없다.
   */
  appUid: number | null
  env: CollectorEnv
  capture: CaptureFacts
}

/** 트레이스를 읽는 collector 의 컨텍스트. 기본 컨텍스트에 `tp` 를 더한 것. */
export interface ExtractContext extends BaseExtractContext {
  tp: TraceProcessor
}

/**
 * 지원 판정. 미지원일 때는 산문이 아니라 안정적인 코드로 말한다 —
 * 그 코드가 그대로 `MetricResult.reason_code` 로 나간다.
 */
export type SupportResult = { supported: true } | { supported: false; reason: MetricReason }

/**
 * 추출 결과. 값이 없을 때 "왜 없는지"를 코드로 구분한다.
 *
 * `partialReason` 은 **값이 나왔지만 일부만 나온** 경우다 — CPU 사용률은 잡혔는데
 * `cpufreq` 이벤트가 하나도 없는 상황이 정확히 이것이고, 그걸 `collected` 로 내보내면
 * 사용률만 있는 결과가 사용률+주파수인 척한다.
 *
 * `status` 는 값이 아예 없을 때 `partial`(기본) 과 `skipped`(수집을 시도조차 안 함) 를 가른다.
 */
export type ExtractOutcome<T> =
  | { collected: true; data: T; partialReason?: MetricReason }
  | { collected: false; reason: MetricReason; status?: 'partial' | 'skipped' }

interface CollectorBase {
  id: string
  /** 어떤 방법으로 잰 값인지. result.json 의 metrics[id].source 로 그대로 나간다. */
  source: string
  supports(env: CollectorEnv): SupportResult
  /** 이 collector 가 필요로 하는 데이터소스 블록. 반드시 `collectors/blocks.ts` 의 상수를 쓴다. */
  traceConfigBlocks(): string[]
  /**
   * capture 단계에 **시작 직전 1회 / 종료 직후 1회**씩 찍을 셸 명령. 반드시
   * `collectors/snapshots.ts` 의 상수를 쓴다. `traceConfigBlocks()` 와 대칭이고,
   * 같은 성질을 하나 더 갖는다 — **이 collector 가 미지원인 기기에는 명령이 아예 나가지 않는다.**
   *
   * optional 인 것은 의도다. 기존 collector 다섯은 이 훅을 선언하지 않고 한 줄도 바뀌지 않는다.
   * `Collector<T>` 유니온에 세 번째 멤버를 만들지 않는 이유는 M3 계획서 D2 에 있다.
   *
   * **읽기와 무관하다.** 원문을 읽으려고 여기 선언할 필요는 없다 —
   * `CaptureFacts.snapshots` 는 `artifacts.raw` 전체를 노출한다. 선언은 오직
   * "capture 가 이 명령을 **추가로** 실행해 달라" 는 뜻이다.
   */
  captureSnapshots?(): SnapshotSpec[]
}

/** 트레이스를 파싱해야 값이 나오는 collector. */
export interface TraceCollector<T> extends CollectorBase {
  needsTrace: true
  extract(ctx: ExtractContext): Promise<ExtractOutcome<T>>
}

/**
 * capture 단계의 사실만으로 값이 나오는 collector (startup).
 * 트레이스가 없는 run 에서도 정상 산출돼야 하므로 `runCollector` 의 trace_missing 단축로를 타지 않는다.
 */
export interface CaptureCollector<T> extends CollectorBase {
  needsTrace: false
  extract(ctx: BaseExtractContext): Promise<ExtractOutcome<T>>
}

/**
 * 메트릭 하나 = 파일 하나.
 * `needsTrace` 가 판별자다 — `runCollector` 가 이걸로 좁히면 `as` 캐스트 없이 타입이 맞는다.
 */
export type Collector<T> = TraceCollector<T> | CaptureCollector<T>
