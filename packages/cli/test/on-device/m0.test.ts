import { describe, expect, it } from 'vitest'
import { createAdbContext, loadLabeledApps, resolveTargetApp, runDoctor } from '@perftracker/core'

/**
 * 모든 안드로이드 빌드(AOSP·GSI·벤더·에뮬레이터)에 있고 런처 액티비티를 가진 시스템 앱.
 * **uid 1000 을 여럿이 공유한다** — 실기기(SM-S901N / sdk 36)에서 86개.
 */
const SYSTEM_APP = 'com.android.settings'

/** 실기기가 필요하다. `npm run test:device` 로만 실행된다. */
describe('M0 기기 통합', () => {
  it('doctor 의 모든 항목이 통과한다', async () => {
    const checks = await runDoctor({})
    const failed = checks.filter((c) => !c.ok)
    expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([])
  })

  it('앱 목록에서 라벨이 해석된다', async () => {
    const ctx = await createAdbContext({})
    const apps = await loadLabeledApps(ctx)

    expect(apps.length).toBeGreaterThan(0)
    // 최소 한 개는 패키지명 폴백이 아니라 실제 리소스에서 읽혀야 한다.
    expect(apps.some((a) => a.labelSource === 'apk_resources')).toBe(true)
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
    const ctx = await createAdbContext({})
    const app = await resolveTargetApp(ctx, SYSTEM_APP)

    expect(app.package).toBe(SYSTEM_APP)
    expect(app.uid, '시스템 앱의 uid — 기기는 pm list packages -U 로 이 값을 준다').not.toBeNull()
    expect(app.version_code).not.toBeNull()
    // `--launch` 가 쓸 런처 액티비티. 없으면 m3 의 세션 테스트가 이 앱을 못 띄운다.
    expect(app.launcher_activity).not.toBeNull()
    // 기기가 "모른다" 로 찍는 리터럴 `null` 네 글자가 값으로 실리면 안 된다.
    expect(app.install_source).not.toBe('null')
  })
})
