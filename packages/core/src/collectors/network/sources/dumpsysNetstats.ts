import { NETSTATS_SNAPSHOT, PACKAGE_UIDS_SNAPSHOT, type SnapshotSpec } from '../../snapshots.js'

/**
 * **`dumpsys netstats` / `pm list packages -U` 경로.**
 * 이 파일이 아는 것: 원문을 어떻게 읽는가. 모르는 것: 델타를 어떻게 내는가(도메인 계층),
 * 어떤 사유로 값을 포기하는가(조립 계층).
 */
export function networkSnapshotSpecs(): SnapshotSpec[] {
  return [NETSTATS_SNAPSHOT, PACKAGE_UIDS_SNAPSHOT]
}


/**
 * `mAppUidStatsMap` 절이 `dumpsys netstats` 에 찍히기 시작한 것은 **Android 14(sdk 34)** 다.
 * 그 아래에서는 같은 내용이 다른 명령에 있다 (13: `dumpsys connectivity trafficcontroller`,
 * ≤12: `dumpsys netd trafficcontroller`). **M3 는 그 분기를 하지 않는다** — 미지원으로
 * 정직하게 처리하는 쪽이, 원문을 본 적도 없는 두 형식을 추측으로 파싱하는 것보다 낫다.
 */
export const NETWORK_MIN_SDK = 34

/**
 * `mAppUidStatsMap` 표의 머리글. **여기 고정하는 것이 계약이다.**
 *
 * AOSP 의 자바 값 타입 `StatsMapValue` 는 필드 순서가 `rxPackets, rxBytes, txPackets,
 * txBytes` 로 이 머리글과 **다르다.** 머리글을 확인하지 않으면 파서가 조용히 바이트와
 * 패킷을 뒤바꾼 채 통과할 수 있고, 그 숫자가 사실 자리에 앉는다.
 * 이 프로젝트는 실기기(sdk 36)의 원문을 아직 본 적이 없다 — 그래서 특히 그렇다.
 */
export const APP_UID_STATS_HEADER = 'uid rxBytes rxPackets txBytes txPackets'

/** 스냅샷 key. 명령과 함께 `collectors/snapshots.ts` 가 소유한다 — 여기서 복사하지 않는다. */
export const NETSTATS_KEY = NETSTATS_SNAPSHOT.key
export const PACKAGES_KEY = PACKAGE_UIDS_SNAPSHOT.key

/** `mAppUidStatsMap` 표의 한 행. 이름이 dumpsys 머리글과 1:1 이다. */
export interface UidNetStats {
  uid: number
  rxBytes: number
  rxPackets: number
  txBytes: number
  txPackets: number
}

export interface AppUidStatsDump {
  /** 절을 찾았는지. `false` 는 이 안드로이드 버전에 그 절이 없다는 뜻일 수 있다. */
  found: boolean
  /** 표 머리글 원문. 절을 못 찾았으면 null. */
  header: string | null
  /**
   * uid → 값. 같은 uid 가 여러 번 나오면 **마지막 행**이 남는다.
   *
   * **키가 음수일 수 있다.** 실기기(SM-S901N / sdk 36)의 표에 `-253` 행이 있다.
   * 그 값이 무엇을 뜻하는지 이 도구는 모르므로 해석하지 않고 원문 그대로 싣는다 —
   * 대상 앱의 uid 는 `pm` 이 준 음이 아닌 수라 이 항목이 조회에 걸리는 일은 없다.
   */
  byUid: Map<number, UidNetStats>
  /**
   * 실제로 읽어 들인 **행의 수**. `byUid.size` 와 다르다 — 중복 uid 는 맵에서 접히기 때문이다.
   *
   * **0 은 그 자체로 신호다.** 헤더가 맞았는데 행이 0개면 표의 행 모양이 우리 기대와
   * 다르거나 표가 실제로 비어 있다는 뜻이고, 이 도구는 둘을 구분하지 못한다.
   * 실기기 `mAppUidStatsMap` 에는 시스템 uid 가 항상 여럿 있으므로 0행은 사실상 형식 드리프트다.
   */
  rowCount: number
  /**
   * 머리글 **다음** 줄의 원문(우측 공백만 제거). 행을 못 읽었을 때 형식을 진단할 유일한 근거다.
   * 절을 못 찾았거나 다음 줄이 없으면 null.
   */
  firstLine: string | null
  /** 같은 uid 가 **서로 다른 값**으로 두 번 이상 나온 uid 들 (AOSP b/220084230). */
  conflictingUids: number[]
}

/**
 * 표의 한 행. **uid 열만 부호를 받는다.**
 *
 * 왜 부호를 받는가: 실기기(SM-S901N / sdk 36)의 `mAppUidStatsMap` 93행 중 82번째가
 * `-253 151772 1156 2367519 1871` 이다(3회 연속 관측, 같은 자리). uid 열을 `\d+` 로만
 * 읽으면 이 줄이 "행이 아니다" 로 판정되고, 아래의 `break` 가 표 읽기를 거기서 끝낸다 —
 * 뒤따르는 12행(그중 하나는 1.6GB 를 받은 uid 10070)이 통째로 사라진다. 그 12행 안에
 * 대상 앱의 uid 가 있으면 이 도구는 `uid_not_in_netstats` 를 내면서 "트래픽이 없었을 수
 * 있습니다" 라고 말하게 된다 — 관측하지 않은 원인이 사실 자리에 앉는 그 모양이다.
 *
 * 바이트·패킷 열은 부호를 받지 않는다. 그 자리에 음수가 오는 것은 본 적이 없고,
 * 보지 못한 형식까지 미리 받아 주면 형식 드리프트를 조용히 삼키게 된다.
 */
const ROW = /^\s*(-?\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/

/**
 * `dumpsys netstats` 에서 `mAppUidStatsMap` 표를 읽는다.
 *
 * **앵커가 이 함수의 전부다.** 실측(에뮬레이터 API 35)에서 확인한 함정:
 *   - `mAppUidStatsMap` 이라는 문자열이 **두 번** 나온다. `BPF map status:` 절의
 *     `  mAppUidStatsMap: OK` 가 먼저다 → 콜론 뒤가 비어 있는 줄만 앵커로 삼는다.
 *   - `BPF map content:` 라는 머리도 **두 번** 나온다 (`InterfaceMapHelper:` 아래에 하나)
 *     → 그 머리를 앵커로 쓰지 않는다.
 *   - 바로 다음 절(`mStatsMapA` / `mStatsMapB` / `mIfaceStatsMap`)에도 숫자 5열 행이 있다
 *     → 행이 아닌 줄을 만나면 즉시 멈춘다.
 */
export function parseAppUidStats(text: string): AppUidStatsDump {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^\s*mAppUidStatsMap:\s*$/.test(l))
  if (at < 0) {
    return {
      found: false,
      header: null,
      byUid: new Map(),
      rowCount: 0,
      firstLine: null,
      conflictingUids: [],
    }
  }

  let i = at + 1
  while (i < lines.length && lines[i]!.trim().length === 0) i++
  const header = (lines[i] ?? '').trim().replace(/\s+/g, ' ')

  const byUid = new Map<number, UidNetStats>()
  const conflicting = new Set<number>()
  let rowCount = 0

  // 머리글이 기대와 다르면 **한 행도 읽지 않는다.** 컬럼 순서를 추측하는 순간
  // 이 도구는 확인하지 못한 것을 사실로 내보내게 된다.
  if (header === APP_UID_STATS_HEADER) {
    for (let j = i + 1; j < lines.length; j++) {
      const m = ROW.exec(lines[j]!)
      if (m === null) break
      rowCount++
      const row: UidNetStats = {
        uid: Number(m[1]),
        rxBytes: Number(m[2]),
        rxPackets: Number(m[3]),
        txBytes: Number(m[4]),
        txPackets: Number(m[5]),
      }
      const seen = byUid.get(row.uid)
      // 같은 값으로 두 번 찍힌 것은 맵 순회가 재시작됐을 뿐 해가 없다. 값이 다르면
      // 어느 쪽이 맞는지 알 수 없고, 그 사실을 삼키지 않는다.
      if (seen !== undefined && !sameRow(seen, row)) conflicting.add(row.uid)
      byUid.set(row.uid, row)
    }
  }

  const next = lines[i + 1]
  return {
    found: true,
    header: header.length > 0 ? header : null,
    byUid,
    rowCount,
    firstLine: next !== undefined ? next.replace(/\s+$/, '') : null,
    conflictingUids: [...conflicting],
  }
}

function sameRow(a: UidNetStats, b: UidNetStats): boolean {
  return (
    a.rxBytes === b.rxBytes &&
    a.rxPackets === b.rxPackets &&
    a.txBytes === b.txBytes &&
    a.txPackets === b.txPackets
  )
}

/** `pm list packages -U` 의 `package:<name> uid:<n>` 에서 그 uid 를 쓰는 패키지를 모은다. */
export function parsePackageUids(text: string, uid: number): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^package:(\S+)\s+uid:(\d+)/gm)) {
    if (Number(m[2]) === uid) out.push(m[1]!)
  }
  return out
}

/**
 * 안드로이드 uid 규칙: `uid = userId * 100000 + appId`. 기본 사용자는 0, 삼성 시큐어 폴더는
 * 실측 150 이었다. 음수 uid(실기기의 `-253`)는 이 규칙 밖이므로 물어보지 않는다.
 */
const ANDROID_USER_ID_STRIDE = 100_000

export function androidUserIdOf(uid: number): number {
  return Math.floor(uid / ANDROID_USER_ID_STRIDE)
}

/** `pm list packages -U` 원문이 실제로 **열거한** 안드로이드 user id 들 (오름차순). */
export function enumeratedUserIds(text: string): number[] {
  const ids = new Set<number>()
  for (const m of text.matchAll(/^package:\S+\s+uid:(\d+)/gm)) {
    ids.add(androidUserIdOf(Number(m[1])))
  }
  return [...ids].sort((a, b) => a - b)
}

/**
 * 이 uid 를 쓰는 패키지 — 그리고 **못 찾은 것이 부재인지 열거 실패인지**.
 *
 * 왜 이 구분이 필요한가: `pm list packages -U` 는 셸 권한이 닿지 않는 안드로이드 user 를
 * 열거하지 못한다. 실기기(SM-S901N)에서 확인한 그대로 —
 *
 *     $ adb shell "pm list packages -U"
 *     Error: java.lang.SecurityException: Shell does not have permission to access user 150
 *     package:com.android.settings uid:1000
 *     ... (정상 632줄)
 *
 * 오류는 **stderr 로만** 나가고 stdout 은 깨끗하며 **종료 코드는 0** 이다. 즉 `tryShell` 은
 * 성공한 줄 알고, 목록은 조용히 불완전해진다. 그런데 `dumpsys netstats` 에는 user 150 의
 * uid 행이 실재한다(실측 18개). 그 uid 로 이 목록을 뒤지면 아무것도 안 나온다.
 *
 * 그때 `[]` 를 내면 "이 uid 를 쓰는 패키지가 없다" 는 거짓이 된다. 사실은 "이 셸로는 그
 * user 를 열거할 수 없었다" 이고, **도구는 그것을 알 수 있다** — 자기가 읽은 목록에 그
 * user 의 패키지가 하나도 없다는 것을 보면 된다. 스스로 확인할 수 있는 것을 확인한다.
 *
 * `[]` 를 아예 없애지는 않는다: 열거된 user 안에서 못 찾은 uid 는 진짜로 패키지가 없다
 * (커널·격리 uid). 그 갈래까지 null 로 뭉개면 "확인하지 못했다" 는 없던 사실이 된다.
 */
export function lookupSharedUidPackages(
  text: string,
  uid: number,
): { packages: string[] } | { packages: null; userIds: number[] } {
  const found = parsePackageUids(text, uid)
  if (found.length > 0) return { packages: found }

  const userIds = enumeratedUserIds(text)
  return userIds.includes(androidUserIdOf(uid)) ? { packages: [] } : { packages: null, userIds }
}
