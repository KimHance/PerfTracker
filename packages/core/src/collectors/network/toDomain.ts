import type { NetworkData } from '../../schema/result.js'
import type { NetworkCollection, UidCounters } from './model.js'

export const NETWORK_COUNTERS = ['rx_bytes', 'rx_packets', 'tx_bytes', 'tx_packets'] as const
export type NetworkCounter = (typeof NETWORK_COUNTERS)[number]

export interface NetworkDelta {
  rx_bytes: number
  rx_packets: number
  tx_bytes: number
  tx_packets: number
}

/** 누적 카운터의 차이. 되감김 판정은 하지 않는다 — 그 판단은 조립 계층이 사유로 바꾼다. */
export function computeDelta(before: UidCounters, after: UidCounters): NetworkDelta {
  return {
    rx_bytes: after.rxBytes - before.rxBytes,
    rx_packets: after.rxPackets - before.rxPackets,
    tx_bytes: after.txBytes - before.txBytes,
    tx_packets: after.txPackets - before.txPackets,
  }
}

/** 되감긴 카운터가 있으면 그 이름을 돌려준다. 프로세스별 누적 트래픽은 줄어들 수 없다. */
export function findBackwardsCounter(delta: NetworkDelta): NetworkCounter | undefined {
  return NETWORK_COUNTERS.find((k) => delta[k] < 0)
}

/** **데이터 모델 → 도메인 모델.** 기기도 dumpsys 도 모른다. */
export function toNetworkData(c: NetworkCollection): NetworkData {
  return {
    uid: c.uid,
    ...computeDelta(c.before, c.after),
    // 못 읽었으면 [] 가 아니라 null 이다. [] 는 "열거했고 없었다" 이고,
    // null 은 "열거하지 못했다" 다.
    shared_uid_packages: c.sharedPackages,
  }
}
