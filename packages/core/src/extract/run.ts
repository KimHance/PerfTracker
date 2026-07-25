import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessRunner } from '../adb/process.js'
import { frameCollector } from '../collectors/frame.js'
import { SchemaValidationError, SessionStateError } from '../errors.js'
import { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import { ensureTraceProcessor } from '../perfetto/traceProcessor/locate.js'
import { REFERENCES } from '../schema/references.js'
import { type MetricReason, renderReason } from '../schema/reasons.js'
import {
  type FrameData,
  type MetricResult,
  type MetricStatus,
  type Result,
  ResultSchema,
  SCHEMA_VERSION,
} from '../schema/result.js'
import { parseVersionedJson, readCaptureManifest } from '../session/manifest.js'
import type { ActiveSession } from '../session/state.js'

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

  let frame: MetricResult<FrameData>
  let bufferOverrun = false

  if (!traceReady) {
    frame = metric('failed', frameCollector.source, { code: 'trace_missing' })
  } else {
    const support = frameCollector.supports(manifest.env)
    const binPath = await ensureTraceProcessor({
      ...(opts.traceProcessorPath !== undefined ? { explicitPath: opts.traceProcessorPath } : {}),
      ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
    })
    const tp = new TraceProcessor(binPath, tracePath, opts.runner)

    if (!support.supported) {
      frame = metric('unsupported', frameCollector.source, support)
    } else {
      try {
        const outcome = await frameCollector.extract({
          tp,
          packageName: manifest.target_app.package,
          env: manifest.env,
        })
        frame =
          outcome.data !== null
            ? metric('collected', frameCollector.source, null, outcome.data)
            : metric('partial', frameCollector.source, outcome)
      } catch (e) {
        frame = metric('failed', frameCollector.source, {
          code: 'query_failed',
          detail: { message: (e as Error).message },
        })
      }
    }

    // 버퍼가 넘쳤는지는 사실로 기록한다 — 잘린 데이터를 정상인 척 내보내지 않는다.
    try {
      const stats = await tp.queryJson<{ name: string; value: number }[]>(BUFFER_STATS_SQL)
      bufferOverrun = stats.length > 0
    } catch {
      bufferOverrun = false
    }
  }

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
    // 렌더 프로세스는 트레이스를 파싱해야 알 수 있으므로 capture 단계에서는 null 이었다.
    // frame 이 그것을 특정했으면 여기서 채운다 — 손에 쥐고도 안 쓰던 값이다.
    target_app:
      frame.data !== null
        ? { ...manifest.target_app, render_process: frame.data.process, pid: frame.data.pid }
        : manifest.target_app,
    metrics: { frame },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: null,
      tracing_processes_cpu_share_pct: null,
      tracing_processes_peak_rss_kb: null,
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
