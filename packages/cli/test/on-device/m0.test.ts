import { describe, expect, it } from 'vitest'
import {
  createAdbContext,
  loadLabeledApps,
  parseForegroundPackage,
  resolveTargetApp,
  runDoctor,
} from '@perftracker/core'
import { DEVICE_TARGET_APP } from './target.js'

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
    const app = await resolveTargetApp(ctx, DEVICE_TARGET_APP)

    expect(app.package).toBe(DEVICE_TARGET_APP)
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
    const ctx = await createAdbContext({})
    const raw = await ctx.adb.tryShell('dumpsys window')

    // 포커스 줄 자체가 없으면 이 기기의 출력 형식이 우리가 아는 것과 다르다.
    expect(raw, 'dumpsys window 에 mCurrentFocus 줄이 없다').toMatch(/^\s*mCurrentFocus=/m)

    const focus = /^\s*mCurrentFocus=(\S.*)$/m.exec(raw)![1]!
    // 잠금화면·전환 중에는 `mCurrentFocus=null` 이 정상이고 그때 답은 null 이다.
    const expected = focus.startsWith('null')
      ? null
      : (/\su0\s(\S+)\//.exec(focus)?.[1] ?? /\{[^}]*?\s(\S+)\/\S+\}/.exec(focus)?.[1] ?? null)

    expect(parseForegroundPackage(raw), `mCurrentFocus=${focus}`).toBe(expected)
  })
})
