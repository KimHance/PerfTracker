import { expect } from 'vitest'
import { COLLECTORS, createAdbContext, probeDevice, renderReason } from '@perftracker/core'

/**
 * 온-디바이스 세션 스펙이 쓰는 **대상 앱**.
 *
 * ## 왜 서드파티 앱이어야 하는가
 *
 * 이 도구가 존재하는 흐름은 하나뿐이다:
 *
 * ```
 * start (사용자의 앱을 --launch 로 콜드 실행) → 사람이 앱을 조작 → stop
 * ```
 *
 * 온-디바이스 스펙이 검증해야 하는 것은 **그 흐름이 실제로 동작하는가**다. 한동안 이 자리에
 * `com.android.settings` 가 있었고, 그것은 시스템 앱 경로를 밟느라 정작 이 도구의 용도를
 * 밟지 않았다. 그리고 실용적인 이유가 하나 더 있다 — `--launch` 는 `am force-stop` 후 재실행
 * 이므로, 테스트를 돌릴 때마다 **개발자의 폰에서 설정 앱이 강제 종료되고 튀어나왔다.**
 *
 * ## 왜 고정하는가 (이건 그대로다)
 *
 * 예전에는 CLI 기본값(포그라운드 앱)을 그대로 썼다. 그래서 **사람이 화면에 무엇을 두었는가가
 * 테스트의 결과를 정했다.** 실기기 5회 연속 실행이 그것을 두 모양으로 드러냈다: 포그라운드가
 * 우연히 설정 앱이라 시스템 앱 경로만 밟은 회차, 그리고 폰이 홈 화면이라 포그라운드가 런처였고
 * 런처에는 런처 액티비티가 없어(`No activity found`) `--launch` 자체가 거부된 1·2회차.
 * 코드가 아니라 **폰이 어느 화면에 있었는가**가 원인이었다.
 *
 * ## 공유 uid 커버리지는 어디로 갔는가
 *
 * 설정 앱은 uid 1000 을 **86개 패키지와 공유해서**(실기기 실측) `uid_shared_by_multiple_packages`
 * 갈래를 온-디바이스에서 실제로 밟는 유일한 선택이었다. 기본 대상 앱(YouTube)은 uid 를 혼자 쓴다.
 *
 * 그 갈래는 **유닛 테스트로 옮겼다** — `packages/core/test/collectors/network.test.ts` 의
 * `pm list packages -U` 픽스처가 실기기 원문에서 뜬 `uid:1000` 86줄을 그대로 재현하고,
 * 공유 uid 가 `partial` + `uid_shared_by_multiple_packages` 로 나오는 것과 값이 하나도 빠짐없이
 * 실리는 것을 거기서 단언한다. **그 로직에 기기가 필요한 부분은 없다** — 입력은 dumpsys 원문
 * 텍스트이고 그 원문은 `runs/` 아래 실기기 세션에 그대로 남아 있다.
 *
 * ## 왜 YouTube 인가
 *
 * 대부분의 안드로이드 기기에 기본으로 깔려 있어, 특정 개발자의 폰에 있는 앱에 기대지 않는다.
 * 진단 스펙의 `RV Scroll` 행(DM-16)과 컴파일 상태 스펙(BP-9)도 YouTube 에 대한 사실이라
 * 기본값으로 돌리면 건너뛰는 스펙 없이 전부 돈다.
 *
 * ## 다른 기기에서 돌릴 때
 *
 * `PERFTRACKER_TEST_APP` 로 덮는다. 그 앱이 이 기기에 없으면 스펙은 **조용히 건너뛰지 않고**
 * 무엇이 없어서 못 도는지 말하며 실패한다 (`assertTargetAppInstalled`). 건너뛰기를 넣지 않는
 * 이유는 단순하다 — 건너뛴 스펙은 통과한 스펙과 같은 색으로 보이고, 그러면 이 파일이 지키려는
 * 것이 아무 데서도 지켜지지 않는다.
 */
export const DEVICE_TARGET_APP = process.env['PERFTRACKER_TEST_APP'] ?? 'com.google.android.youtube'

/**
 * 어느 기기에서 돌릴지. **기기가 두 대 이상 꽂혀 있으면 지정해야 한다** —
 * 안 그러면 `selectDevice` 가 `AmbiguousDeviceError` 로 막고 11개 스펙이 전부 그 자리에서 죽는다
 * (실측: 실기기 두 대를 동시에 연결한 상태에서 11/11 실패).
 *
 * `undefined` 를 그대로 넘기면 기기가 한 대인 환경의 기존 동작(자동 선택)이 유지된다.
 *
 * ```bash
 * PERFTRACKER_TEST_DEVICE=R3CT0000003 PERFTRACKER_TEST_APP=<패키지명> npm run test:device
 * ```
 */
export const DEVICE_SERIAL = process.env['PERFTRACKER_TEST_DEVICE']

/** `createContext` 에 그대로 펼쳐 넣는다. 지정이 없으면 빈 객체라 기존 경로와 같다. */
export const DEVICE_OPTS: { device?: string } = DEVICE_SERIAL ? { device: DEVICE_SERIAL } : {}

/**
 * 대상 앱이 이 기기에 **설치되어 있는지** 확인한다. 없으면 던진다.
 *
 * 왜 필요한가: 없는 앱으로 `runStart` 를 부르면 `AppNotFoundError` 가 나는데, 그 메시지는
 * "이 저장소의 온-디바이스 스펙이 어떤 앱을 기대하고 그것을 어떻게 바꾸는지" 를 말해 주지
 * 않는다. 다른 기기에서 처음 돌리는 사람이 정확히 여기서 막힌다.
 */
export function assertTargetAppInstalled(installedPackages: readonly string[]): void {
  if (installedPackages.includes(DEVICE_TARGET_APP)) return
  throw new Error(
    `온-디바이스 스펙의 대상 앱 "${DEVICE_TARGET_APP}" 이 이 기기에 설치되어 있지 않습니다.\n` +
      `이 기기에 있는 서드파티 앱 하나를 골라 PERFTRACKER_TEST_APP 로 지정하세요:\n` +
      `  PERFTRACKER_TEST_APP=<패키지명> npm run test:device\n` +
      `(고를 앱은 런처 액티비티가 있어야 합니다 — --launch 가 그것으로 콜드 스타트합니다.)`,
  )
}

/**
 * **이 기기가 무엇을 잴 수 있는가.** 판정은 core 의 `collector.supports(env)` 를 그대로 부른다 —
 * 여기서 sdk 표를 다시 쓰면 그 표가 core 와 어긋나는 날 스펙이 틀린 것을 통과시킨다.
 *
 * ## 왜 필요한가
 *
 * 온-디바이스 스펙은 한동안 **"모든 기기가 지표 7개를 다 잰다"** 고 가정했다. 그래서
 * SM-A405S(Android 11, sdk 30)에서 4개가 실패했는데, 그 실패는 도구의 결함이 아니라
 * **기기의 성질**이었다: `frame` 은 sdk 31, `network` 는 sdk 34 가 하한이다. 도구는 정확히
 * `unsupported` 라고 정직하게 말하고 있었고 스펙만 그것을 결함으로 읽었다.
 *
 * 실패가 "고칠 수 없는 사실" 을 가리키면 그 신호는 곧 무시된다 — 4건이 늘 빨간 채로 있으면
 * 5번째로 생긴 **진짜** 결함도 같은 색이라 아무도 못 본다.
 *
 * `doctor` 가 이미 `requirement`(사람이 고쳐야 함) 와 `capability`(기기가 원래 그럼)를
 * 가르고 있다. 스펙도 같은 선을 쓴다: **"이 기기가 다 잰다" 가 아니라 "이 도구가 이 기기에
 * 대해 참말을 한다"** 를 검증한다. 그러면 A405S 에서도 F936N 에서도 같은 스펙이 돈다.
 */
export interface DeviceCapability {
  sdkInt: number
  dataSources: readonly string[]
  /** 이 기기에서 잴 수 있다고 core 가 판정한 지표 id. */
  supported: ReadonlySet<string>
  /** 못 재는 지표 id → 그 이유. 비어 있으면 이 기기는 7개를 다 잰다. */
  unsupported: ReadonlyMap<string, string>
}

export async function deviceCapabilities(): Promise<DeviceCapability> {
  const ctx = await createAdbContext(DEVICE_OPTS)
  const probe = await probeDevice(ctx.adb)
  const env = { sdkInt: probe.sdkInt, dataSources: probe.dataSources }

  const supported = new Set<string>()
  const unsupported = new Map<string, string>()
  for (const collector of COLLECTORS) {
    const result = collector.supports(env)
    if (result.supported) supported.add(collector.id)
    else unsupported.set(collector.id, renderReason(result.reason) ?? result.reason.code)
  }

  return { sdkInt: probe.sdkInt, dataSources: probe.dataSources, supported, unsupported }
}

/**
 * 못 재는 지표가 산출물에서 **정직하게** 보고되는지. 값이 없는 것과 값이 0 인 것은 다르다.
 * 이유를 안 달고 사라지면 소비자는 "0 이었다" 로 읽는다.
 */
export function expectHonestlyUnsupported(
  metric: { status: string; data: unknown; reason_code: string | null } | undefined,
  id: string,
  caps: DeviceCapability,
): void {
  expect(metric, `${id} 메트릭 자리가 없음`).toBeDefined()
  expect(metric!.status, `${id}: 못 재는데 status 가 unsupported 가 아님`).toBe('unsupported')
  expect(metric!.data, `${id}: 못 재는데 data 가 null 이 아님`).toBeNull()
  expect(metric!.reason_code, `${id}: 못 재는데 사유가 없음`).not.toBeNull()
  expect(caps.unsupported.get(id), `${id}: 사유 문장이 비어 있음`).toBeTruthy()
}
