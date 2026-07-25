import { listDevices, selectDevice } from '../device/list.js'
import { readActiveSession, recordAdbViolation } from '../session/state.js'
import { AdbClient } from './client.js'
import { defaultLocateAdbDeps, locateAdb, type LocatedAdb } from './locate.js'
import type { ProcessRunner } from './process.js'

/** 기기 하나를 향한 adb 접근 컨텍스트. 기기 접촉이 필요한 모든 명령이 이걸 받는다. */
export interface AdbContext {
  adb: AdbClient
  serial: string
}

export interface AdbContextOptions {
  /** --adb 로 지정한 실행 파일 경로. */
  adb?: string
  /** -d 로 지정한 대상 serial. */
  device?: string
  /** 활성 세션 포인터를 찾을 홈. 테스트가 주입한다. */
  home?: string
  /** 프로세스 실행기. 테스트가 주입한다. */
  runner?: ProcessRunner
}

/**
 * adb 실행 파일만 찾는다 — 기기 선택 이전 단계.
 * `doctor` 처럼 각 단계의 실패를 던지지 않고 보고해야 하는 경로가 쓴다.
 */
export function createBaseAdb(opts: Pick<AdbContextOptions, 'adb' | 'runner'> = {}): {
  adb: AdbClient
  located: LocatedAdb
} {
  const located = locateAdb(opts.adb, defaultLocateAdbDeps())
  return {
    adb: new AdbClient({
      adbPath: located.path,
      ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
    }),
    located,
  }
}

/**
 * adb 탐색 → 기기 선택 → **활성 세션이 있으면 측정 창 개방**.
 *
 * 마지막 단계가 규칙 1 을 관례가 아니라 구조로 만든다. 창은 프로세스 메모리 안에 있으므로,
 * `start` 가 끝나고 그 프로세스가 죽으면 래치도 함께 사라진다. 새 프로세스가 포인터를 읽고
 * 창을 복원해야 `stop` 을 제외한 모든 기기 접촉이 `MeasurementWindowViolationError` 로 막힌다.
 * `stop` 은 자기가 명시적으로 창을 닫으므로 정상 동작한다.
 *
 * 기기 목록 조회(`adb devices -l`)는 창 **밖**이다 — 어느 세션이 활성인지 알려면 먼저
 * 어느 기기를 상대하는지 정해야 하고, 그 한 번의 호출은 기기의 앱이 아니라 adb 데몬을 향한다.
 */
export async function createAdbContext(opts: AdbContextOptions = {}): Promise<AdbContext> {
  const { adb: base } = createBaseAdb(opts)
  const device = selectDevice(await listDevices(base), opts.device)
  const adb = base.withSerial(device.serial)

  if ((await readActiveSession(device.serial, opts.home)) !== null) {
    adb.window.open(() => recordAdbViolation(device.serial, opts.home))
  }

  return { adb, serial: device.serial }
}

/** 지금 이 기기에 측정 세션이 진행 중인지. 기기에 접촉하지 않는다. */
export async function hasActiveSession(serial: string, home?: string): Promise<boolean> {
  return (await readActiveSession(serial, home)) !== null
}
