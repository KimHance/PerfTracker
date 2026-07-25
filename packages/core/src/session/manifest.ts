import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CollectorEnv } from '../collectors/types.js'
import { SessionStateError } from '../errors.js'
import type { DeviceState, DeviceStatic, TargetApp, Warning } from '../schema/result.js'

/**
 * capture.json 의 형식 버전. extract 는 임의의 나중 시점에 옛 run 디렉토리를 읽도록 설계됐으므로,
 * 모르는 버전을 "대충 파싱" 하지 않고 명시적으로 거부한다.
 */
export const CAPTURE_MANIFEST_VERSION = 1

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
  const file = join(runDir, FILE)

  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new SessionStateError(
      `capture 매니페스트를 읽지 못했습니다: ${file}\n` +
        `run 디렉토리가 옮겨졌거나 지워졌을 수 있습니다.`,
    )
  }

  return parseVersionedJson<CaptureManifest>(text, file, CAPTURE_MANIFEST_VERSION, 'capture.json')
}

/**
 * `version` 을 확인한 뒤에만 값을 돌려준다.
 * run 디렉토리는 도구보다 오래 살기 때문에, 모르는 버전을 조용히 잘못 읽는 것이 가장 나쁜 결과다.
 */
export function parseVersionedJson<T extends { version: number }>(
  text: string,
  file: string,
  expected: number,
  label: string,
): T {
  let parsed: T
  try {
    parsed = JSON.parse(text) as T
  } catch {
    throw new SessionStateError(`${label} 이 올바른 JSON 이 아닙니다: ${file}`)
  }

  if (parsed.version !== expected) {
    throw new SessionStateError(
      `${label} 의 version 이 ${JSON.stringify(parsed.version)} 입니다 — 이 도구는 ${expected} 만 읽습니다.\n` +
        `파일: ${file}\n같은 버전의 perftracker 로 다시 시도하세요.`,
    )
  }

  return parsed
}
