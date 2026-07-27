import type { ThermalDump } from '../../device/state.js'

/**
 * **데이터 모델** — `dumpsys thermalservice` 원문을 파싱한 전/후 한 쌍.
 *
 * 파서(`device/state.ts` 의 `parseThermalDump`)를 여기로 옮기지 않은 이유: 그 함수는
 * `device.state_*.thermal_zones` 도 채운다. 두 소비자가 같은 파서를 쓰는 것이 맞고,
 * collector 밑으로 내리면 device 쪽이 collector 를 import 하는 뒤집힌 의존이 생긴다.
 *
 * 온도는 **전/후 두 점뿐이다.** 측정 중 `dumpsys` 를 부르면 그것이 곧 기기 접촉이라
 * 규칙 1 을 깨기 때문이고, 그래서 이 지표에는 시계열이 없다 — 중간에 올라갔다 내려온 것과
 * 내내 그대로였던 것이 **같은 모양**이다. 데이터가 없어서가 아니라 원리적으로 그렇다.
 */
export interface ThermalSnapshotPair {
  before: ThermalDump
  /** 종료 스냅샷을 못 찍었으면 null. "변화가 없었다" 와 다른 뜻이다. */
  after: ThermalDump | null
  /** after 원문의 유무. 파싱 결과가 비어 있는 것과 원문이 없는 것을 가른다. */
  afterText: string | null
}
