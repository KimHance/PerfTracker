/**
 * **데이터 모델** — `dumpsys netstats` 원문을 읽은 결과. 단위는 기기가 준 그대로(바이트·패킷).
 *
 * 현재 경로는 sdk 34+ 의 `mAppUidStatsMap` 하나뿐이다. 그 아래에서는 같은 내용이 다른
 * 명령에 있지만(13: `dumpsys connectivity trafficcontroller`, ≤12: `dumpsys netd …`)
 * **원문을 한 줄도 본 적이 없어 분기를 만들지 않았다** — 추측으로 파싱하느니 미지원이 정직하다.
 * 그 경로가 생기면 `sources/` 에 파일을 더하고 이 모양으로 채워 주면 된다.
 */
export interface UidCounters {
  rxBytes: number
  rxPackets: number
  txBytes: number
  txPackets: number
}

/** 세션 전/후 한 쌍. 누적 카운터라 **한쪽만으로는 아무 의미가 없다** — 부팅 이후 총량일 뿐이다. */
export interface NetworkCollection {
  uid: number
  before: UidCounters
  after: UidCounters
  /** 이 uid 를 쓰는 패키지들. 열거하지 못했으면 null (`[]` = 열거했는데 없었다와 다르다). */
  sharedPackages: string[] | null
}
