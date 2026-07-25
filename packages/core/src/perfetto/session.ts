import type { AdbClient } from '../adb/client.js'
import { PerfettoSessionError } from '../errors.js'

const TRACE_DIR = '/data/misc/perfetto-traces'

export function remoteTracePath(key: string): string {
  return `${TRACE_DIR}/${key}.pftrace`
}

/**
 * --detach 로 띄우면 traced 가 독립적으로 살아남아 adb shell 이 끊겨도 계속 기록한다.
 * 도구가 아무것도 붙잡고 있을 필요가 없어지므로, 측정 창 안에서 adb 왕복이 0회가 된다.
 */
export async function startDetachedSession(
  adb: AdbClient,
  args: { key: string; remotePath: string; configText: string },
): Promise<void> {
  const command = `rm -f ${args.remotePath}; perfetto -c - --txt -o ${args.remotePath} --detach=${args.key}`
  const r = await adb.raw(['shell', command], { input: args.configText })

  if (r.code !== 0) {
    throw new PerfettoSessionError(`Perfetto 세션을 시작하지 못했습니다.\n${r.stderr.trim()}`)
  }
}

/** 종료 코드로 판정한다: 0 = 세션 있음, 그 외 = 없음. */
export async function isSessionDetached(adb: AdbClient, key: string): Promise<boolean> {
  const r = await adb.raw(['shell', `perfetto --is_detached=${key}`])
  return r.code === 0
}

export async function stopDetachedSession(adb: AdbClient, key: string): Promise<void> {
  const r = await adb.raw(['shell', `perfetto --attach=${key} --stop`])
  if (r.code !== 0) {
    throw new PerfettoSessionError(
      `Perfetto 세션(${key})에 붙지 못했습니다. 기기가 재부팅되었거나 세션이 사라졌을 수 있습니다.\n${r.stderr.trim()}`,
    )
  }
}

export async function pullTrace(adb: AdbClient, remotePath: string, localPath: string): Promise<void> {
  const r = await adb.raw(['pull', remotePath, localPath])
  if (r.code !== 0) {
    throw new PerfettoSessionError(`트레이스를 회수하지 못했습니다.\n${r.stderr.trim()}`)
  }
}

/** 회수 성공을 확인한 뒤에만 호출한다. */
export async function removeRemoteTrace(adb: AdbClient, remotePath: string): Promise<void> {
  await adb.raw(['shell', `rm -f ${remotePath}`])
}
