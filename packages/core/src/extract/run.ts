import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessRunner } from '../adb/process.js'
import { frameCollector } from '../collectors/frame.js'
import { TraceProcessor } from '../perfetto/traceProcessor/client.js'
import { ensureTraceProcessor } from '../perfetto/traceProcessor/locate.js'
import { REFERENCES } from '../schema/references.js'
import { type FrameData, type MetricResult, type Result, ResultSchema, SCHEMA_VERSION } from '../schema/result.js'
import { readCaptureManifest } from '../session/manifest.js'
import type { ActiveSession } from '../session/state.js'

export const BUFFER_STATS_SQL =
  "select json_group_array(json_object('name', name, 'value', value)) as j from stats " +
  "where name like 'traced_buf%' and value > 0 and severity in ('error','data_loss')"

interface StoredSession extends ActiveSession {
  endedAt?: string
  state?: 'completed' | 'aborted' | 'failed'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function failed(source: string, reason: string): MetricResult<FrameData> {
  return { status: 'failed', source, reason, data: null }
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
  const session = JSON.parse(await readFile(join(runDir, 'session.json'), 'utf8')) as StoredSession
  const manifest = await readCaptureManifest(runDir)

  const startedAt = new Date(session.startedAt)
  const endedAt = session.endedAt !== undefined ? new Date(session.endedAt) : startedAt

  const tracePath = manifest.artifacts.trace !== null ? join(runDir, manifest.artifacts.trace) : null
  const traceReady = tracePath !== null && (await exists(tracePath))

  let frame: MetricResult<FrameData>
  let bufferOverrun = false

  if (!traceReady) {
    frame = failed(frameCollector.source, '트레이스 원본이 없습니다.')
  } else {
    const support = frameCollector.supports(manifest.env)
    // runner 가 주입된 경우(테스트) 실제 프로세스를 띄우지 않으므로 실행 파일 검증을 건너뛴다.
    // runner 가 없는 실사용 경로에서는 ensureTraceProcessor 가 실제 바이너리를 확보/검증한다.
    const binPath =
      opts.runner !== undefined
        ? (opts.traceProcessorPath ?? 'trace_processor')
        : await ensureTraceProcessor({
            ...(opts.traceProcessorPath !== undefined ? { explicitPath: opts.traceProcessorPath } : {}),
            ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
          })
    const tp = new TraceProcessor(binPath, tracePath, opts.runner)

    if (!support.supported) {
      frame = {
        status: 'unsupported',
        source: frameCollector.source,
        reason: support.reason ?? null,
        data: null,
      }
    } else {
      try {
        const data = await frameCollector.extract({
          tp,
          packageName: manifest.target_app.package,
          env: manifest.env,
        })
        frame =
          data !== null
            ? { status: 'collected', source: frameCollector.source, reason: null, data }
            : {
                status: 'partial',
                source: frameCollector.source,
                reason: '대상 앱의 렌더 프로세스를 트레이스에서 찾지 못했습니다.',
                data: null,
              }
      } catch (e) {
        frame = failed(frameCollector.source, (e as Error).message)
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
      state: session.state ?? 'completed',
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
    target_app: manifest.target_app,
    metrics: { frame },
    measurement_overhead: {
      tracing_processes_cpu_time_ms: null,
      tracing_processes_cpu_share_pct: null,
      tracing_processes_peak_rss_kb: null,
      adb_commands_during_session: manifest.adb_commands_during_session,
      trace_buffer_overrun: bufferOverrun,
    },
    references: REFERENCES,
    warnings: manifest.warnings,
    artifacts: manifest.artifacts,
  }

  const validated = ResultSchema.parse(result)
  await writeFile(join(runDir, 'result.json'), `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  return validated
}
