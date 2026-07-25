import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { collectDeviceState } from '../device/state.js'
import { SessionStateError } from '../errors.js'
import {
  isSessionDetached,
  pullTrace,
  remoteTraceExists,
  removeRemoteTrace,
  stopDetachedSession,
} from '../perfetto/session.js'
import { readCaptureManifest, writeCaptureManifest } from './manifest.js'
import { type ActiveSession, clearActiveSession, writeRunSession } from './state.js'

const TRACE_FILE = 'trace.perfetto-trace'

/**
 * 측정 창을 먼저 닫고 나서 기기와 다시 대화한다.
 * 세션이 사라졌으면 부분 데이터를 정상인 척 내보내지 않고 aborted 로 남긴다.
 *
 * **재개 가능성이 이 함수의 핵심 불변식이다.** 기기에서 트레이스가 확정된 뒤에 회수가 실패하면
 * (USB 흔들림, 호스트 디스크, 타임아웃) 포인터와 기기 쪽 트레이스를 **둘 다 남긴 채** 던진다.
 * 그래야 다음 `stop` 이 같은 트레이스를 다시 집을 수 있다. 그 재시도에서는 detached 세션이
 * 이미 멈춰 있으므로 "세션 없음 ⇒ 트레이스 없음" 으로 단정하면 안 된다 — 기기에 파일이
 * 남아 있는지 직접 확인한다.
 */
export async function stopSession(
  ctx: { adb: AdbClient; serial: string },
  session: ActiveSession,
  now: Date,
  home?: string,
): Promise<{ runDir: string; state: 'completed' | 'aborted' }> {
  const adbCallsDuringSession =
    (session.adbCommandsDuringSession ?? 0) + ctx.adb.window.adbCallsWhileOpen
  ctx.adb.window.close()

  const manifest = await readCaptureManifest(session.runDir)
  let state: 'completed' | 'aborted' = 'completed'
  let traceRelative: string | null = null

  let traceOnDevice: boolean
  if (await isSessionDetached(ctx.adb, session.perfettoKey)) {
    await stopDetachedSession(ctx.adb, session.perfettoKey)
    traceOnDevice = true
  } else {
    // 앞선 stop 시도가 세션을 이미 멈췄을 수 있다. 그 경우 기기의 파일이 유일한 정본이다.
    traceOnDevice = await remoteTraceExists(ctx.adb, session.remoteTracePath)
  }

  if (traceOnDevice) {
    try {
      await pullTrace(ctx.adb, session.remoteTracePath, join(session.runDir, TRACE_FILE))
    } catch (e) {
      throw new SessionStateError(
        `트레이스를 회수하지 못했습니다. 기기의 트레이스와 세션 정보는 그대로 두었습니다.\n` +
          `  기기 경로  ${session.remoteTracePath}\n` +
          `  run 디렉토리 ${session.runDir}\n` +
          `perftracker stop 을 다시 실행하면 이 지점부터 재개됩니다.\n\n` +
          `원인: ${(e as Error).message}`,
      )
    }
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
