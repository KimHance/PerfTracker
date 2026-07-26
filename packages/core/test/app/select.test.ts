import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { parsePackageDetail } from '../../src/app/detail.js'
import { listInstalledApps, parseInstalledPackages } from '../../src/app/list.js'
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

describe('parsePackageDetail', () => {
  it('versionName 과 설치 출처를 읽는다', () => {
    const text = [
      '    versionCode=24600400 minSdk=28 targetSdk=36',
      '    versionName=2.46.0',
      '    installerPackageName=com.android.vending',
    ].join('\n')

    expect(parsePackageDetail(text)).toEqual({ versionName: '2.46.0', installSource: 'com.android.vending' })
  })

  it('없으면 null', () => {
    expect(parsePackageDetail('')).toEqual({ versionName: null, installSource: null })
  })

  /**
   * 기기가 **"모른다" 를 `null` 이라는 네 글자로 찍는다.** 실기기 실측:
   *
   *     $ adb shell dumpsys package com.android.settings | grep installerPackageName
   *         installerPackageName=null
   *
   * 그 네 글자를 그대로 실으면 `result.json` 에 `"install_source": "null"` 이 들어간다 —
   * JSON 의 `null` 이 아니라 **문자열**이라, 소비자에게는 `null` 이라는 이름의 설치 출처가
   * 있는 것으로 읽힌다. 시스템 앱과 프리로드는 전부 이 경우다(실기기에서 settings,
   * launcher 둘 다). 없는 것은 없다고 말해야 한다.
   *
   * 깨지는 조건: 리터럴 `null` 을 걸러 내지 않으면 문자열 `'null'` 이 나와 실패한다.
   */
  it('기기가 찍은 리터럴 null 을 값으로 싣지 않는다 — 시스템 앱의 설치 출처가 그렇다', () => {
    expect(
      parsePackageDetail('    versionName=null\n    installerPackageName=null\n'),
    ).toEqual({ versionName: null, installSource: null })
  })
})
