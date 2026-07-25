import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { collectDeviceState } from '../device/state.js'
import { isSessionDetached, pullTrace, removeRemoteTrace, stopDetachedSession } from '../perfetto/session.js'
import { readCaptureManifest, writeCaptureManifest } from './manifest.js'
import { type ActiveSession, clearActiveSession, writeRunSession } from './state.js'

const TRACE_FILE = 'trace.perfetto-trace'

/**
 * 측정 창을 먼저 닫고 나서 기기와 다시 대화한다.
 * 세션이 사라졌으면 부분 데이터를 정상인 척 내보내지 않고 aborted 로 남긴다.
 */
export async function stopSession(
  ctx: { adb: AdbClient; serial: string },
  session: ActiveSession,
  now: Date,
  home?: string,
): Promise<{ runDir: string; state: 'completed' | 'aborted' }> {
  const adbCallsDuringSession = ctx.adb.window.adbCallsWhileOpen
  ctx.adb.window.close()

  const manifest = await readCaptureManifest(session.runDir)
  let state: 'completed' | 'aborted' = 'completed'
  let traceRelative: string | null = null

  if (await isSessionDetached(ctx.adb, session.perfettoKey)) {
    await stopDetachedSession(ctx.adb, session.perfettoKey)
    await pullTrace(ctx.adb, session.remoteTracePath, join(session.runDir, TRACE_FILE))
    await removeRemoteTrace(ctx.adb, session.remoteTracePath)
    traceRelative = TRACE_FILE
  } else {
    state = 'aborted'
  }

  const after = await collectDeviceState(ctx.adb, now)
  const rawFiles = [...manifest.artifacts.raw]
  for (const [key, text] of Object.entries(after.raw)) {
    const rel = join('raw', `${key}_after.txt`)
    await writeFile(join(session.runDir, rel), text, 'utf8')
    rawFiles.push(rel)
  }

  const warnings = [...manifest.warnings]
  if (state === 'aborted') {
    warnings.push({
      code: 'trace_session_lost',
      message: 'Perfetto 세션이 사라져 트레이스를 회수하지 못했습니다 (기기 재부팅 등).',
    })
  }

  await writeCaptureManifest(session.runDir, {
    ...manifest,
    device: { ...manifest.device, state_after: after.state },
    warnings,
    adb_commands_during_session: adbCallsDuringSession,
    artifacts: { ...manifest.artifacts, trace: traceRelative, raw: rawFiles },
  })
  await writeRunSession(session.runDir, session, { endedAt: now.toISOString(), state })
  await clearActiveSession(session.serial, home)

  return { runDir: session.runDir, state }
}
