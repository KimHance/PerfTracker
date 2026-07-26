import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessRunner } from '../adb/process.js'
import { frameCollector } from '../collectors/frame.js'
import { COLLECTORS } from '../collectors/registry.js'
import type {
  BaseExtractContext,
  CaptureFacts,
  Collector,
  ExtractOutcome,
} from '../collectors/types.js'
import { SchemaValidationError, SessionStateError } from '../errors.js'
import { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import { ensureTraceProcessor } from '../perfetto/traceProcessor/locate.js'
import { REFERENCES } from '../schema/references.js'
import { type MetricReason, renderReason } from '../schema/reasons.js'
import {
  FrameDataSchema,
  type MetricResult,
  type MetricStatus,
  type Result,
  ResultSchema,
  SCHEMA_VERSION,
} from '../schema/result.js'
import { type CaptureManifest, parseVersionedJson, readCaptureManifest } from '../session/manifest.js'
import type { ActiveSession } from '../session/state.js'
import { computeOverhead } from './overhead.js'

export const BUFFER_STATS_SQL =
  "select json_group_array(json_object('name', name, 'value', value)) as j from stats " +
  "where name like 'traced_buf%' and value > 0 and severity in ('error','data_loss')"

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
): Promise<MetricResult<unknown>> {
  // 지원 판정을 트레이스 유무보다 **먼저** 본다. "이 기기가 이 메트릭을 못 낸다" 는
  // "이 run 에 트레이스가 없다" 보다 강하고 안정적인 사실이다.
  const support = collector.supports(manifest.env)
  if (!support.supported) return metric('unsupported', collector.source, support.reason)

  const base: BaseExtractContext = {
    packageName: manifest.target_app.package,
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
  const endedAt = session.endedAt !== undefined ? new Date(session.endedAt) : startedAt

  const tracePath = manifest.artifacts.trace !== null ? join(runDir, manifest.artifacts.trace) : null
  const traceReady = tracePath !== null && (await exists(tracePath))

  let tp: TraceProcessor | null = null
  let bufferOverrun = false

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
  }

  // 레지스트리를 순회한다 — collector 를 배열에 넣기만 하면 되고, 한 메트릭이 터져도
  // 나머지는 정상 산출된다.
  const metrics: Record<string, MetricResult<unknown>> = {}
  for (const collector of COLLECTORS) {
    metrics[collector.id] = await runCollector(collector, tp, manifest, capture)
  }

  if (tp !== null) {
    // 버퍼가 넘쳤는지는 사실로 기록한다 — 잘린 데이터를 정상인 척 내보내지 않는다.
    try {
      const stats = await tp.queryJson<{ name: string; value: number }[]>(BUFFER_STATS_SQL)
      bufferOverrun = stats.length > 0
    } catch {
      bufferOverrun = false
    }
  }

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
    tool: { name: 'perftracker', version: opts.toolVersion ?? '0.1.0' },
    session: {
      id: session.id,
      name: session.name,
      state: sessionState,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      options: session.options,
    },
    device: {
      serial: manifest.device.serial,
      static: manifest.device.static,
      state_before: manifest.device.state_before,
      state_after: manifest.device.state_after,
    },
    // frame 이 렌더 프로세스를 특정했으면 여기서 채운다 — 손에 쥐고도 안 쓰던 값이다.
    target_app: frameData.success
      ? { ...manifest.target_app, render_process: frameData.data.process, pid: frameData.data.pid }
      : manifest.target_app,
    // 키는 collector.id 다. 스키마가 frame 을 알고 나머지는 MetricResult 모양으로 검증한다.
    metrics: metrics as Result['metrics'],
    measurement_overhead: {
      tracing_processes_cpu_time_ms: overhead.cpuTimeMs,
      tracing_processes_cpu_share_pct: overhead.cpuSharePct,
      tracing_processes_peak_rss_kb: overhead.peakRssKb,
      adb_commands_during_session: manifest.adb_commands_during_session,
      trace_buffer_overrun: bufferOverrun,
    },
    references: REFERENCES,
    warnings:
      sessionState === 'running'
        ? [
            ...manifest.warnings,
            {
              code: 'session_still_running',
              message: '아직 stop 하지 않은 세션입니다 — 이 결과는 회수 전 부분 상태입니다.',
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
