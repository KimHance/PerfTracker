import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessRunner } from '../adb/process.js'
import { findPackageUid } from '../app/list.js'
import { frameCollector } from '../collectors/frame/index.js'
import { COLLECTORS } from '../collectors/registry.js'
import { parseSnapshotRawPath, type SnapshotPair, snapshotText } from '../collectors/snapshots.js'
import type {
  BaseExtractContext,
  CaptureFacts,
  Collector,
  ExtractOutcome,
} from '../collectors/types.js'
import { parseThermalZones } from '../device/state.js'
import { SchemaValidationError, SessionStateError } from '../errors.js'
import { collectHostInfo } from '../host/info.js'
import { readTraceWindow } from './traceWindow.js'
import { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import { ensureTraceProcessor } from '../perfetto/traceProcessor/locate.js'
import { REFERENCES } from '../schema/references.js'
import { type MetricReason, renderReason } from '../schema/reasons.js'
import {
  type DeviceState,
  FrameDataSchema,
  type MetricResult,
  type MetricStatus,
  type Result,
  ResultSchema,
  SCHEMA_HELP,
  SCHEMA_VERSION,
} from '../schema/result.js'
import { type CaptureManifest, parseVersionedJson, readCaptureManifest } from '../session/manifest.js'
import { sortedMarks } from '../session/marks.js'
import { type ActiveSession, readActiveSession } from '../session/state.js'
import { computeOverhead } from './overhead.js'

export const BUFFER_STATS_SQL =
  "select json_group_array(json_object('name', name, 'value', value)) as j from stats " +
  "where name like 'traced_buf%' and value > 0 and severity in ('error','data_loss')"

/**
 * `capture.json` 의 `artifacts.raw` 를 훑어 key → {before, after} 를 만든다.
 *
 * **collector 의 선언을 보지 않는다.** 그래서 `dumpsys thermalservice` 처럼
 * `collectDeviceState()` 가 예전부터 찍어 오던 원문도 그대로 들어오고,
 * M3 이전 run 디렉토리가 형식 버전을 올리지 않고도 전부 열린다.
 *
 * 파일을 못 읽으면 그 자리는 null 이다 — run 디렉토리가 옮겨졌거나, 아직 stop 하지 않아
 * `_after` 가 없는 경우다. 둘 다 "모른다" 이지 "0" 이 아니다.
 */
export async function readSnapshots(
  runDir: string,
  rawFiles: string[],
): Promise<Record<string, SnapshotPair>> {
  const out: Record<string, SnapshotPair> = {}
  for (const rel of rawFiles) {
    const parsed = parseSnapshotRawPath(rel)
    if (parsed === null) continue
    const pair = (out[parsed.key] ??= { before: null, after: null })
    try {
      pair[parsed.phase] = snapshotText(await readFile(join(runDir, rel), 'utf8'))
    } catch {
      // 매니페스트에 적혀 있어도 파일이 없을 수 있다. 그건 "모른다" 다.
    }
  }
  return out
}

/**
 * `device.state_*.thermal_zones` 를 raw 원문에서 **다시** 만든다.
 *
 * 왜 필요한가: `extract` 는 지금까지 `capture.json` 의 `device.state_before/after` 를 그대로
 * 옮겼다. 그래서 옛 파서(두 절을 구분 없이 긁어 8존을 15항목으로 만들던 것)로 찍힌 run 은
 * `metrics.thermal.zones` 가 8존을 말하는 **같은 파일 안에서** `device.state_*.thermal_zones`
 * 로는 15항목을 말했다. 같은 센서에 대해 두 숫자를 내는 결과는 소비자에게 모순이다.
 *
 * 왜 정당한가: 이것은 없던 값을 지어내는 것이 아니라 **같은 바이트를 고쳐진 파서로 다시 읽는
 * 것**이다. 원문은 `raw/thermalservice_{before,after}.txt` 에 그대로 남아 있고
 * `artifacts.raw` 에 등재되어 있다. 그리고 "extract 가 더 나은 근거를 쥐면 capture 시점 값을
 * 갱신한다" 는 이 코드베이스의 기존 관행이다 — `target_app.render_process` / `pid` 가 바로
 * 그렇게 채워진다. `capture.json` 은 건드리지 않으므로 캡처 기록 자체는 보존된다.
 *
 * 근거가 없으면 덮지 않는다: 원문이 없거나(옛 run 이 raw 를 안 남겼거나 디렉토리가 옮겨졌다),
 * 원문에서 존이 하나도 안 나오면 매니페스트 값을 그대로 둔다. 그 자리에 빈 배열을 넣으면
 * "센서가 없었다" 는 없던 사실이 된다.
 */
function reparseThermalZones<T extends DeviceState | null>(state: T, raw: string | null): T {
  if (state === null || raw === null) return state
  const zones = parseThermalZones(raw)
  if (zones.length === 0) return state
  return { ...state, thermal_zones: zones }
}

/**
 * 대상 앱의 uid. 매니페스트에 있으면 그것이고, 없으면 **이미 회수해 둔 원문**에서 찾는다.
 *
 * 왜 여기서 다시 구하는가: 캡처 때 uid 를 못 적은 run 이 실재한다 (대상 해석이 서드파티
 * 목록만 보던 시절의 run — 시스템 앱을 대상으로 삼으면 uid 가 null 이었다). 그런데 같은 run
 * 디렉토리의 `raw/packages_{before,after}.txt` 는 `pm list packages -U` 원문이고 거기 답이
 * 있다. 그것을 안 보고 null 을 그대로 실으면 도구가 손에 쥔 답을 두고 "모른다" 고 말한다.
 *
 * 왜 정당한가: 없던 값을 지어내는 것이 아니라 **이 run 이 기기에서 받아 온 바이트를 읽는
 * 것**이다. 기기로 나가는 명령은 0개 늘어난다. "extract 가 더 나은 근거를 쥐면 캡처 시점
 * 값을 갱신한다" 는 이 코드베이스의 기존 관행이기도 하다 — `target_app.render_process` 와
 * `pid` 가 정확히 그렇게 채워진다.
 *
 * 시작 스냅샷을 먼저 본다: 세션 구간에 이 앱이 어떤 uid 였는지가 질문이다.
 * 원문에 그 패키지의 행이 없으면 **null 로 남긴다.** 아무 숫자나 채우는 것이 지어내는 것이다.
 */
function resolveAppUid(manifest: CaptureManifest, capture: CaptureFacts): number | null {
  if (manifest.target_app.uid !== null) return manifest.target_app.uid

  const packages = capture.snapshots['packages']
  const text = packages?.before ?? packages?.after
  return text != null ? findPackageUid(text, manifest.target_app.package) : null
}

/**
 * run 디렉토리의 session.json. `start` 는 `state: 'running'` 을 쓰고 `stop` 이 그것을 덮는다.
 * 진행 중인 run 에 extract 를 돌리는 것은 충분히 있을 법한 사용자 행동이므로 'running' 을 포함한다.
 */
interface StoredSession extends ActiveSession {
  endedAt?: string
  state?: SessionState
}

type SessionState = 'running' | 'completed' | 'aborted' | 'failed'

/** session.json 의 형식 버전. capture.json 과 함께 올라간다. */
export const RUN_SESSION_VERSION = 1

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 코드와 사람용 문장을 한 번에 채운다 — 이 둘이 갈라지지 않게 통과 지점을 하나로 둔다. */
function metric<T>(
  status: MetricStatus,
  source: string,
  reason: MetricReason | null,
  data: T | null = null,
): MetricResult<T> {
  return { status, source, reason_code: reason?.code ?? null, reason: renderReason(reason), data }
}

/** collector 하나를 돌린다. 어떤 실패도 예외로 새어 나가지 않고 MetricResult 가 된다. */
async function runCollector(
  collector: Collector<unknown>,
  tp: TraceProcessor | null,
  manifest: CaptureManifest,
  capture: CaptureFacts,
  appUid: number | null,
): Promise<MetricResult<unknown>> {
  // 지원 판정을 트레이스 유무보다 **먼저** 본다. "이 기기가 이 메트릭을 못 낸다" 는
  // "이 run 에 트레이스가 없다" 보다 강하고 안정적인 사실이다.
  const support = collector.supports(manifest.env)
  if (!support.supported) return metric('unsupported', collector.source, support.reason)

  const base: BaseExtractContext = {
    packageName: manifest.target_app.package,
    appUid,
    env: manifest.env,
    capture,
  }

  try {
    let outcome: ExtractOutcome<unknown>
    if (collector.needsTrace) {
      // 트레이스가 필요 없는 collector 까지 trace_missing 으로 죽이지 않는다 —
      // startup 은 `am start -W` 가 낸 값이라 트레이스 유무와 무관하다.
      if (tp === null) return metric('failed', collector.source, { code: 'trace_missing' })
      outcome = await collector.extract({ ...base, tp })
    } else {
      outcome = await collector.extract(base)
    }

    if (outcome.collected) {
      return outcome.partialReason !== undefined
        ? metric('partial', collector.source, outcome.partialReason, outcome.data)
        : metric('collected', collector.source, null, outcome.data)
    }
    return metric(outcome.status ?? 'partial', collector.source, outcome.reason)
  } catch (e) {
    return metric('failed', collector.source, {
      code: 'query_failed',
      detail: { message: (e as Error).message },
    })
  }
}

/**
 * 측정 창 위반 횟수. **`stop` 을 거친 run 에서만 매니페스트가 정본이다.**
 *
 * 세션이 도는 동안의 위반은 활성 세션 포인터에 쌓이고(`recordAdbViolation` — 창은 프로세스
 * 메모리 안에 있으므로 프로세스를 넘나드는 카운터는 파일에 있어야 한다), 그 값을 매니페스트로
 * 옮기는 것은 `stop` 이다. 그 전까지 매니페스트의 이 자리는 비어 있다(`start` 가 null 을 쓴다).
 *
 * **여기서 `0` 을 내는 것이 최악의 선택이다.** 이 값은 "이 세션 데이터가 오염됐는가" 를
 * 나타내는 바로 그 필드라 `0` 은 소비자에게 **검증된 청정**으로 읽힌다.
 * 거짓 청정 신호는 값을 안 내는 것보다 나쁘다.
 *
 * 그래서 진행 중인 세션에서는 포인터를 직접 읽는다:
 *   - 포인터가 **이 run 의 것**이면(같은 serial + 같은 세션 id) 거기 쌓인 값이
 *     읽는 시점까지의 사실이다. 세션이 아직 열려 있으므로 최종값은 아니다 — 더 늘 수 있다.
 *   - 포인터가 없거나 다른 세션의 것이면(`--force` 로 버려진 세션, 다른 호스트에서 만든
 *     run 디렉토리 등) 셀 방법이 아예 없다. 그때는 `0` 이 아니라 **null** 이다.
 *     기기에 물어보는 길은 없다 — 그 행위 자체가 이 도구가 금지하는 것이다.
 */
async function countAdbCommands(
  state: SessionState,
  session: StoredSession,
  manifest: CaptureManifest,
  home?: string,
): Promise<number | null> {
  if (state !== 'running') return manifest.adb_commands_during_session

  const pointer = await readActiveSession(session.serial, home)
  if (pointer === null || pointer.id !== session.id) return null
  return pointer.adbCommandsDuringSession ?? 0
}

/**
 * run 디렉토리 → result.json. 기기에 접촉하지 않으므로 언제든 다시 돌릴 수 있고,
 * 한 메트릭이 터져도 나머지는 정상 산출된다.
 */
export async function extractRun(
  runDir: string,
  opts: {
    traceProcessorPath?: string
    offline?: boolean
    runner?: ProcessRunner
    toolVersion?: string
    /** 활성 세션 포인터를 찾을 홈. 테스트가 주입한다 (기본값은 `~/.perftracker`). */
    home?: string
  } = {},
): Promise<Result> {
  const sessionFile = join(runDir, 'session.json')
  let sessionText: string
  try {
    sessionText = await readFile(sessionFile, 'utf8')
  } catch {
    throw new SessionStateError(
      `session.json 을 읽지 못했습니다: ${sessionFile}\nrun 디렉토리 경로를 확인하세요.`,
    )
  }
  const session = parseVersionedJson<StoredSession>(
    sessionText,
    sessionFile,
    RUN_SESSION_VERSION,
    'session.json',
  )
  const manifest = await readCaptureManifest(runDir)

  const sessionState: SessionState = session.state ?? 'completed'
  const startedAt = new Date(session.startedAt)
  // `endedAt` 은 `stop` 이 쓴다. 없으면 이 세션은 아직 끝나지 않았다는 뜻이다.
  // 옛 코드는 그 자리에 `startedAt` 을 넣었고, 그 결과 "0ms 동안 돈 세션" 이라는
  // 없던 사실이 만들어졌다 (`ended_at` 은 아직 오지 않은 시각이었다).
  const endedAt = session.endedAt !== undefined ? new Date(session.endedAt) : null
  const adbCommands = await countAdbCommands(sessionState, session, manifest, opts.home)

  const tracePath = manifest.artifacts.trace !== null ? join(runDir, manifest.artifacts.trace) : null
  const traceReady = tracePath !== null && (await exists(tracePath))

  let tp: TraceProcessor | null = null
  // null 로 시작한다 — 아직 아무것도 확인하지 않았다. 여기서 false 로 시작하면
  // 트레이스가 없어 쿼리조차 못 한 run 이 "버퍼는 안 넘쳤다" 고 말하게 된다.
  let bufferOverrun: boolean | null = null

  if (traceReady) {
    const binPath = await ensureTraceProcessor({
      ...(opts.traceProcessorPath !== undefined ? { explicitPath: opts.traceProcessorPath } : {}),
      ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
    })
    tp = new TraceProcessor(binPath, tracePath, opts.runner)
  }

  // capture 단계에서만 알 수 있는 사실. `session.json` 이 이미 갖고 있으므로
  // capture.json 의 버전을 올릴 이유가 없다.
  const capture: CaptureFacts = {
    startup: session.startup ?? null,
    launchRequested: session.options.launch,
    // 이 필드가 없던 시절의 session.json 은 undefined 다 — 그것은 "pid 를 모른다" 와 같다.
    appPid: session.appPid ?? null,
    snapshots: await readSnapshots(runDir, manifest.artifacts.raw),
  }

  const appUid = resolveAppUid(manifest, capture)

  // 레지스트리를 순회한다 — collector 를 배열에 넣기만 하면 되고, 한 메트릭이 터져도
  // 나머지는 정상 산출된다.
  const metrics: Record<string, MetricResult<unknown>> = {}
  for (const collector of COLLECTORS) {
    metrics[collector.id] = await runCollector(collector, tp, manifest, capture, appUid)
  }

  if (tp !== null) {
    // 버퍼가 넘쳤는지는 사실로 기록한다 — 잘린 데이터를 정상인 척 내보내지 않는다.
    try {
      const stats = await tp.queryJson<{ name: string; value: number }[]>(BUFFER_STATS_SQL)
      bufferOverrun = stats.length > 0
    } catch {
      // 쿼리가 터진 것은 "안 넘쳤다" 가 아니라 "확인하지 못했다" 다. null 로 남긴다.
      bufferOverrun = null
    }
  }

  const traceWindow =
    tp !== null
      ? await readTraceWindow(tp, startedAt.getTime(), session.deviceClockSkewMs)
      : { spanMs: null, startOffsetMs: null }

  // 오버헤드는 부가 정보다. 못 재는 것이 result.json 전체를 못 내는 이유가 되면 안 되므로
  // computeOverhead 자체가 절대 던지지 않는다. 트레이스가 없으면 재려는 시도조차 안 한다.
  const overhead =
    tp !== null
      ? await computeOverhead(tp)
      : { cpuTimeMs: null, cpuSharePct: null, peakRssKb: null }

  // 렌더 프로세스는 트레이스를 파싱해야 알 수 있어 capture 단계에서는 null 이었다.
  const frameData = FrameDataSchema.safeParse(metrics[frameCollector.id]?.data)

  const result: Result = {
    schema_version: SCHEMA_VERSION,
    schema_help: SCHEMA_HELP,
    tool: {
      name: 'perftracker',
      version: opts.toolVersion ?? '0.1.0',
      // extract 는 기기 없이도 돌 수 있고(`perftracker extract`), 호스트는 그때도 있다.
      host: collectHostInfo(),
    },
    session: {
      id: session.id,
      name: session.name,
      state: sessionState,
      started_at: startedAt.toISOString(),
      ended_at: endedAt?.toISOString() ?? null,
      duration_ms: endedAt !== null ? endedAt.getTime() - startedAt.getTime() : null,
      // 시계열의 축은 세션 길이가 아니라 **트레이스가 덮은 구간**이다. 마킹을 그 축으로
      // 옮기는 데 필요한 offset 도 여기서 나온다 — 이유는 `extract/traceWindow.ts` 에 있다.
      trace_span_ms: traceWindow.spanMs,
      trace_start_offset_ms: traceWindow.startOffsetMs,
      options: session.options,
      // 사람이 적은 것을 도구가 시간순으로 옮기기만 한다 — 내용은 해석하지 않는다.
      // 값이 없으면 빈 배열이다: "아무도 적지 않았다" 는 확인된 사실이다.
      marks: sortedMarks(session).map((m) => ({ offset_ms: m.offsetMs, label: m.label })),
    },
    device: {
      serial: manifest.device.serial,
      static: manifest.device.static,
      // 원문이 있으면 존 목록을 다시 만든다 — 그래야 이 파일 안에서 metrics.thermal 과
      // 같은 말을 한다. 원문이 없으면 캡처 때 기록된 값을 그대로 옮긴다.
      state_before: reparseThermalZones(
        manifest.device.state_before,
        capture.snapshots['thermalservice']?.before ?? null,
      ),
      state_after: reparseThermalZones(
        manifest.device.state_after,
        capture.snapshots['thermalservice']?.after ?? null,
      ),
    },
    // frame 이 렌더 프로세스를 특정했으면 여기서 채운다 — 손에 쥐고도 안 쓰던 값이다.
    // frame 이 값을 못 냈어도 pid 는 캡처 때 받아 둔 것이 있을 수 있다. 이름은 그렇지 않다 —
    // 렌더 프로세스가 어느 것인지는 트레이스를 봐야만 알 수 있으므로 null 로 남긴다.
    // uid 도 같은 규칙이다: 캡처가 못 적었어도 회수해 둔 원문에 답이 있으면 그것을 싣는다.
    target_app: frameData.success
      ? {
          ...manifest.target_app,
          uid: appUid,
          render_process: frameData.data.process,
          pid: frameData.data.pid,
        }
      : { ...manifest.target_app, uid: appUid, pid: manifest.target_app.pid ?? capture.appPid },
    // 키는 collector.id 다. 스키마가 frame 을 알고 나머지는 MetricResult 모양으로 검증한다.
    metrics: metrics as Result['metrics'],
    measurement_overhead: {
      tracing_processes_cpu_time_ms: overhead.cpuTimeMs,
      tracing_processes_cpu_share_pct: overhead.cpuSharePct,
      tracing_processes_peak_rss_kb: overhead.peakRssKb,
      adb_commands_during_session: adbCommands,
      trace_buffer_overrun: bufferOverrun,
    },
    references: REFERENCES,
    warnings:
      sessionState === 'running'
        ? [
            ...manifest.warnings,
            {
              // 경고와 필드가 서로 다른 말을 하면 안 된다. 이 세션의
              // adb_commands_during_session 은 **최종값이 아니다** — 진행 중 누적이거나,
              // 셀 수 없으면 null 이다. 필드만 읽는 소비자를 위해 같은 사실이 스키마의
              // .describe() 에도 있다 (z.toJSONSchema 는 주석을 못 본다).
              code: 'session_still_running',
              message:
                '아직 stop 하지 않은 세션입니다 — 이 결과는 회수 전 부분 상태이고, ' +
                'measurement_overhead.adb_commands_during_session 은 최종값이 아닙니다 ' +
                '(지금까지의 누적이거나, 셀 수 없으면 null).',
            },
          ]
        : manifest.warnings,
    artifacts: manifest.artifacts,
  }

  const parsed = ResultSchema.safeParse(result)
  if (!parsed.success) {
    // ZodError 를 그대로 올리면 사용자가 스택트레이스를 본다.
    throw new SchemaValidationError(
      `result.json 이 스키마를 통과하지 못했습니다 (${runDir}).\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    )
  }

  const validated = parsed.data
  await writeFile(join(runDir, 'result.json'), `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  return validated
}
