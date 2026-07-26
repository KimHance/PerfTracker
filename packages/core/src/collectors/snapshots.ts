import { PerfettoSessionError } from '../errors.js'

/**
 * 스냅샷 명령의 **유일한 소유자**. `collectors/blocks.ts` 가 perfetto 데이터소스 블록에
 * 대해 하는 일을, 이 파일이 `dumpsys` 계열 전/후 스냅샷에 대해 한다.
 *
 * 왜 collector 안이 아니라 여기인가: 두 collector 가 같은 명령을 필요로 하는 날이
 * 반드시 온다(예: Power 가 `dumpsys battery` 를 원하는 경우). 그때 각자 자기 문자열을
 * 들고 있으면 같은 명령이 두 번 기기로 나가거나, 한쪽이 조용히 이겨서 "어떤 명령으로
 * 찍었는가" 가 결과에서 사라진다. 여기 상수 하나를 공유하면 병합 예외가
 * "정상적인 공유" 가 아니라 "누가 상수를 복사해 고쳤다" 는 신호로만 남는다.
 */
export interface SnapshotSpec {
  /**
   * `raw/<key>_before.txt` / `raw/<key>_after.txt` 의 key. **전역 유일해야 한다.**
   * `_before` / `_after` 로 끝나면 안 된다 (경로 규약과 충돌한다).
   */
  key: string
  /** `adb shell` 로 실행할 명령. `tryShell` 로 돌리므로 실패는 빈 문자열이 된다. */
  command: string
}

/** key 하나의 전/후 원문. 파일이 없거나 명령이 실패했으면 그 자리는 null 이다. */
export interface SnapshotPair {
  before: string | null
  after: string | null
}

/**
 * `collectDeviceState()` 가 이미 소유하고 있는 key 들.
 * collector 가 이 이름을 다시 선언하면 같은 파일을 두 번 쓰고 명령도 두 번 나간다.
 * **읽는 쪽은 이 목록을 보지 않는다** — `readSnapshots` 는 `artifacts.raw` 에 있는
 * 모든 key 를 그대로 노출하므로, thermal collector 는 선언 없이 `thermalservice` 를 읽는다.
 */
export const DEVICE_STATE_KEYS = [
  'battery',
  'thermalservice',
  'settings',
  'meminfo',
  'iproute',
] as const

/** Network collector 가 쓴다. `--uid` 를 주지 않는 이유는 M3 계획서 D6 에 있다. */
export const NETSTATS_SNAPSHOT: SnapshotSpec = { key: 'netstats', command: 'dumpsys netstats' }

/**
 * uid → 패키지 매핑. Network 의 숫자가 uid 단위라는 한정을 **사실로** 바꾸기 위해 찍는다
 * (같은 uid 를 몇 개의 패키지가 쓰는지). 시스템 패키지까지 나오도록 `-3` 을 주지 않는다.
 */
export const PACKAGE_UIDS_SNAPSHOT: SnapshotSpec = { key: 'packages', command: 'pm list packages -U' }

/**
 * 규칙은 `mergeTraceConfigBlocks` 와 같다: **같은 key 는 완전히 같은 command 로만
 * 요청할 수 있다.** 같으면 하나로 접고, 다르면 던진다.
 */
export function mergeSnapshotSpecs(specs: SnapshotSpec[]): SnapshotSpec[] {
  const byKey = new Map<string, string>()
  const out: SnapshotSpec[] = []

  for (const spec of specs) {
    if ((DEVICE_STATE_KEYS as readonly string[]).includes(spec.key)) {
      throw new PerfettoSessionError(
        `스냅샷 key "${spec.key}" 는 collectDeviceState() 가 이미 소유한 이름입니다. ` +
          `collector 가 다시 선언하면 같은 명령이 두 번 기기로 나갑니다 — ` +
          `그 원문은 선언 없이 CaptureFacts.snapshots 로 이미 들어옵니다.`,
      )
    }
    if (/_(before|after)$/.test(spec.key)) {
      throw new PerfettoSessionError(
        `스냅샷 key "${spec.key}" 는 _before / _after 로 끝날 수 없습니다 — ` +
          `raw/<key>_<phase>.txt 규약과 충돌합니다.`,
      )
    }

    const seen = byKey.get(spec.key)
    if (seen === undefined) {
      byKey.set(spec.key, spec.command)
      out.push(spec)
      continue
    }
    if (seen !== spec.command) {
      throw new PerfettoSessionError(
        `스냅샷 key "${spec.key}" 를 서로 다른 명령으로 두 번 요청했습니다. ` +
          `같은 key 는 같은 명령이어야 합니다.\n  A: ${seen}\n  B: ${spec.command}`,
      )
    }
  }

  return out
}

/**
 * `raw/<key>_<phase>.txt` 에서 key 와 phase 를 뽑는다.
 * 경로 구분자를 둘 다 받는다 — `artifacts.raw` 는 `join()` 이 만든 문자열을 그대로 담는다.
 *
 * key 자리를 `.+` 가 아니라 `[^\\/]+` 로 쓰는 것이 요점이다. `.+` 는 구분자까지 삼켜서
 * `raw/thermalservice_before.txt` 의 key 를 `raw/thermalservice` 로 만든다 — 디렉토리
 * 이름이 key 에 섞여 들어가고, 그 상태로 통과시키면 `readSnapshots` 가 존재하지 않는
 * key 를 지어낸다. 문자 클래스가 그 가능성 자체를 없앤다.
 */
export function parseSnapshotRawPath(rel: string): { key: string; phase: 'before' | 'after' } | null {
  const m = /(?:^|[\\/])([^\\/]+)_(before|after)\.txt$/.exec(rel)
  if (m === null) return null
  return { key: m[1]!, phase: m[2] as 'before' | 'after' }
}

/**
 * 빈 원문은 **없는 것과 같다.** `tryShell` 이 명령 실패를 빈 문자열로 흡수하므로
 * "파일이 없다" 와 "빈 파일이 있다" 를 같은 뜻으로 다뤄야 한다.
 * 이걸 구분하려 들면 collector 가 `snapshot_unavailable` 대신
 * `snapshot_unparsable` 를 내게 되고, 그건 "형식이 달랐다" 는 **없던 사실**이 된다.
 */
export function snapshotText(raw: string): string | null {
  return raw.trim().length === 0 ? null : raw
}
