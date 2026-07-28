import { describe, expect, it } from 'vitest'
import {
  createAdbContext,
  hasBlockingFailure,
  loadLabeledApps,
  parseForegroundPackage,
  resolveTargetApp,
  runDoctor,
} from '@perftracker/core'
import { assertTargetAppInstalled, DEVICE_OPTS } from './target.js'

/**
 * 시스템 앱 해석 경로 전용 대상. **세션 대상(`DEVICE_TARGET_APP`)과 일부러 다르다.**
 *
 * 이 상수를 쓰는 스펙은 `resolveTargetApp` 만 부른다 — `pm list packages` 와 라벨 조회뿐이고
 * `am force-stop` 도 `am start` 도 하지 않는다. 그래서 사용자의 화면에 아무 일도 일어나지
 * 않으면서 "서드파티 목록만 보던 결함" 의 회귀를 계속 잡는다.
 * 세션 대상을 서드파티 앱으로 옮기면서 이 커버리지가 사라지지 않게 여기에 남긴다.
 */
const SYSTEM_APP = 'com.android.settings'

/** 실기기가 필요하다. `npm run test:device` 로만 실행된다. */
describe('M0 기기 통합', () => {
  /**
   * **막힌 것이 없다**를 본다. "전부 통과" 가 아니다.
   *
   * `capability` 실패(이 기기가 원래 못 재는 것)까지 실패로 세면 SM-A405S 같은 기기에서
   * 스펙이 늘 빨갛고, 그러면 나중에 생긴 **진짜** 결함도 같은 색이라 아무도 못 본다.
   * 종료 코드를 가르는 기준이 `hasBlockingFailure` 이므로 스펙도 같은 선을 쓴다.
   */
  it('doctor 에 측정을 막는 항목이 없다', async () => {
    const checks = await runDoctor(DEVICE_OPTS)

    const blocking = checks.filter((c) => !c.ok && c.kind === 'requirement')
    expect(blocking.map((c) => `${c.name}: ${c.detail}`)).toEqual([])
    expect(hasBlockingFailure(checks)).toBe(false)

    // 못 재는 항목이 있다면 **이유가 적혀 있어야** 한다. 이유 없이 ✗ 만 있으면
    // 사용자는 고칠 수 있는 것인지 아닌지 판단할 수 없다.
    for (const check of checks.filter((c) => !c.ok)) {
      expect(check.detail, `${check.name}: 사유가 비어 있음`).not.toBe('')
    }
  })

  it('앱 목록에서 라벨이 해석된다', async () => {
    const ctx = await createAdbContext(DEVICE_OPTS)
    const apps = await loadLabeledApps(ctx)

    expect(apps.length).toBeGreaterThan(0)
    // 최소 한 개는 패키지명 폴백이 아니라 실제 리소스에서 읽혀야 한다.
    expect(apps.some((a) => a.labelSource === 'apk_resources')).toBe(true)
  })

  /**
   * 세션을 여는 스펙들이 기대하는 앱이 이 기기에 실제로 있는지 **가장 먼저** 확인한다.
   * 없으면 뒤의 스펙들이 `AppNotFoundError` 로 줄줄이 실패하고, 그 메시지는 무엇을 어떻게
   * 바꾸면 되는지 말하지 않는다. 건너뛰기는 넣지 않는다 — 이유는 `./target.ts` 에 있다.
   */
  it('세션 스펙의 대상 앱이 이 기기에 설치되어 있다', async () => {
    const ctx = await createAdbContext(DEVICE_OPTS)
    const apps = await loadLabeledApps(ctx)
    assertTargetAppInstalled(apps.map((a) => a.packageName))
  })

  /**
   * **도구가 손에 쥔 것을 모른다고 말하지 않는다.**
   *
   * 옛 동작은 대상 해석이 `pm list packages -3`(서드파티만)을 봤다. 시스템 앱은 그 목록에
   * 없으므로 `--app com.android.settings` 는 라벨 검색으로 떨어졌고 `AppNotFoundError` 로
   * 끝났다. 실기기에서 그대로 재현됐다 — 그런데 같은 기기에 같은 명령을 `-3` 없이 물으면
   * `package:com.android.settings versionCode:36 uid:1000` 이라고 답한다.
   *
   * 세션을 열지 않는다. 이 단언이 지키는 것은 **해석 단계**이고, 그것이 실패하면 시스템 앱을
   * 대상으로 삼는 어떤 측정도 시작조차 못 한다.
   *
   * 깨지는 조건: uid 출처가 다시 서드파티 목록이 되면 던지거나 uid 가 null 이 된다.
   */
  it('시스템 앱도 대상으로 해석되고 uid 가 나온다', async () => {
    const ctx = await createAdbContext(DEVICE_OPTS)
    const app = await resolveTargetApp(ctx, SYSTEM_APP)

    expect(app.package).toBe(SYSTEM_APP)
    expect(app.uid, '시스템 앱의 uid — 기기는 pm list packages -U 로 이 값을 준다').not.toBeNull()
    expect(app.version_code).not.toBeNull()
    // `--launch` 가 쓸 런처 액티비티. 없으면 m3 의 세션 테스트가 이 앱을 못 띄운다.
    expect(app.launcher_activity).not.toBeNull()
    // 기기가 "모른다" 로 찍는 리터럴 `null` 네 글자가 값으로 실리면 안 된다.
    expect(app.install_source).not.toBe('null')
  })

  /**
   * 세션 스펙들이 대상 앱을 고정하면서(`./target.ts`) 포그라운드 감지는 기기에서 한 번도
   * 실행되지 않게 됐다. 그 자리를 여기서 메운다 — **세션을 열지 않고 파서와 이 기기의
   * 출력 형식이 맞는지만** 본다.
   *
   * "무엇이 떠 있는가" 를 단언하지 않는다. 그것은 사람이 화면에 무엇을 두었는지에 달려
   * 있고(잠금화면이면 `null` 이 정답이다), 바로 그 의존성 때문에 세션 스펙에서 대상을
   * 고정한 것이다. 여기서 지키는 것은 다른 것이다: **이 기기의 `dumpsys window` 가
   * 우리 정규식이 기대하는 모양으로 포커스를 찍는가.**
   *
   * 두 번째 눈으로 읽는다 — `parseForegroundPackage` 가 낸 답을 이 파일의 독립적인
   * 표현식이 같은 원문에서 다시 구해 대조한다. 같은 파서로 두 번 읽으면 형식이 바뀌어도
   * 양쪽이 똑같이 틀려서 단언이 통과한다.
   */
  it('이 기기의 dumpsys window 에서 포그라운드 패키지를 읽는다', async () => {
    const ctx = await createAdbContext(DEVICE_OPTS)
    const raw = await ctx.adb.tryShell('dumpsys window')

    // 포커스 줄 자체가 없으면 이 기기의 출력 형식이 우리가 아는 것과 다르다.
    expect(raw, 'dumpsys window 에 mCurrentFocus 줄이 없다').toMatch(/^\s*mCurrentFocus=/m)

    /**
     * **줄이 하나라고 가정하지 않는다.** 폴더블은 디스플레이마다 포커스를 따로 갖는다 —
     * 실측(SM-F936N): 커버 화면이 `mCurrentFocus=null` 이고 메인 화면이 실제 앱이라
     * `mCurrentFocus` 줄이 **두 개** 나온다. 첫 줄만 보면 앱이 떠 있는데도 null 로 읽힌다.
     *
     * 파서와 같은 규칙(`null` 아닌 첫 창)을 쓰되 **다른 코드로** 구현한다 — 같은 함수를
     * 부르면 두 번째 눈이 아니라 같은 눈이 두 번 보는 것이 된다.
     */
    const focusLines = [...raw.matchAll(/^\s*mCurrentFocus=(\S.*)$/gm)].map((m) => m[1]!)
    expect(focusLines.length, 'mCurrentFocus 줄을 못 찾음').toBeGreaterThan(0)

    const named = focusLines.find((l) => !l.startsWith('null'))
    // 잠금화면·전환 중에는 모든 화면이 `null` 일 수 있고 그때 답은 null 이다.
    const expected =
      named === undefined
        ? null
        : (/\su0\s(\S+)\//.exec(named)?.[1] ?? /\{[^}]*?\s(\S+)\/\S+\}/.exec(named)?.[1] ?? null)

    expect(parseForegroundPackage(raw), `mCurrentFocus 줄 ${focusLines.length}개: ${focusLines.join(' | ')}`).toBe(
      expected,
    )
  })
})
