import type { MetricReason } from '../../schema/reasons.js'
import type { NetworkData } from '../../schema/result.js'
import type { SnapshotSpec } from '../snapshots.js'
import type { BaseExtractContext, CaptureCollector, ExtractOutcome, SupportResult } from '../types.js'
import {
  APP_UID_STATS_HEADER,
  androidUserIdOf,
  type AppUidStatsDump,
  lookupSharedUidPackages,
  NETSTATS_KEY,
  NETWORK_MIN_SDK,
  networkSnapshotSpecs,
  PACKAGES_KEY,
  parseAppUidStats,
} from './sources/dumpsysNetstats.js'
import { computeDelta, findBackwardsCounter, toNetworkData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/dumpsysNetstats.js'


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
    return networkSnapshotSpecs()
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

    const delta = computeDelta(b, a)
    const backwards = findBackwardsCounter(delta)
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
    const lookup = packagesText != null ? lookupSharedUidPackages(packagesText, uid) : null
    const data: NetworkData = toNetworkData({
      uid,
      before: b,
      after: a,
      sharedPackages: lookup?.packages ?? null,
    })

    const partialReason =
      duplicateReason(uid, before, after) ?? attributionReason(uid, ctx.packageName, lookup)
    return partialReason === null ? { collected: true, data } : { collected: true, data, partialReason }
  },
}

/** 시작 스냅샷의 충돌을 먼저 말한다 — 델타의 기준이 그쪽이다. */
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

/**
 * **이 숫자를 대상 앱 하나에 귀속시킬 수 있는가.** 못 하면 값은 다 싣되 `partial` 로 낸다.
 *
 * 왜 `status` 로도 말하는가: 이 저장소는 이미 같은 이유로 `NETWORK_SCOPE` 한정 문장을 네
 * 필드 전부의 `.describe()` 에 복사해 뒀다 — "한 필드만 읽는 소비자도 그 한정에 도달해야
 * 한다". `status` 는 그 필드들보다 먼저 읽히고, CI 게이트는 대개 `status === 'collected'`
 * 하나로 만들어진다. 실기기에서 uid 1000 을 **86개 패키지가 공유하는데** 그것을 사유 없는
 * `collected` 로 내면, `rx_bytes` 만 보는 소비자에게 "이 앱이 1.7MB 를 썼다" 가 된다.
 *
 * 판정이 아니다: 값이 크다/작다, 맞다/틀리다를 말하지 않는다. **이 숫자가 무엇의 합인지**만
 * 말하고 그것은 관측된 사실이다. 값은 하나도 빼지 않고 그대로 싣는다.
 *
 * 사유 자리는 하나뿐이라 순서가 곧 계약이다:
 *   1. `netstats_uid_duplicated` — 값 **자체**가 어느 쪽인지 모른다 (여기보다 앞, 위 함수)
 *   2. `uid_packages_not_enumerable` — 무엇의 합인지 **알 수 없다**
 *   3. `uid_not_in_package_list` — 열거했는데 대상 패키지조차 이 uid 에 없다
 *   4. `uid_shared_by_multiple_packages` — 무엇의 합인지 알고, 여럿이다
 * 2~4 는 서로 배타적이므로 실제로 겹치는 것은 1 뿐이다. 1 이 실려도 공유 사실은
 * `shared_uid_packages` 배열에 그대로 남고 `status` 는 어느 쪽이든 `partial` 이다.
 */
function attributionReason(
  uid: number,
  packageName: string,
  lookup: ReturnType<typeof lookupSharedUidPackages> | null,
): MetricReason | null {
  if (lookup === null) {
    return { code: 'uid_packages_not_enumerable', detail: { uid, packages_snapshot: false } }
  }
  if (lookup.packages === null) {
    return {
      code: 'uid_packages_not_enumerable',
      detail: {
        uid,
        packages_snapshot: true,
        uid_user_id: androidUserIdOf(uid),
        enumerated_user_ids: lookup.userIds,
      },
    }
  }
  if (lookup.packages.length === 0) {
    return { code: 'uid_not_in_package_list', detail: { uid, package: packageName } }
  }
  if (lookup.packages.length > 1) {
    return {
      code: 'uid_shared_by_multiple_packages',
      detail: { uid, package_count: lookup.packages.length },
    }
  }
  return null
}
