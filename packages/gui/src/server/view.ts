import type { DeviceSummary, DoctorCheck, LabeledApp, RunSummary } from '@perftracker/core'
import {
  METRIC_ORDER,
  type AppView,
  type DeviceView,
  type DoctorCheckView,
  type MetricId,
  type MetricSupportView,
  type RunView,
} from '../contract/api.js'

/**
 * core → 계약. **여기가 유일한 번역 자리다.**
 *
 * core 의 타입을 그대로 흘리지 않는 이유: 화면이 수집 사정(reason_code, 파싱 소스,
 * adb 상태 문자열)에 묶이면 core 를 고칠 때마다 화면이 깨진다. core 가 이미 data/domain 으로
 * 갈라 놓은 경계를 GUI 에서 다시 무너뜨릴 이유가 없다.
 */

/** `doctor` 가 지표 항목에 쓰는 이름 형식. 이 접두어로 지표 판정만 골라낸다. */
const METRIC_CHECK_PREFIX = 'metric: '

export function toDoctorView(checks: DoctorCheck[]): DoctorCheckView[] {
  return checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail, kind: c.kind }))
}

/**
 * doctor 결과에서 지표 판정만 꺼낸다 (개수는 `METRIC_ORDER` 가 정한다).
 *
 * **화면이 SDK 표를 들고 판단하지 않게 하려는 것이 이 함수의 전부다.** 실제 판정은
 * `collector.supports(env)` 이고, 그것은 SDK 뿐 아니라 그 기기에 perfetto 데이터소스가
 * 등록됐는지에도 달려 있어 표로 환원되지 않는다 (cpu·memory·log 가 그렇다).
 *
 * doctor 가 지표 항목을 하나도 내지 않았으면 **빈 배열**이다 — "전부 가능" 이 아니다.
 * 측정 세션이 진행 중이라 기기 프로브를 건너뛴 경우가 그렇고, 그때 "가능" 이라고 그리면
 * 확인하지 않은 것을 사실로 쓰는 것이다.
 */
export function toMetricViews(checks: DoctorCheck[]): MetricSupportView[] {
  const known = new Set<string>(METRIC_ORDER)
  const views: MetricSupportView[] = []

  for (const check of checks) {
    if (!check.name.startsWith(METRIC_CHECK_PREFIX)) continue
    const id = check.name.slice(METRIC_CHECK_PREFIX.length)
    if (!known.has(id)) continue
    views.push({ id: id as MetricId, ok: check.ok, reason: check.detail })
  }
  return views
}

export function toDeviceView(summary: DeviceSummary, metrics: MetricSupportView[]): DeviceView {
  const spec = summary.spec
  return {
    serial: summary.serial,
    model: summary.model,
    state: summary.state,
    spec:
      spec === null
        ? null
        : {
            androidRelease: spec.android_release,
            sdkInt: spec.sdk_int,
            socModel: spec.soc_model,
            coreCount: spec.cpu.core_count,
            memoryTotalKb: spec.memory_total_kb,
            widthPx: spec.display.width_px,
            heightPx: spec.display.height_px,
            refreshHz: spec.display.active_refresh_rate_hz,
          },
    measuring: summary.measurementInProgress,
    metrics,
  }
}

export function toAppView(app: LabeledApp): AppView {
  return { packageName: app.packageName, label: app.label }
}

/**
 * core 의 기록 요약 → 계약. 필드 이름 하나(`startedAt` → `at`)만 다르다 —
 * 계약은 화면이 읽는 말이고, core 는 자기 말을 쓴다. 그 번역이 이 파일의 일이다.
 */
export function toRunView(run: RunSummary): RunView {
  return {
    id: run.id,
    name: run.name,
    runDir: run.runDir,
    serial: run.serial,
    model: run.model,
    packageName: run.packageName,
    appLabel: run.appLabel,
    appVersion: run.appVersion,
    at: run.startedAt,
    durationMs: run.durationMs,
    launch: run.launch,
    unsupportedCount: run.unsupportedCount,
    warningCount: run.warningCount,
    markCount: run.markCount,
  }
}
