import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import {
  LAUNCHER_QUERY,
  listInstalledApps,
  listLaunchableApps,
  parseInstalledPackages,
  parseLaunchablePackages,
} from '../../src/app/list.js'
import { detectForegroundPackage, matchApp, parseForegroundPackage } from '../../src/app/select.js'
import { AmbiguousAppError, AppNotFoundError } from '../../src/errors.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const PM_LIST = [
  'package:com.covering.recle versionCode:107221 uid:10545',
  'package:com.gsr.gs25 versionCode:1854 uid:10503',
  'package:com.nhn.android.webtoon versionCode:24600400 uid:10359',
  '',
].join('\n')

const WINDOW = [
  '  mCurrentFocus=Window{e74a1a8 u0 com.nexon.fo4m.onestore/com.nexon.fo4m.MainActivity}',
  '  mFocusedApp=ActivityRecord{124431701 u0 com.nexon.fo4m.onestore/com.nexon.fo4m.MainActivity t53070}',
  '',
].join('\n')

const apps = [
  { packageName: 'com.nhn.android.webtoon', versionCode: 1, uid: 1, label: '네이버 웹툰', labelSource: 'apk_resources' as const },
  { packageName: 'com.kakao.talk', versionCode: 2, uid: 2, label: '카카오톡', labelSource: 'apk_resources' as const },
  { packageName: 'com.stream.live', versionCode: 3, uid: 3, label: 'Stream', labelSource: 'apk_resources' as const },
  { packageName: 'com.stream.studio', versionCode: 4, uid: 4, label: 'Stream Studio', labelSource: 'apk_resources' as const },
]

describe('parseInstalledPackages', () => {
  it('패키지·버전코드·uid 를 한 번에 읽는다', () => {
    expect(parseInstalledPackages(PM_LIST)).toEqual([
      { packageName: 'com.covering.recle', versionCode: 107221, uid: 10545 },
      { packageName: 'com.gsr.gs25', versionCode: 1854, uid: 10503 },
      { packageName: 'com.nhn.android.webtoon', versionCode: 24600400, uid: 10359 },
    ])
  })

  it('versionCode 나 uid 가 없어도 패키지는 남긴다', () => {
    expect(parseInstalledPackages('package:com.a\n')).toEqual([
      { packageName: 'com.a', versionCode: null, uid: null },
    ])
  })
})

describe('listInstalledApps', () => {
  it('설치된 서드파티 앱을 한 번의 호출로 가져온다', async () => {
    const runner = new FakeProcessRunner().on('shell pm list packages -3 -U --show-versioncode', { stdout: PM_LIST })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(listInstalledApps(adb)).resolves.toHaveLength(3)
    expect(runner.calls).toHaveLength(1)
  })
})

/** 실기기(SM-S901N / sdk 36 · SM-A405S / sdk 30) 출력 형식 그대로다. 둘이 같았다. */
const LAUNCHER_OUT = [
  '3 activities found:',
  '  Activity #0:',
  '    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
  '    com.google.android.youtube/.app.honeycomb.Shell$HomeActivity',
  '  Activity #1:',
  '    priority=500 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
  '    com.nhn.android.webtoon/com.nhn.android.webtoon.Main',
  '  Activity #2:',
  '    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
  '    com.nhn.android.webtoon/com.nhn.android.webtoon.Second',
  '',
].join('\n')

const ALL_LIST = [
  // 유튜브는 선탑재라 `-3` 에 없다. 그래서 여기서만 uid 를 얻는다.
  'package:com.google.android.youtube versionCode:1234 uid:10200',
  'package:com.nhn.android.webtoon versionCode:24600400 uid:10359',
  // 런처에 안 뜨는 것 — androidTest APK. 목록에 있으면 안 된다.
  'package:com.nhn.android.webtoon.test versionCode:1 uid:10360',
  '',
].join('\n')

describe('parseLaunchablePackages', () => {
  it('컴포넌트 줄에서 패키지명만 뽑고 중복을 접는다', () => {
    expect(parseLaunchablePackages(LAUNCHER_OUT)).toEqual([
      'com.google.android.youtube',
      'com.nhn.android.webtoon',
    ])
  })

  it('줄 뒤쪽에 낀 경로를 패키지로 오인하지 않는다', () => {
    // 줄 전체를 훑으면 여기서 `com.evil.pkg` 를 주워 온다 — 열 수도 없는 앱이 목록에 앉는다.
    expect(
      parseLaunchablePackages(
        '9 activities found:\n  Activity #0:\n    priority=0 dataPath=/data/app/com.evil.pkg/base.apk\n',
      ),
    ).toEqual([])
  })

  it('컴포넌트 뒤에 뭐가 더 붙어도 그 앱을 놓치지 않는다', () => {
    // 못 보던 ROM 이 뒤에 뭔가 붙이더라도 앱을 통째로 잃는 것보다는 낫다.
    expect(parseLaunchablePackages('    com.x.y/.Main  filter=0x1\n')).toEqual(['com.x.y'])
  })
})

describe('listLaunchableApps', () => {
  it('사용자가 열 수 있는 앱만 남긴다 — 선탑재는 살리고 test APK 는 뺀다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell ${LAUNCHER_QUERY}`, { stdout: LAUNCHER_OUT })
      .on('shell pm list packages -U --show-versioncode', { stdout: ALL_LIST })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    // `-3` 이었다면 유튜브가 빠지고 `.test` 가 들어왔다. 그것이 이 함수가 존재하는 이유다.
    await expect(listLaunchableApps(adb)).resolves.toEqual([
      { packageName: 'com.google.android.youtube', versionCode: 1234, uid: 10200 },
      { packageName: 'com.nhn.android.webtoon', versionCode: 24600400, uid: 10359 },
    ])
  })

  it('전체 목록에 없는 패키지도 버리지 않는다 — 모르는 값은 null 이다', async () => {
    // 셸 권한이 닿지 않는 안드로이드 user 의 앱이 이 모양이다. 열 수 있는데 uid 를 모른다.
    const runner = new FakeProcessRunner()
      .on(`shell ${LAUNCHER_QUERY}`, { stdout: LAUNCHER_OUT })
      .on('shell pm list packages -U --show-versioncode', { stdout: '' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(listLaunchableApps(adb)).resolves.toEqual([
      { packageName: 'com.google.android.youtube', versionCode: null, uid: null },
      { packageName: 'com.nhn.android.webtoon', versionCode: null, uid: null },
    ])
  })

  it('런처 질의가 아무것도 못 내면 서드파티 목록으로 물러선다', async () => {
    // 빈 목록은 "이 기기에 앱이 없다" 는 거짓말이다. 질의가 실패한 것과 구분해야 한다.
    const runner = new FakeProcessRunner()
      .on(`shell ${LAUNCHER_QUERY}`, { stdout: '' })
      .on('shell pm list packages -3 -U --show-versioncode', { stdout: PM_LIST })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(listLaunchableApps(adb)).resolves.toHaveLength(3)
  })
})

describe('parseForegroundPackage / detectForegroundPackage', () => {
  it('mCurrentFocus 에서 패키지를 뽑는다', () => {
    expect(parseForegroundPackage(WINDOW)).toBe('com.nexon.fo4m.onestore')
  })

  it('mCurrentFocus 가 없으면 mFocusedApp 을 본다', () => {
    const text = '  mFocusedApp=ActivityRecord{1 u0 com.a.b/com.a.b.Main t1}\n'
    expect(parseForegroundPackage(text)).toBe('com.a.b')
  })

  it('잠금화면처럼 앱이 없으면 null', () => {
    expect(parseForegroundPackage('  mCurrentFocus=null\n')).toBeNull()
  })

  it('기기에서 포그라운드 패키지를 읽는다', async () => {
    const runner = new FakeProcessRunner().on('shell dumpsys window', { stdout: WINDOW })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(detectForegroundPackage(adb)).resolves.toBe('com.nexon.fo4m.onestore')
  })
})

describe('matchApp', () => {
  it('라벨 완전 일치를 고른다', () => {
    expect(matchApp(apps, '네이버 웹툰').packageName).toBe('com.nhn.android.webtoon')
  })

  it('패키지명 완전 일치를 고른다', () => {
    expect(matchApp(apps, 'com.kakao.talk').label).toBe('카카오톡')
  })

  it('완전 일치가 있으면 부분 일치보다 우선한다', () => {
    expect(matchApp(apps, 'Stream').packageName).toBe('com.stream.live')
  })

  it('대소문자를 무시한 부분 일치를 지원한다', () => {
    expect(matchApp(apps, 'kakao').packageName).toBe('com.kakao.talk')
  })

  it('대소문자를 무시한 완전 일치를 지원한다 (라벨)', () => {
    expect(matchApp(apps, 'stream').packageName).toBe('com.stream.live')
  })

  it('부분 일치가 여럿이면 자동 선택하지 않는다', () => {
    expect(() => matchApp(apps, 'stream.')).toThrow(AmbiguousAppError)
  })

  it('중복된 라벨은 자동 선택하지 않는다', () => {
    const appsWithDuplicateLabel = [
      { packageName: 'com.example.one', versionCode: 1, uid: 1, label: 'Duplicate', labelSource: 'apk_resources' as const },
      { packageName: 'com.example.two', versionCode: 2, uid: 2, label: 'Duplicate', labelSource: 'apk_resources' as const },
    ]
    expect(() => matchApp(appsWithDuplicateLabel, 'Duplicate')).toThrow(AmbiguousAppError)
  })

  it('일치가 없으면 오류를 던진다', () => {
    expect(() => matchApp(apps, 'zzz')).toThrow(AppNotFoundError)
  })
})
