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
  /**
   * 측정 창 안에서 시도된 adb 호출 수. 0 이 아니면 그 데이터는 오염된 것이다.
   *
   * **`stop` 이 쓴 뒤에야 값이 있다.** 세션이 도는 동안의 위반은 활성 세션 포인터에
   * 쌓이고(`recordAdbViolation` — 창은 프로세스 메모리 안에 있으므로 start 와 stop 사이의
   * 다른 프로세스들은 그 파일에만 기록할 수 있다), `stop` 이 그것을 거둬 이 자리로 옮긴다.
   *
   * 그래서 `start` 는 여기에 **null** 을 쓴다. 0 이 아니다 — 이 필드에서 0 은 "세어 봤더니
   * 없었다" 라는 강한 주장이고, start 는 세어 본 적이 없다. `stop` 을 거치지 않은 run 에서
   * `extract` 는 이 자리를 보지 않고 포인터를 직접 읽는다
   * (`extract/run.ts` 의 `countAdbCommands`).
   */
  adb_commands_during_session: number | null
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
