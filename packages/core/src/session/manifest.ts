import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CollectorEnv } from '../collectors/types.js'
import type { DeviceState, DeviceStatic, TargetApp, Warning } from '../schema/result.js'

/**
 * capture 단계가 남기는 기록. extract 는 기기 없이 이 파일과 원본만 읽는다.
 */
export interface CaptureManifest {
  version: 1
  device: {
    serial: string
    static: DeviceStatic
    state_before: DeviceState
    state_after: DeviceState | null
  }
  target_app: TargetApp
  env: CollectorEnv
  warnings: Warning[]
  /** 측정 창 안에서 시도된 adb 호출 수. 0 이 아니면 그 데이터는 오염된 것이다. */
  adb_commands_during_session: number
  artifacts: { trace: string | null; video: string | null; raw: string[] }
}

const FILE = 'capture.json'

export async function writeCaptureManifest(runDir: string, manifest: CaptureManifest): Promise<void> {
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function readCaptureManifest(runDir: string): Promise<CaptureManifest> {
  return JSON.parse(await readFile(join(runDir, FILE), 'utf8')) as CaptureManifest
}
