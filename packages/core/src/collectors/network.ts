import type { MetricReason } from '../schema/reasons.js'
import type { NetworkData } from '../schema/result.js'
import { NETSTATS_SNAPSHOT, PACKAGE_UIDS_SNAPSHOT, type SnapshotSpec } from './snapshots.js'
import type { BaseExtractContext, CaptureCollector, ExtractOutcome, SupportResult } from './types.js'

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
const NETSTATS_KEY = NETSTATS_SNAPSHOT.key
const PACKAGES_KEY = PACKAGE_UIDS_SNAPSHOT.key

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

const COUNTERS = ['rx_bytes', 'rx_packets', 'tx_bytes', 'tx_packets'] as const

export const networkCollector: CaptureCollector<NetworkData> = {
  id: 'network',
  source:
    'dumpsys netstats: mAppUidStatsMap 의 세션 전/후 델타 (uid 단위, IP 계층 바이트, ' +
    'loopback 포함 전 인터페이스 합계, wifi/mobile 분리 없음, 큰 패킷은 GSO 추정)',
  needsTrace: false,

  supports(env): SupportResult {
    return env.sdkInt >= NETWORK_MIN_SDK
      ? { supported: true }
      : {
          supported: false,
          reason: { code: 'sdk_too_low', detail: { sdk_int: env.sdkInt, min_sdk: NETWORK_MIN_SDK } },
        }
  },

  traceConfigBlocks(): string[] {
    return []
  },

  /**
   * `--uid` / `--tag` 를 주지 않는다. 필요한 절은 플래그 없이도 항상 라이브로 찍히고,
   * `--uid` 는 우리가 쓰지 않기로 한 2시간 버킷 히스토리만 덧붙인다
   * (에뮬 실측 202→301줄, 스펙의 실기기 실측 7,552줄).
   *
   * `pm list packages -U` 는 uid 단위라는 한정을 **사실로** 바꾸기 위한 것이다 —
   * 이 uid 를 몇 개의 패키지가 쓰는지. 두 명령 다 이 collector 가 미지원인 기기에는
   * 아예 나가지 않는다.
   */
  captureSnapshots(): SnapshotSpec[] {
    return [NETSTATS_SNAPSHOT, PACKAGE_UIDS_SNAPSHOT]
  },

  async extract(ctx: BaseExtractContext): Promise<ExtractOutcome<NetworkData>> {
    const uid = ctx.appUid
    if (uid === null) {
      return {
        collected: false,
        reason: { code: 'app_uid_unknown', detail: { package: ctx.packageName } },
      }
    }

    const pair = ctx.capture.snapshots[NETSTATS_KEY]
    // 누적 카운터는 한쪽만으로 아무 의미가 없다 — 부팅 이후 총량일 뿐 세션의 값이 아니다.
    // Thermal 과 달리 부분값을 내지 않는 이유가 이것이다.
    if (pair?.before == null) {
      return {
        collected: false,
        reason: { code: 'snapshot_unavailable', detail: { key: NETSTATS_KEY, phase: 'before' } },
      }
    }
    if (pair.after === null) {
      return {
        collected: false,
        reason: { code: 'snapshot_unavailable', detail: { key: NETSTATS_KEY, phase: 'after' } },
      }
    }

    const before = parseAppUidStats(pair.before)
    const after = parseAppUidStats(pair.after)
    for (const [phase, dump] of [
      ['before', before],
      ['after', after],
    ] as const) {
      if (!dump.found || dump.header !== APP_UID_STATS_HEADER) {
        return {
          collected: false,
          reason: {
            code: 'snapshot_unparsable',
            detail: {
              key: NETSTATS_KEY,
              section: 'mAppUidStatsMap',
              phase,
              // 이 한 코드가 두 사실을 낸다: **절 자체가 없다**(구버전/벤더 출력)와
              // **절은 있는데 머리글이 다르다**(컬럼 순서 드리프트). 소비자의 대응이 다르다 —
              // 앞엣것은 "이 안드로이드 버전에는 그 절이 없다", 뒤엣것은 "형식이 바뀌었다".
              // 옛 detail 은 `header` 키의 **부재**로만 갈렸고 그 규칙은 어디에도 없었다.
              // 명시하면 소비자가 추론 없이 가른다.
              found: dump.found,
              ...(dump.header !== null ? { header: dump.header } : {}),
            },
          },
        }
      }
      // 머리글 고정은 **컬럼 순서**만 지킨다 — 행의 모양에는 아무 방어가 없다. 벤더나
      // 안드로이드 버전이 행만 다르게 찍으면(`uid=… rxBytes=…`, 6번째 열, 하위 키 들여쓰기)
      // 표를 0행 읽고도 파싱이 "성공" 한다. 그 상태를 uid 부재로 흘려보내면 도구가
      // **관측하지 않은 원인**("트래픽이 없었다")을 대면서 형식 불일치를 삼킨다 (G1).
      //
      // 표가 실제로 비어 있을 가능성도 있고 이 도구는 둘을 구분하지 못한다 — 그래서
      // 사유 문장이 원인을 단정하지 않고 머리 다음 줄 원문을 그대로 싣는다.
      if (dump.rowCount === 0) {
        return {
          collected: false,
          reason: {
            code: 'snapshot_unparsable',
            detail: {
              key: NETSTATS_KEY,
              section: 'mAppUidStatsMap',
              phase,
              // 같은 코드의 세 갈래를 detail 이 전부 명시한다: found=false(절 없음) /
              // found=true + header(머리글 다름) / found=true + rows=0(머리는 맞고 행이 없음).
              found: true,
              header: dump.header,
              rows: 0,
              ...(dump.firstLine !== null ? { first_line: dump.firstLine } : {}),
            },
          },
        }
      }
    }

    const b = before.byUid.get(uid)
    const a = after.byUid.get(uid)
    if (b === undefined || a === undefined) {
      // 0 으로 채우지 않는다. "조회했더니 이 uid 의 행이 없었다" 와 "0 바이트 오갔다" 는
      // 다른 사실이고, 후자로 내보내면 소비자가 구분할 방법이 없다.
      //
      // 행 수를 함께 싣는다: "표에 400행 있었는데 내 uid 만 없다" 와 "표를 거의 못 읽었다" 는
      // 소비자에게 완전히 다른 신호다. (0행은 위에서 이미 걸러진다.)
      return {
        collected: false,
        reason: {
          code: 'uid_not_in_netstats',
          detail: {
            uid,
            in_before: b !== undefined,
            in_after: a !== undefined,
            rows_before: before.rowCount,
            rows_after: after.rowCount,
          },
        },
      }
    }

    const delta = {
      rx_bytes: a.rxBytes - b.rxBytes,
      rx_packets: a.rxPackets - b.rxPackets,
      tx_bytes: a.txBytes - b.txBytes,
      tx_packets: a.txPackets - b.txPackets,
    }
    const backwards = COUNTERS.find((k) => delta[k] < 0)
    if (backwards !== undefined) {
      const raw = {
        rx_bytes: [b.rxBytes, a.rxBytes],
        rx_packets: [b.rxPackets, a.rxPackets],
        tx_bytes: [b.txBytes, a.txBytes],
        tx_packets: [b.txPackets, a.txPackets],
      } as const
      return {
        collected: false,
        reason: {
          code: 'counter_went_backwards',
          detail: { counter: backwards, before: raw[backwards][0], after: raw[backwards][1] },
        },
      }
    }

    const packages = ctx.capture.snapshots[PACKAGES_KEY]
    const packagesText = packages?.before ?? packages?.after
    const data: NetworkData = {
      uid,
      ...delta,
      // 못 읽었으면 [] 가 아니라 null 이다. [] 는 "조회했고 없었다" 이고,
      // 이 uid 를 쓰는 패키지가 하나도 없다는 것은 그 자체로 이상 신호다.
      shared_uid_packages: packagesText != null ? parsePackageUids(packagesText, uid) : null,
    }

    const partialReason = duplicateReason(uid, before, after)
    return partialReason === null ? { collected: true, data } : { collected: true, data, partialReason }
  },
}

/** 사유는 하나만 실린다. 시작 스냅샷의 충돌을 먼저 말한다 — 델타의 기준이 그쪽이다. */
function duplicateReason(
  uid: number,
  before: AppUidStatsDump,
  after: AppUidStatsDump,
): MetricReason | null {
  if (before.conflictingUids.includes(uid)) {
    return { code: 'netstats_uid_duplicated', detail: { uid, phase: 'before' } }
  }
  if (after.conflictingUids.includes(uid)) {
    return { code: 'netstats_uid_duplicated', detail: { uid, phase: 'after' } }
  }
  return null
}
