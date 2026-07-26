import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdbClient } from '../../src/adb/client.js'
import type { ActiveSession } from '../../src/session/state.js'
import type { TargetApp } from '../../src/schema/result.js'
import { FakeProcessRunner } from './fakeProcessRunner.js'

export const SERIAL = 'S1'
export const PKG = 'com.nhn.android.webtoon'

/**
 * `perfetto --query` 가 내는 표에서 프레임 수집에 필요한 줄만 남긴 최소 응답.
 * 등록되지 않은 명령은 FakeProcessRunner 가 exit 127 을 내고, 스냅샷 수집기들은
 * 그것을 흡수해 기본값으로 남긴다 — 오케스트레이션 순서를 보는 데는 그걸로 충분하다.
 */
const PERFETTO_QUERY = [
  'NAME                                     PRODUCER',
  'android.surfaceflinger.frametimeline     /system/bin/surfaceflinger (4)',
  'linux.process_stats                      perfetto.traced_probes (2)',
  'linux.sys_stats                          perfetto.traced_probes (2)',
  '',
].join('\n')

export function targetApp(overrides: Partial<TargetApp> = {}): TargetApp {
  return {
    package: PKG,
    label: '네이버 웹툰',
    label_source: 'apk_resources',
    version_name: '2.46.0',
    version_code: 24600400,
    uid: 10359,
    install_source: 'com.android.vending',
    launcher_activity: 'com.naver.webtoon.splash.SplashActivity',
    render_process: null,
    pid: null,
    ...overrides,
  }
}

/** start 가 통과할 만큼만 응답하는 기기. 나머지는 흡수된다. */
export function startableDevice(overrides: (r: FakeProcessRunner) => void = () => {}): FakeProcessRunner {
  const runner = new FakeProcessRunner()
    .on(`-s ${SERIAL} shell which perfetto`, { stdout: '/system/bin/perfetto\n' })
    .on(`-s ${SERIAL} shell perfetto --query`, { stdout: PERFETTO_QUERY })
    .on(`-s ${SERIAL} shell getprop ro.build.version.sdk`, { stdout: '36\n' })
    .on(`-s ${SERIAL} shell am force-stop '${PKG}'`, {})
    .onMatch(/--detach=perftracker_/, { stderr: 'Connected to the Perfetto traced service\n' })
    .onMatch(/shell am start -W -n /, {
      stdout: 'Status: ok\nLaunchState: COLD\nTotalTime: 1842\n',
    })
    .on(`-s ${SERIAL} shell pidof '${PKG}'`, { stdout: '24193\n' })

  overrides(runner)
  return runner
}

/**
 * stop 이 통과할 만큼만 응답하는 기기.
 * `probe` 는 원격 트레이스 확인의 세 가지 답에 대응한다:
 *   present / absent / unknown(= 명령 자체가 실패해 아무 마커도 못 받음).
 */
export function stoppableDevice(
  session: ActiveSession,
  opts: {
    detached?: boolean
    pullFails?: boolean
    probe?: 'present' | 'absent' | 'unknown'
  } = {},
): FakeProcessRunner {
  const probe = opts.probe ?? 'present'
  const probeResponse =
    probe === 'present'
      ? { stdout: '__present__\n' }
      : probe === 'absent'
        ? { stdout: '__absent__\n' }
        : { code: 1, stderr: 'error: device offline\n' }

  const runner = new FakeProcessRunner()
    .on(`-s ${SERIAL} shell perfetto --is_detached=${session.perfettoKey}`, {
      code: opts.detached === false ? 2 : 0,
    })
    .on(`-s ${SERIAL} shell perfetto --attach=${session.perfettoKey} --stop`, {})
    .on(
      `-s ${SERIAL} shell [ -s ${session.remoteTracePath} ] && echo __present__ || echo __absent__`,
      probeResponse,
    )
    .on(`-s ${SERIAL} shell rm -f ${session.remoteTracePath}`, {})

  const local = join(session.runDir, 'trace.perfetto-trace')
  runner.on(
    `-s ${SERIAL} pull ${session.remoteTracePath} ${local}`,
    opts.pullFails === true
      ? { code: 1, stderr: 'adb: error: failed to copy: Broken pipe\n' }
      : { stdout: '1 file pulled, 0 skipped.\n' },
  )

  return runner
}

export function clientFor(runner: FakeProcessRunner): AdbClient {
  return new AdbClient({ adbPath: '/fake/adb', runner }).withSerial(SERIAL)
}

export function tempDirs(): { home: string; out: string } {
  return {
    home: mkdtempSync(join(tmpdir(), 'pt-home-')),
    out: mkdtempSync(join(tmpdir(), 'pt-out-')),
  }
}
