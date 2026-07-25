import { AdbClient, defaultLocateAdbDeps, listDevices, locateAdb, selectDevice } from '@perftracker/core'

export interface CliContext {
  adb: AdbClient
  serial: string
}

/** adb 탐색 → 기기 선택까지의 공통 경로. 모든 기기 접촉 명령이 여기서 시작한다. */
export async function createContext(opts: { adb?: string; device?: string }): Promise<CliContext> {
  const located = locateAdb(opts.adb, defaultLocateAdbDeps())
  const base = new AdbClient({ adbPath: located.path })
  const device = selectDevice(await listDevices(base), opts.device)
  return { adb: base.withSerial(device.serial), serial: device.serial }
}
