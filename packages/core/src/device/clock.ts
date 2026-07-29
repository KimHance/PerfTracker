import type { AdbClient } from '../adb/client.js'

/**
 * **기기 시계와 호스트 시계의 차이.**
 *
 * 이 값이 필요한 이유는 이 도구가 두 개의 0초를 갖기 때문이다:
 *
 * ```
 *   시계열 t_s        트레이스 시작 = 0    (기기 시계)
 *   마킹 offset_ms    세션 시작 = 0        (호스트 시계)
 * ```
 *
 * 트레이스의 시작 시각은 `TO_REALTIME` 으로 **기기 벽시계**를 얻을 수 있다. 그것을 호스트
 * 시계로 옮겨야 마킹과 같은 축에 놓이고, 그 환산에 이 차이가 쓰인다.
 *
 * **왕복 시간을 빼는 것이 요점이다.** `date` 한 번은 왕복 30ms 남짓 걸리고, 그동안 기기가
 * 답을 만든 시점은 그 구간 어딘가다. 호출 전후 호스트 시각의 중점을 기준으로 삼으면 오차가
 * 왕복의 절반 이하로 줄어든다. 실측(SM-S901N) 3회: -361.8 / -362.2 / -363.7ms — 편차 2ms.
 *
 * **측정 창이 닫힌 뒤에만 부른다.** `stop` 이 트레이서를 멈춘 다음 부르므로 이 명령은
 * 트레이스에도 남지 않고 규칙 1 도 깨지 않는다.
 */
export async function measureDeviceClockSkewMs(adb: AdbClient): Promise<number | null> {
  const before = Date.now()
  let out: string
  try {
    out = await adb.shell('date +%s%N')
  } catch {
    // 못 읽은 것을 0 으로 적으면 "두 시계가 같다" 는 없던 사실이 된다.
    return null
  }
  const after = Date.now()

  return parseDeviceClockSkewMs(out, before, after)
}

/**
 * `date +%s%N` 의 나노초 문자열을 호스트 시각과 견준다. 파싱은 순수 함수라 따로 둔다.
 *
 * 기기가 `%N` 을 모르면 `1785315958N` 처럼 문자가 그대로 남는다 — 그런 답을 숫자로
 * 읽으면 시계가 몇십 년 어긋난 것처럼 보이므로 **자릿수까지 확인**한다.
 */
export function parseDeviceClockSkewMs(
  raw: string,
  hostBeforeMs: number,
  hostAfterMs: number,
): number | null {
  const digits = raw.trim()
  // epoch 나노초는 19자리다. `%N` 을 못 푼 기기는 이 검사에서 걸린다.
  if (!/^\d{19}$/.test(digits)) return null

  const deviceMs = Number(BigInt(digits) / 1_000_000n)
  if (!Number.isFinite(deviceMs)) return null

  return Math.round(deviceMs - (hostBeforeMs + hostAfterMs) / 2)
}
