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
 */
export async function listDeviceSummaries(opts: AdbContextOptions = {}): Promise<DeviceSummary[]> {
  const { adb: base } = createBaseAdb(opts)
  const devices = await listDevices(base)

  const summaries: DeviceSummary[] = []
  for (const d of devices) {
    const model = d.model ?? null
    if (d.state !== 'device') {
      summaries.push({ serial: d.serial, state: d.state, model, spec: null, measurementInProgress: false })
      continue
    }

    if (await hasActiveSession(d.serial, opts.home)) {
      summaries.push({ serial: d.serial, state: d.state, model, spec: null, measurementInProgress: true })
      continue
    }

    summaries.push({
      serial: d.serial,
      state: d.state,
      model,
      spec: await collectDeviceStatic(base.withSerial(d.serial)),
      measurementInProgress: false,
    })
  }
  return summaries
}
