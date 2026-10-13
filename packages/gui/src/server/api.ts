import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendMark,
  createAdbContext,
  createBaseAdb,
  clearRuns,
  deleteRun,
  extractRun,
  findRun,
  getAppDetail,
  listRunDirs,
  listRuns,
  listDeviceSummaries,
  metricSupportChecks,
  loadLabeledApps,
  PerfTrackerError,
  listActiveSessions,
  readActiveSession,
  probeDevice,
  removeMark,
  renameRun,
  resolveTargetApp,
  runDoctor,
  SessionStateError,
  sortedMarks,
  startSession,
  stopSession,
  beginStart,
  type StartOptions,
} from '@perftracker/core'
import type {
  ActiveSessionView,
  AppDetailView,
  AppView,
  DeviceView,
  DoctorCheckView,
  EnvView,
  MarkView,
  ReportDocument,
  RunsView,
  RunView,
  ClearRunsResult,
  StartRequest,
  StartedSessionView,
  StopRequest,
  StopResult,
} from '../contract/api.js'
import { abortCommandLine, startCommandLine, stopCommandLine } from './command.js'
import {
  toActiveSessionView,
  toAppView,
  toDeviceView,
  toDoctorView,
  toMetricViews,
  toRunView,
  toStartedSessionView,
} from './view.js'
import { GUI_VERSION } from './version.js'

/**
 * GUI 서버가 하는 일 전부. **CLI 의 로직을 다시 쓰지 않고 core 를 그대로 부른다** —
 * 판정이 두 곳에 있으면 CLI 와 GUI 가 서로 다른 답을 내는 날이 온다.
 *
 * 규칙 1 은 여기서도 그대로다: 측정 중인 기기에는 아무것도 보내지 않는다.
 * `listDeviceSummaries` 가 진행 중인 기기의 스펙 조회를 건너뛰고, 마킹은 호스트의 파일만
 * 고친다 (`@perftracker/core` 의 `session/marks.ts`).
 */

export interface GuiOptions {
  /** `--adb` 로 넘어온 경로. 없으면 core 의 탐색 사슬이 찾는다. */
  adb?: string | undefined
  /** 결과를 저장할 디렉토리. CLI 의 `-o` 와 같은 뜻이다. */
  outDir: string
  // 버전 칸은 두지 않는다. 넘겨받으면 부르는 쪽이 문자열을 박는다 — `version.ts` 가 읽는다.
}

export class GuiApi {
  constructor(private readonly opts: GuiOptions) {}

  env(): EnvView {
    try {
      const { located } = createBaseAdb({ adb: this.opts.adb })
      return { version: GUI_VERSION, adbPath: located.path, outDir: this.opts.outDir }
    } catch {
      // adb 를 못 찾은 것은 화면이 알아야 할 사실이다. 서버가 죽을 이유는 아니다.
      return { version: GUI_VERSION, adbPath: null, outDir: this.opts.outDir }
    }
  }

  /**
   * 진행 중인 세션 전부. **기기에 접촉하지 않는다** — 활성 세션 포인터 파일만 읽는다.
   * 그래서 측정 중에 몇 초마다 불러도 규칙 1 을 깨지 않는다.
   *
   * GUI 가 연 세션과 CLI 가 연 세션을 구분하지 않는다. 같은 파일이 정본이기 때문이다.
   */
  async sessions(): Promise<ActiveSessionView[]> {
    return (await listActiveSessions()).map(toActiveSessionView)
  }

  async doctor(serial: string | null): Promise<DoctorCheckView[]> {
    return toDoctorView(await runDoctor({ adb: this.opts.adb, ...(serial !== null ? { device: serial } : {}) }))
  }

  /**
   * 기기 목록 + 기기별 지표 판정.
   *
   * **판정은 core 의 `metricSupportChecks` 를 그대로 부른다** — `doctor` 와 같은 함수다.
   * 화면이 SDK 표를 들고 스스로 판단하면 그 표가 core 와 어긋나는 날 "된다고 했는데 안 되는"
   * 상태가 생긴다. 출처는 하나여야 한다.
   *
   * 한동안 기기마다 `doctor` 를 **통째로** 돌렸다. 판정 출처를 하나로 두려던 것인데, doctor 는
   * adb 버전 확인·기기 목록·trace_processor 캐시 조회까지 하는 "환경 전체 점검" 이라
   * 여기 필요한 것(sdk + 데이터소스)에 비해 훨씬 크다 — 기기 2대에 새로고침 한 번이 약 2초였다.
   * 이제 `probeDevice` 만 부른다. 판정 함수는 그대로이므로 답은 같다.
   *
   * 측정 중인 기기는 프로브하지 않는다 (규칙 1). 그때 `metrics` 는 빈 배열이고,
   * 그것은 "전부 가능" 이 아니라 **"모른다"** 다.
   */
  async devices(): Promise<DeviceView[]> {
    const { adb } = createBaseAdb({ adb: this.opts.adb })
    const summaries = await listDeviceSummaries({ adb: this.opts.adb })

    // 기기끼리 나란히 — `listDeviceSummaries` 와 같은 이유다 (기기 하나의 프로브가 ~150ms).
    return Promise.all(
      summaries.map(async (summary) => {
        if (summary.state !== 'device' || summary.measurementInProgress) return toDeviceView(summary, [])
        const probe = await probeDevice(adb.withSerial(summary.serial))
        const checks = metricSupportChecks({ sdkInt: probe.sdkInt, dataSources: probe.dataSources })
        return toDeviceView(summary, toMetricViews(checks))
      }),
    )
  }

  async apps(serial: string): Promise<AppView[]> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    return (await loadLabeledApps(ctx)).map(toAppView)
  }

  /**
   * 고른 앱 하나의 버전. **목록 전체에는 절대 돌리지 않는다** — core 의 `getAppDetail` 이
   * 주석으로 그렇게 못 박고 있고, 설치된 앱 수만큼 adb 왕복이 생긴다.
   */
  async appDetail(serial: string, packageName: string): Promise<AppDetailView> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const detail = await getAppDetail(ctx.adb, packageName)
    return { packageName, versionName: detail.versionName }
  }

  async start(req: StartRequest): Promise<StartedSessionView> {
    const ctx = await createAdbContext({ adb: this.opts.adb, device: req.serial })
    await beginStart(ctx, { force: req.force })

    const app = await resolveTargetApp(ctx, req.packageName)
    const session = await startSession(ctx, app, startOptions(req, this.opts.outDir, new Date()))
    return toStartedSessionView(session, req.serial, startCommandLine(req, this.opts.outDir))
  }

  /** 측정 중 마킹 하나. **기기에 나가는 명령이 없다** — 포인터 파일만 고친다. */
  async addMark(serial: string, label: string): Promise<MarkView[]> {
    const session = await readActiveSession(serial)
    if (session === null) throw new SessionStateError(`기기 ${serial} 에 진행 중인 세션이 없습니다.`)
    await appendMark(session, label, new Date())
    return this.marks(serial)
  }

  async removeMark(serial: string, index: number): Promise<MarkView[]> {
    await removeMark(serial, index)
    return this.marks(serial)
  }

  async marks(serial: string): Promise<MarkView[]> {
    const session = await readActiveSession(serial)
    if (session === null) return []
    return sortedMarks(session).map((m) => ({ offsetMs: m.offsetMs, label: m.label }))
  }

  /**
   * 정지 → 회수 → 산출. CLI 의 `stop` 과 **같은 순서, 같은 실패 처리**다.
   * 원본을 회수한 뒤 산출이 실패하면 run 디렉토리를 알려 준다 — 원본은 이미 안전하다.
   */
  async stop(serial: string, req: StopRequest): Promise<StopResult> {
    const session = await readActiveSession(serial)
    if (session === null) throw new SessionStateError(`기기 ${serial} 에 실행 중인 세션이 없습니다.`)

    // 마킹은 이미 포인터에 쌓여 있다 (`addMark` 가 그때그때 썼다). stopSession 이 포인터를
    // 그대로 run 디렉토리의 session.json 으로 옮기므로 여기서 따로 할 일이 없다.
    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const { runDir } = await stopSession(ctx, session, new Date())

    try {
      await extractRun(runDir, { offline: req.offline })
    } catch (e) {
      throw new SessionStateError(
        `원본은 회수했지만 result.json 산출에 실패했습니다.\n` +
          `  run 디렉토리  ${runDir}\n` +
          `perftracker extract ${runDir} 로 언제든 다시 산출할 수 있습니다.\n\n` +
          `원인: ${(e as Error).message}`,
      )
    }

    const run = (await listRuns(this.opts.outDir)).find((r) => r.runDir === runDir)
    if (run === undefined) {
      throw new SessionStateError(`기록을 만들었지만 목록에서 찾지 못했습니다: ${runDir}`)
    }
    return { run: toRunView(run), command: stopCommandLine(serial, req.offline) }
  }

  /**
   * 측정 중인 세션을 기록 없이 버린다.
   * `stop` 을 부르되 산출하지 않고 run 디렉토리를 지운다 — **기기의 Perfetto 세션을 반드시
   * 정리해야** 다음 측정이 남은 세션에 걸리지 않는다.
   */
  async abort(serial: string): Promise<void> {
    const session = await readActiveSession(serial)
    if (session === null) return

    const ctx = await createAdbContext({ adb: this.opts.adb, device: serial })
    const { runDir } = await stopSession(ctx, session, new Date())
    await rm(runDir, { recursive: true, force: true })
  }

  async runs(): Promise<RunsView> {
    const entries = await listRunDirs(this.opts.outDir)
    return {
      // `listRunDirs` 는 **디렉토리 열거**라 이름순이다. 화면의 기록 목록은 **시각순**이어야
      // 하므로 여기서 다시 세운다 — 이름은 세션 이름을 담고 있어 시간과 무관하다.
      runs: entries
        .flatMap((e) => (e.summary === null ? [] : [e.summary]))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(toRunView),
      incompleteCount: entries.filter((e) => e.summary === null && !e.active).length,
      activeCount: entries.filter((e) => e.active).length,
    }
  }

  /** 측정 중인 세션을 버릴 때 화면이 찍을 줄. 실행한 쪽이 적는다. */
  abortCommand(serial: string): string {
    return abortCommandLine(serial)
  }

  async renameRun(id: string, name: string): Promise<RunView> {
    const run = await renameRun(this.opts.outDir, id, name)
    if (run === null) throw new SessionStateError(`기록 ${id} 을(를) 찾지 못했습니다.`)
    return toRunView(run)
  }

  async deleteRun(id: string): Promise<void> {
    const result = await deleteRun(this.opts.outDir, id)
    if (result.deleted) return
    throw new SessionStateError(
      result.reason === 'active'
        ? `${id} 은(는) 지금 측정 중인 세션입니다. 먼저 정지하세요.`
        : `기록 ${id} 을(를) 찾지 못했습니다.`,
    )
  }

  /**
   * 보고서가 읽을 `result.json` 을 **그대로** 돌려준다 (뷰로 옮기지 않는 이유는
   * `contract/api.ts` 의 `ReportDocument` 주석에 있다).
   *
   * **검증하지 않는다.** 여기서 zod 로 걸면 옛 세션(필드가 없던 시절)이 화면에 아예 안 뜨는데,
   * 그것은 보고서가 풀어야 할 문제이지 서버가 막을 문제가 아니다 — 화면은 필드 부재를
   * "수집 안 함" 으로 그리도록 만들어져 있다.
   */
  async report(id: string): Promise<ReportDocument> {
    const run = await findRun(this.opts.outDir, id)
    if (run === null) throw new SessionStateError(`기록 ${id} 을(를) 찾지 못했습니다.`)

    const path = join(run.runDir, 'result.json')
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      // `start` 는 됐는데 `stop` 전이거나 죽은 폴더다. 목록에는 있는데 파일이 없는 상태를
      // "찾지 못했습니다" 로 뭉치면 사람이 엉뚱한 id 를 의심한다.
      throw new SessionStateError(
        `기록 ${id} 에 result.json 이 없습니다. 아직 정지하지 않았거나 추출에 실패한 세션입니다.`,
      )
    }
    return JSON.parse(text) as ReportDocument
  }

  /** 기록뿐 아니라 미완성 폴더까지 지운다. 측정 중인 것은 남긴다 — core 가 그 규칙을 갖는다. */
  async clearRuns(): Promise<ClearRunsResult> {
    const r = await clearRuns(this.opts.outDir)
    return { records: r.records, incomplete: r.incomplete, skippedActive: r.skippedActive }
  }
}

/**
 * 시작 요청 → core 의 시작 옵션. **CLI 의 `start` 가 core 에 넘기는 것과 같은 모양이어야 한다** —
 * 같은 세션을 두 입구가 다르게 열면 안 된다.
 *
 * 진단은 켤 때만 키를 싣는다 (`diagnose: true`). 평소 세션이면 core 로 가는 옵션 객체가 이 칸이
 * 없던 때와 키까지 같다 — core 는 없음과 `false` 를 같게 보지만, 입구에서부터 평소 세션의 모양을
 * 바꾸지 않는다 (DM-2 · DM-1 과 같은 원칙). 요청 본문은 브라우저가 보낸 JSON 이라 `true` 만 믿는다.
 */
export function startOptions(req: StartRequest, outDir: string, now: Date): StartOptions {
  return {
    ...(req.name !== null ? { name: req.name } : {}),
    launch: req.launch,
    // 저장 위치는 서버만 정한다 — 브라우저가 보내던 값을 없앤 이유는 계약의 주석에 있다.
    outDir,
    force: req.force,
    now,
    ...(req.diagnose === true ? { diagnose: true } : {}),
  }
}

/** 화면에 그대로 올릴 한국어 문장으로 바꾼다. core 의 오류는 이미 그런 문장이다. */
export function toErrorMessage(e: unknown): string {
  if (e instanceof PerfTrackerError) return e.message
  return e instanceof Error ? e.message : String(e)
}
