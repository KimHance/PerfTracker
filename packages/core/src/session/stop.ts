import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AdbClient } from '../adb/client.js'
import { collectSnapshotSpecs } from '../collectors/registry.js'
import { collectDeviceState, runSnapshots } from '../device/state.js'
import { SessionStateError } from '../errors.js'
import {
  isSessionDetached,
  probeRemoteTrace,
  pullTrace,
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
 *
 * `aborted` 는 **세 가지를 모두 확인한 뒤에만** 선언한다:
 *   1. detached 세션이 없다
 *   2. 기기에 파일이 없다 — "확인 실패" 가 아니라 확실히 없다 (`probeRemoteTrace`)
 *   3. run 디렉토리에도 이미 회수된 파일이 없다
 * 이 중 하나라도 못 지키면 도구가 멀쩡한 캡처의 참조를 스스로 버리게 된다.
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

  const localTrace = join(session.runDir, TRACE_FILE)

  let traceOnDevice: boolean
  if (await isSessionDetached(ctx.adb, session.perfettoKey)) {
    await stopDetachedSession(ctx.adb, session.perfettoKey)
    traceOnDevice = true
  } else {
    // 앞선 stop 시도가 세션을 이미 멈췄을 수 있다. 그 경우 기기의 파일이 유일한 정본이다.
    const probe = await probeRemoteTrace(ctx.adb, session.remoteTracePath)
    if (probe === 'unknown') {
      // 기기가 흔들리는 중이다. 여기서 "없다"고 단정하면 멀쩡한 트레이스의 참조를 버린다.
      throw new SessionStateError(
        `기기에 트레이스가 남아 있는지 확인하지 못했습니다. 세션 정보를 그대로 두었습니다.\n` +
          `  기기 경로  ${session.remoteTracePath}\n` +
          `  run 디렉토리 ${session.runDir}\n` +
          `USB 연결을 확인한 뒤 perftracker stop 을 다시 실행하면 이 지점부터 재개됩니다.`,
      )
    }
    traceOnDevice = probe === 'present'
  }

  if (traceOnDevice) {
    try {
      await pullTrace(ctx.adb, session.remoteTracePath, localTrace)
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
  } else if (existsSync(localTrace)) {
    // 기기에 없는데 여기에는 있다 ⇒ 앞선 시도가 pull 과 rm 까지 끝내고 매니페스트를 쓰기 전에
    // 죽었다는 뜻이다 (Ctrl-C, after 스냅샷 쓰기 실패 등). 이미 회수된 캡처다.
    // 기기 확인을 **먼저** 하는 순서가 중요하다 — pull 이 중간에 끊겨 잘린 파일이 남은
    // 경우에는 원격 파일이 아직 있으므로 위 분기에서 다시 받는다.
    traceRelative = TRACE_FILE
  } else {
    state = 'aborted'
  }

  // 트레이서가 이미 멈춘 뒤이므로 이 명령들도 트레이스에 남지 않는다.
  // `manifest.env` 를 쓰는 것이 중요하다 — stop 은 `probeDevice` 를 다시 부르지 않는다.
  // 다시 부르면 기기 접촉이 하나 늘고, 그 사이 기기가 바뀌었다면 before/after 가
  // 서로 다른 명세로 찍힌다. 캡처 당시의 env 가 정본이다.
  const after = await collectDeviceState(ctx.adb, now)
  const afterSnapshots = await runSnapshots(ctx.adb, collectSnapshotSpecs(manifest.env))
  const rawFiles = [...manifest.artifacts.raw]
  for (const [key, text] of Object.entries({ ...after.raw, ...afterSnapshots })) {
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
