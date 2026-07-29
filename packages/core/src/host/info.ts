import type { HostInfo } from '../schema/result.js'

/**
 * **이 도구를 돌린 컴퓨터.** 이 패키지에서 기기를 만지지 않는 유일한 수집 지점이다.
 *
 * 왜 `device/` 가 아니라 별도 디렉토리인가: `device/` 아래의 모든 것은 `AdbClient` 를 받고
 * 기기에 묻는다. 호스트 정보가 거기 섞이면 "기기에서 온 값" 과 "여기서 만든 값" 이 한
 * 디렉토리에 살게 되고, 그 구분은 이 도구에서 `null` 과 `0` 의 구분만큼 중요하다.
 *
 * 왜 남기는가: 같은 앱·같은 기기인데 수치가 다른 두 세션을 비교할 때, 호스트가 달랐다는
 * 사실이 후보에서 빠지면 원인을 기기에서만 찾게 된다.
 *
 * `process` 를 주입받는 것은 테스트를 위해서다 — 이 함수가 도는 컴퓨터에서만 검증되는 값이면
 * CI 와 개발자 PC 가 서로 다른 것을 확인하게 된다.
 */
export function collectHostInfo(
  proc: { platform: string; arch: string; versions: { node: string } } = process,
): HostInfo {
  return { os: proc.platform, arch: proc.arch, node: proc.versions.node }
}
