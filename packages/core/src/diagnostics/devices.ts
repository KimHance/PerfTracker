import { type AdbContextOptions, createBaseAdb, hasActiveSession } from '../adb/context.js'
import { type DeviceEntry, listDevices } from '../device/list.js'
import { collectDeviceStatic } from '../device/spec.js'
import type { DeviceStatic } from '../schema/result.js'

export interface DeviceSummary {
  serial: string
  state: DeviceEntry['state']
  model: string | null
  /** 측정 세션 중이거나 기기가 쓸 수 없는 상태면 null. */
  spec: DeviceStatic | null
  /** 측정 세션이 진행 중이라 스펙 조회를 건너뛴 경우 true (규칙 1). */
  measurementInProgress: boolean
}

/**
 * 연결된 기기와 스펙. 포맷팅이 아니라 수집이라 core 에 있고, 문자열이 아니라 데이터를 낸다.
 * 측정 중인 기기는 건드리지 않는다 — 기기 목록을 보려고 측정을 오염시킬 수는 없다.
 *
 * **기기끼리는 나란히 훑는다.** 한 대의 스펙 수집은 `getprop` · cpufreq · meminfo · `wm size` ·
 * `dumpsys display` 로 여러 왕복이라, 기기 수만큼 곱하면 눈에 띄게 느려진다
 * (실측: 2대 순차 1,532ms — GUI 에서 기기 목록 새로고침이 2초였던 것의 대부분이 여기였다).
 *
 * 서로 다른 기기를 동시에 만지는 것은 규칙 1 과 무관하다 — 그 규칙은 **한 기기의 측정 창**
 * 안에서 그 기기를 건드리지 말라는 것이고, 측정 중인 기기는 애초에 이 경로에서 빠진다.
 * 순서는 `listDevices` 가 준 대로 유지된다 (`Promise.all` 은 입력 순서를 지킨다).
 */
export async function listDeviceSummaries(opts: AdbContextOptions = {}): Promise<DeviceSummary[]> {
  const { adb: base } = createBaseAdb(opts)
  const devices = await listDevices(base)

  return Promise.all(
    devices.map(async (d): Promise<DeviceSummary> => {
      const model = d.model ?? null
      if (d.state !== 'device') {
        return { serial: d.serial, state: d.state, model, spec: null, measurementInProgress: false }
      }

      if (await hasActiveSession(d.serial, opts.home)) {
        return { serial: d.serial, state: d.state, model, spec: null, measurementInProgress: true }
      }

      return {
        serial: d.serial,
        state: d.state,
        model,
        spec: await collectDeviceStatic(base.withSerial(d.serial)),
        measurementInProgress: false,
      }
    }),
  )
}
