import type { AdbClient } from '../adb/client.js'
import { PerfettoSessionError } from '../errors.js'

const TRACE_DIR = '/data/misc/perfetto-traces'

/**
 * pull 은 세션 길이에 비례해 커진 파일을 옮긴다 (30분 세션이면 수 MB~수십 MB).
 * ProcessRunner 의 60초 기본 타임아웃을 상속하면 긴 세션에서 회수가 실패하므로 직접 넉넉히 준다.
 */
export const PULL_TIMEOUT_MS = 900_000

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

/** 기기에 회수 대기 중인 트레이스가 있는지 — 그리고 "모르겠다"를 별도의 답으로 갖는다. */
export type RemoteTraceProbe = 'present' | 'absent' | 'unknown'

/**
 * 기기에 회수 대기 중인 트레이스가 남아 있는지 본다.
 * detached 세션이 없다고 해서 트레이스가 없는 것은 아니다 — 앞선 stop 시도가 세션만 멈추고
 * pull 에서 실패했을 수 있고, 그 경우 이 파일이 유일한 정본이다.
 *
 * **양쪽 분기에서 마커를 낸다.** 한쪽에만 마커를 두면 빈 stdout 이 "파일 없음" 과
 * "명령이 실패했음" 을 구분하지 못한다. 흔들리는 기기에서는 이 프로브와 `isSessionDetached`
 * 가 함께 실패하므로, 그 모호함이 곧 "트레이스 없음 ⇒ aborted ⇒ 참조 폐기" 로 이어진다.
 * 그건 C1 이 Critical 이었던 바로 그 손실이다. 모르면 모른다고 답한다.
 *
 * exit code 대신 stdout 마커로 판정한다 (adb shell 의 종료 코드 전달이 기기마다 다르다).
 */
export async function probeRemoteTrace(adb: AdbClient, remotePath: string): Promise<RemoteTraceProbe> {
  const r = await adb.raw(['shell', `[ -s ${remotePath} ] && echo __present__ || echo __absent__`])
  if (r.stdout.includes('__present__')) return 'present'
  if (r.stdout.includes('__absent__')) return 'absent'
  return 'unknown'
}

export async function pullTrace(adb: AdbClient, remotePath: string, localPath: string): Promise<void> {
  const r = await adb.raw(['pull', remotePath, localPath], { timeoutMs: PULL_TIMEOUT_MS })
  if (r.code !== 0) {
    throw new PerfettoSessionError(`트레이스를 회수하지 못했습니다.\n${r.stderr.trim()}`)
  }
}

/** 회수 성공을 확인한 뒤에만 호출한다. */
export async function removeRemoteTrace(adb: AdbClient, remotePath: string): Promise<void> {
  await adb.raw(['shell', `rm -f ${remotePath}`])
}
