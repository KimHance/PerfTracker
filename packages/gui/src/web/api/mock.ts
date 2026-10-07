import {
  METRIC_ORDER,
  type ActiveSessionView,
  type AppView,
  type DeviceView,
  type DiagnoseSessionView,
  type DoctorCheckView,
  type EnvView,
  type MarkView,
  type MetricSupportView,
  type RunView,
  type StartRequest,
  type StartedSessionView,
  type StopRequest,
} from '../../contract/api.js'
import type { ApiClient } from './client.js'

/**
 * 서버 없이 화면만 돌리기 위한 가짜 구현. **여기 있는 값은 전부 지어낸 것이다.**
 *
 * 왜 만드는가: 화면을 CLI·기기 없이 손볼 수 있어야 하고, 빈 상태·오류·동시 세션처럼
 * 실기기로는 만들기 번거로운 화면을 그대로 띄울 수 있어야 한다.
 *
 * 왜 위험한가: 가짜 데이터가 진짜처럼 보이면 그게 곧 규칙 3 위반이다. 그래서
 * (1) 이 파일 밖으로 목업 값이 새지 않게 하고,
 * (2) `createMockClient` 를 쓰면 화면 상단에 목업임을 알리는 배너가 뜬다 (`App.tsx`),
 * (3) 지표 지원 판정은 **여기 표가 아니라 doctor 가 정본**이다 — 실제 판정은 SDK 뿐 아니라
 *     그 기기에 perfetto 데이터소스가 등록됐는지에도 달려 있어서 표로 환원되지 않는다.
 */

/** 목업 전용 근사치. 실제 판정은 core 의 `collector.supports(env)` 가 한다. */
const MOCK_METRIC_MIN_SDK: Record<(typeof METRIC_ORDER)[number], { min: number; label: string | null }> = {
  // 하한이 없다 — `dumpsys gfxinfo` 라서 sdk 30 에서 frame 이 미지원일 때도 나온다.
  hwui: { min: 0, label: null },
  // FRAMETIMELINE_MIN_SDK(core) 와 같다 — sdk 31 미만이거나 perfetto 데이터소스가
  // 없는 기기에서 미지원이다.
  frame: { min: 31, label: 'Android 12' },
  startup: { min: 0, label: null },
  cpu: { min: 30, label: 'Android 11' },
  memory: { min: 30, label: 'Android 11' },
  log: { min: 30, label: 'Android 11' },
  thermal: { min: 29, label: 'Android 10' },
  network: { min: 34, label: 'Android 14' },
}

function mockMetrics(sdkInt: number): MetricSupportView[] {
  return METRIC_ORDER.map((id) => {
    const { min, label } = MOCK_METRIC_MIN_SDK[id]
    return {
      id,
      ok: sdkInt >= min,
      reason:
        sdkInt >= min
          ? '측정 가능'
          : `sdk_int=${sdkInt} 로는 수집할 수 없습니다 (최소 ${min}${label !== null ? `, ${label}` : ''})`,
    }
  })
}

/**
 * 진단 세션 목업 — **core 의 문장과 판정을 흉내 낸 것이다.** 웹은 core 를 import 하지 않으므로
 * (규칙 4) 글자를 여기 다시 적고, 같은지는 `test/mock.test.ts` 가 core 의
 * `diagnoseDoctorCheck` · `diagnoseNotice` 와 대조한다. 판정의 정본은 core 의 `appSliceOpen` 이다.
 *
 * 앱 slice 열림 조건(기능 문서 조건 표): sdk ≥31 은 열림 · sdk ≤30 은 debuggable 앱만 ·
 * 그 밖은 모름. 측정 화면 6상태(디자인 문서 `## 상태`)가 평소 `?mock` 에서 이렇게 닿는다:
 *
 *   toggle-off · toggle-on  기기 · 앱을 고르고 04 의 `--diagnose` 를 끄고 켠다
 *   doctor-sdk30            SM-A405S(`R38M20ABCDE`, sdk 30) 를 고르고 환경 점검 — 진단 줄 ✗
 *   running                 sdk ≥31 기기(예 SM-S901N)에서 진단을 켜고 시작 — 고지 없음
 *   running-unknown         SM-A405S + `.debug` 로 끝나지 않는 앱(예 Airbnb)으로 진단 시작 —
 *                           `debuggable 아님` 고지 · `com.streamlive.blur.test` 면 `debuggable 모름`
 *   drawer                  기록 맨 위 `진단 스크롤` 이 진단 기록 · 나머지는 평소 기록
 */
const MOCK_APP_SLICE_MIN_SDK = 31

/**
 * 목업 앱의 debuggable. 실제 서버는 `dumpsys package` 의 flags 에서 읽는다 — 여기는 지어낸 값이다.
 * 이름이 `.debug` 로 끝나면 true, 시험 앱 하나는 **못 읽었다**(null), 나머지는 false.
 */
function mockDebuggable(packageName: string): boolean | null {
  if (packageName.endsWith('.debug')) return true
  if (packageName === 'com.streamlive.blur.test') return null
  return false
}

function mockDiagnoseDoctorCheck(sdkInt: number): DoctorCheckView {
  const open = sdkInt >= MOCK_APP_SLICE_MIN_SDK
  return {
    name: 'diagnose: app slice',
    ok: open,
    kind: 'capability',
    detail: open ? `sdk ${sdkInt} · 열림` : `sdk ${sdkInt} · debuggable 앱만 열림`,
  }
}

function mockDiagnoseNotice(sdkInt: number, debuggable: boolean | null): string | null {
  if (sdkInt >= MOCK_APP_SLICE_MIN_SDK || debuggable === true) return null
  return `앱 slice 열림 모름 — sdk ${sdkInt} · debuggable ${debuggable === false ? '아님' : '모름'}`
}

function mockDevice(
  serial: string,
  model: string,
  release: string,
  sdkInt: number,
  socModel: string | null,
  coreCount: number,
  ramGb: number,
  widthPx: number,
  heightPx: number,
  refreshHz: number,
): DeviceView {
  return {
    serial,
    model,
    state: 'device',
    spec: {
      androidRelease: release,
      sdkInt,
      socModel,
      coreCount,
      memoryTotalKb: ramGb * 1024 * 1024,
      widthPx,
      heightPx,
      refreshHz,
    },
    measuring: false,
    metrics: mockMetrics(sdkInt),
  }
}

const MOCK_DEVICES: DeviceView[] = [
  mockDevice('R3CT0000003', 'SM-F936N', '16', 36, 'SM8475', 8, 11, 904, 2316, 60),
  mockDevice('R5CT0000001', 'SM-S901N', '16', 36, 'SM8450', 8, 7, 1080, 2340, 120),
  mockDevice('R38M20ABCDE', 'SM-A405S', '11', 30, 'Exynos 7904', 8, 4, 1080, 2340, 60),
  mockDevice('emulator-5554', 'sdk_gphone64_arm64', '15', 35, null, 4, 8, 1080, 2400, 60),
]

const MOCK_APPS: AppView[] = [
  { label: 'Stream (debug)', packageName: 'com.example.streaming.debug' },
  { label: 'Haze Sample', packageName: 'dev.chrisbanes.haze.sample' },
  { label: 'com.streamlive.blur.test', packageName: 'com.streamlive.blur.test' },
  { label: 'StreamingSDK', packageName: 'com.example.sdk.sample' },
  { label: 'Airbnb', packageName: 'com.airbnb.android' },
  { label: 'Compose Material Catalog', packageName: 'androidx.compose.material.catalog' },
  { label: 'Now in Android', packageName: 'com.google.samples.apps.nowinandroid' },
  { label: 'Instagram', packageName: 'com.instagram.android' },
  { label: 'Samsung Browser', packageName: 'com.sec.android.app.sbrowser' },
  { label: 'Google TV', packageName: 'com.google.android.videos' },
  { label: 'Calculator', packageName: 'com.sec.android.app.popupcalculator' },
  { label: 'Galaxy Wearable', packageName: 'com.samsung.android.app.watchmanager' },
]

const MOCK_RUNS: RunView[] = [
  {
    // 진단 세션 기록 — 기록 드로어의 진단 태그 자리 (디자인 문서 `## 상태` drawer)
    id: 'd1a90c',
    name: '진단 스크롤',
    runDir: 'runs/20260727_183012_진단스크롤_d1a90c',
    serial: 'R5CT0000001',
    model: 'SM-S901N',
    packageName: 'com.airbnb.android',
    appLabel: 'Airbnb',
    appVersion: '26.30',
    at: '2026-07-27T18:30:12',
    durationMs: 15872,
    launch: true,
    unsupportedCount: 0,
    warningCount: 1,
    markCount: 0,
    diagnose: true,
  },
  {
    id: 'eb6d24',
    name: '클린업 검증',
    runDir: 'runs/20260727_180539_클린업검증_eb6d24',
    serial: 'R3CT0000003',
    model: 'SM-F936N',
    packageName: 'com.example.streaming.debug',
    appLabel: 'Stream (debug)',
    appVersion: '2026.7.1',
    at: '2026-07-27T18:05:39',
    durationMs: 14921,
    launch: true,
    unsupportedCount: 0,
    warningCount: 2,
    markCount: 0,
  },
  {
    id: '90458b',
    name: '동시-A11',
    runDir: 'runs/20260727_174647_동시-A11_90458b',
    serial: 'R38M20ABCDE',
    model: 'SM-A405S',
    packageName: 'com.airbnb.android',
    appLabel: 'Airbnb',
    appVersion: '26.30',
    at: '2026-07-27T17:46:47',
    durationMs: 61044,
    launch: true,
    unsupportedCount: 2,
    warningCount: 3,
    markCount: 4,
  },
  {
    id: 'e601ba',
    name: '동시-A16',
    runDir: 'runs/20260727_174642_동시-A16_e601ba',
    serial: 'R5CT0000001',
    model: 'SM-S901N',
    packageName: 'com.airbnb.android',
    appLabel: 'Airbnb',
    appVersion: '26.30',
    at: '2026-07-27T17:46:42',
    durationMs: 62310,
    launch: true,
    unsupportedCount: 0,
    warningCount: 1,
    markCount: 0,
  },
  {
    id: '297874',
    name: '고지 확인',
    runDir: 'runs/20260727_172106_고지확인_297874',
    serial: 'R3CT0000003',
    model: 'SM-F936N',
    packageName: 'dev.chrisbanes.haze.sample',
    appLabel: 'Haze Sample',
    appVersion: '1.6.10',
    at: '2026-07-27T17:21:06',
    durationMs: 33502,
    launch: false,
    unsupportedCount: 0,
    warningCount: 1,
    markCount: 2,
  },
  {
    id: 'cda944',
    name: '시계열 검증',
    runDir: 'runs/20260727_161246_시계열검증_cda944',
    serial: 'R3CT0000003',
    model: 'SM-F936N',
    packageName: 'com.example.streaming.debug',
    appLabel: 'Stream (debug)',
    appVersion: '2026.7.1',
    at: '2026-07-27T16:12:46',
    durationMs: 122304,
    launch: true,
    unsupportedCount: 0,
    warningCount: 2,
    markCount: 0,
  },
]

export interface MockOptions {
  /** 기기 0대 빈 상태를 보고 싶을 때. */
  noDevices?: boolean
  /** 각 호출이 걸리는 시간(ms). 로딩 오버레이가 실제로 보이게 하려고 둔다. */
  latencyMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 목업 클라이언트. 상태는 이 클로저 안에만 있고, 새로고침하면 초기값으로 돌아간다. */
export function createMockClient(options: MockOptions = {}): ApiClient {
  const latency = options.latencyMs ?? 420
  let devices = options.noDevices === true ? [] : MOCK_DEVICES.map((d) => ({ ...d }))
  let runs = MOCK_RUNS.map((r) => ({ ...r }))
  let seq = 0
  // 실제 서버에서는 활성 세션 포인터 파일이 정본이다. 목업은 그 자리를 메모리로 흉내 낸다.
  const marksBySerial = new Map<string, MarkView[]>()
  const startedAtBySerial = new Map<string, number>()
  // 진단 세션으로 연 기기만 들어 있다 — 실제 서버의 포인터 파일처럼 진단 칸은 진단 세션에만.
  const diagnoseBySerial = new Map<string, DiagnoseSessionView>()

  const wait = async <T>(value: T): Promise<T> => {
    await sleep(latency)
    return value
  }

  const setMeasuring = (serial: string, measuring: boolean): void => {
    devices = devices.map((d) => (d.serial === serial ? { ...d, measuring } : d))
  }

  return {
    env: () => wait<EnvView>({
        version: '0.1.0',
        adbPath: '~/Library/Android/sdk/platform-tools/adb (목업)',
        outDir: 'runs (목업)',
      }),

    doctor: (serial) => {
      // 실제 doctor 처럼 기기를 알 때만 capability 줄이 붙는다 — 지표 판정 뒤 맨 끝에 진단 줄.
      const sdkInt = devices.find((d) => d.serial === serial)?.spec?.sdkInt ?? null
      return wait<DoctorCheckView[]>([
        { name: 'adb', ok: true, detail: '목업 클라이언트라 실제로 점검하지 않았습니다', kind: 'requirement' },
        {
          name: 'device',
          ok: serial !== null,
          detail: serial !== null ? `${serial} (목업)` : '기기를 고르지 않았습니다',
          kind: 'requirement',
        },
        ...(sdkInt === null
          ? []
          : [
              ...mockMetrics(sdkInt).map((m) => ({
                name: `metric: ${m.id}`,
                ok: m.ok,
                detail: m.reason,
                kind: 'capability' as const,
              })),
              mockDiagnoseDoctorCheck(sdkInt),
            ]),
      ])
    },

    devices: () => wait(devices.map((d) => ({ ...d }))),

    sessions: () =>
      wait<ActiveSessionView[]>(
        [...startedAtBySerial.entries()].map(([serial, startedAt]) => ({
          id: `mock${serial}`,
          name: `목업 세션 (${serial})`,
          serial,
          packageName: 'com.example.streaming.debug',
          runDir: `runs/mock_${serial}`,
          startedAt: new Date(startedAt).toISOString(),
          launch: true,
          marks: [...(marksBySerial.get(serial) ?? [])],
          unsupported: (devices.find((d) => d.serial === serial)?.metrics ?? [])
            .filter((m) => !m.ok)
            .map((m) => ({ id: m.id, reason: m.reason })),
          ...(diagnoseBySerial.has(serial) ? { diagnose: { ...diagnoseBySerial.get(serial)! } } : {}),
        })),
      ),

    appDetail: (serial, packageName) =>
      wait({ packageName, versionName: serial.startsWith('emulator') ? null : '2026.7.1 (목업)' }),

    apps: (serial) => {
      // serial 별로 다른 목록을 낼 이유가 없지만, 인자를 무시하면 "기기를 바꿔도 같은 목록"
      // 이라는 사실이 드러나지 않는다. 에뮬레이터만 짧은 목록으로 구분해 둔다.
      const list = serial.startsWith('emulator') ? MOCK_APPS.slice(0, 4) : MOCK_APPS
      return wait(list.map((a) => ({ ...a })))
    },

    marks: (serial) => wait([...(marksBySerial.get(serial) ?? [])]),

    addMark: (serial, label) => {
      const startedAt = startedAtBySerial.get(serial) ?? Date.now()
      const marks = [...(marksBySerial.get(serial) ?? []), { offsetMs: Date.now() - startedAt, label }]
      marksBySerial.set(serial, marks)
      return wait([...marks])
    },

    removeMark: (serial, index) => {
      const marks = [...(marksBySerial.get(serial) ?? [])]
      marks.splice(index, 1)
      marksBySerial.set(serial, marks)
      return wait([...marks])
    },

    start: (req: StartRequest) => {
      setMeasuring(req.serial, true)
      marksBySerial.set(req.serial, [])
      startedAtBySerial.set(req.serial, Date.now())
      const sdkInt = devices.find((d) => d.serial === req.serial)?.spec?.sdkInt ?? 0
      const diagnose: DiagnoseSessionView | null =
        req.diagnose === true ? { notice: mockDiagnoseNotice(sdkInt, mockDebuggable(req.packageName)) } : null
      // 시작마다 다시 정한다 — 버린(abort) 진단 세션의 칸이 같은 기기의 다음 평소 세션에 남지 않게.
      if (diagnose !== null) diagnoseBySerial.set(req.serial, diagnose)
      else diagnoseBySerial.delete(req.serial)
      seq += 1
      return wait<StartedSessionView>({
        id: `mock${String(seq).padStart(2, '0')}`,
        name: req.name ?? `세션-${seq}`,
        serial: req.serial,
        runDir: `runs/mock_${req.serial}_${seq}`,
        startedAt: new Date().toISOString(),
        unsupported: (devices.find((d) => d.serial === req.serial)?.metrics ?? [])
          .filter((m) => !m.ok)
          .map((m) => ({ id: m.id, reason: m.reason })),
        ...(diagnose !== null ? { diagnose: { ...diagnose } } : {}),
        command: `perftracker start${diagnose !== null ? ' --diagnose' : ''} --app "${req.packageName}" -d ${req.serial} -o runs (목업)`,
      })
    },

    stop: (serial, _req: StopRequest) => {
      setMeasuring(serial, false)
      startedAtBySerial.delete(serial)
      const diagnosed = diagnoseBySerial.delete(serial)
      const device = devices.find((d) => d.serial === serial)
      const run: RunView = {
        id: `mock${String(seq).padStart(2, '0')}`,
        name: `목업 세션 ${seq}`,
        runDir: `runs/mock_${serial}_${seq}`,
        serial,
        model: device?.model ?? null,
        packageName: 'com.example.streaming.debug',
        appLabel: 'Stream (debug)',
        appVersion: '2026.7.1',
        at: new Date().toISOString().slice(0, 19),
        durationMs: 30000,
        launch: true,
        unsupportedCount: (device?.metrics ?? []).filter((m) => !m.ok).length,
        warningCount: 1,
        markCount: (marksBySerial.get(serial) ?? []).length,
        ...(diagnosed ? { diagnose: true as const } : {}),
      }
      runs = [run, ...runs]
      // 실제 서버가 그렇듯 목업도 "내가 한 일" 을 함께 낸다.
      return wait({ run, command: `perftracker stop -d ${serial} (목업)` })
    },

    abort: (serial) => {
      setMeasuring(serial, false)
      startedAtBySerial.delete(serial)
      return wait(undefined)
    },

    runs: () => wait({ runs: runs.map((r) => ({ ...r })), incompleteCount: 2, activeCount: 0 }),

    renameRun: (id, name) => {
      runs = runs.map((r) => (r.id === id ? { ...r, name } : r))
      return wait(runs.find((r) => r.id === id)!)
    },

    deleteRun: (id) => {
      runs = runs.filter((r) => r.id !== id)
      return wait(undefined)
    },

    clearRuns: () => {
      const records = runs.length
      runs = []
      // 목업도 "미완성까지 지운다" 는 사실을 흉내 낸다 — 실제 서버가 그렇다.
      return wait({ records, incomplete: 2, skippedActive: 0 })
    },
  }
}
