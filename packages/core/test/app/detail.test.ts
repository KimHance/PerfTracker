import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseApplicationFlags, parsePackageDetail } from '../../src/app/detail.js'

/**
 * **실기기 원문이다** (SM-F936N / Android 16, `dumpsys package <패키지>`).
 * 권한 목록이 대부분이라 관련 구간만 잘랐지만, `flags=` 가 세 형태로 나오는 것은 그대로 남겼다 —
 * 그 셋을 가르는 것이 이 파서의 유일한 어려운 부분이기 때문이다.
 */
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

const RELEASE = read('dumpsys-package-release.txt')
const DEBUG = read('dumpsys-package-debug.txt')

describe('parseApplicationFlags', () => {
  it('대괄호 형태의 줄만 읽는다 — 같은 출력의 `flags=0x0` 은 비트마스크라 이름이 없다', () => {
    expect(RELEASE).toContain('flags=0x0')
    expect(parseApplicationFlags(RELEASE)).toEqual(
      new Set(['HAS_CODE', 'ALLOW_CLEAR_USER_DATA', 'LARGE_HEAP']),
    )
  })

  /**
   * **실측 출력에서는 앱 플래그가 권한 목록보다 앞에 있어 앵커가 없어도 우연히 맞는다.**
   * 그래서 픽스처 그대로만 검사하면 이 규칙이 지켜지는지 알 수 없다 (돌연변이 검증에서
   * 앵커를 지워도 통과했다). 순서를 뒤집어 앵커가 실제로 일하게 만든다 — dumpsys 출력 순서는
   * 우리가 정하는 것이 아니고, 바뀌는 날 앵커 없는 정규식은 권한 플래그를 앱 플래그로 읽는다.
   */
  it('권한별 `flags=[ ... ]` 가 먼저 나와도 앱 플래그를 고른다', () => {
    const reordered = [
      '        android.permission.CAMERA: granted=true, flags=[ USER_SET|USER_SENSITIVE ]',
      '    flags=[ HAS_CODE LARGE_HEAP ]',
    ].join('\n')

    expect(parseApplicationFlags(reordered)).toEqual(new Set(['HAS_CODE', 'LARGE_HEAP']))
  })

  it('권한 플래그만 있으면 앱 플래그가 없는 것이다 — 남의 값을 빌려 오지 않는다', () => {
    const onlyPermission =
      '        android.permission.CAMERA: granted=true, flags=[ USER_SET|USER_SENSITIVE ]\n'

    expect(parseApplicationFlags(onlyPermission)).toBeNull()
  })

  it('플래그 줄이 없으면 빈 집합이 아니라 null 이다', () => {
    expect(parseApplicationFlags('Package [com.foo]:\n    versionName=1.0\n')).toBeNull()
  })
})

describe('parsePackageDetail', () => {
  it('릴리스 빌드의 일곱 필드를 한 출력에서 읽는다', () => {
    expect(parsePackageDetail(RELEASE)).toEqual({
      versionName: '8.28.3',
      installSource: 'com.android.vending',
      debuggable: false,
      largeHeap: true,
      minSdk: 26,
      targetSdk: 36,
      primaryCpuAbi: 'arm64-v8a',
    })
  })

  it('디버그 빌드를 디버그라고 말한다', () => {
    // 릴리스와 디버그가 같은 파서를 지나 서로 다른 값을 내는 것이 이 필드의 존재 이유다.
    const debug = parsePackageDetail(DEBUG)
    expect(debug.debuggable).toBe(true)
    expect(debug.largeHeap).toBe(false)
  })

  /**
   * **이 두 테스트가 이 파일의 이유다.** `debuggable: false` 는 "릴리스임을 확인했다" 이고
   * `null` 은 "모른다" 이다. 둘을 바꿔 쓰면 디버그 빌드를 재고 릴리스라고 읽는 세션이 생긴다.
   */
  it('플래그 줄을 못 찾으면 false 가 아니라 null 이다', () => {
    const d = parsePackageDetail('Package [com.foo]:\n    versionName=1.0\n')
    expect(d.debuggable).toBeNull()
    expect(d.largeHeap).toBeNull()
  })

  it('빈 출력에서 모든 필드가 null 이다 — 0 이나 false 로 채우지 않는다', () => {
    expect(parsePackageDetail('')).toEqual({
      versionName: null,
      installSource: null,
      debuggable: null,
      largeHeap: null,
      minSdk: null,
      targetSdk: null,
      primaryCpuAbi: null,
    })
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
   * launcher 둘 다). `primaryCpuAbi` 도 네이티브 코드가 없는 APK 에서 같은 값을 찍는다.
   *
   * 깨지는 조건: 리터럴 `null` 을 걸러 내지 않으면 문자열 `'null'` 이 나와 실패한다.
   */
  it('기기가 찍은 리터럴 null 을 값으로 싣지 않는다', () => {
    const d = parsePackageDetail(
      '    versionName=null\n    installerPackageName=null\n    primaryCpuAbi=null\n',
    )
    expect(d.versionName).toBeNull()
    expect(d.installSource).toBeNull()
    expect(d.primaryCpuAbi).toBeNull()
  })

  it('버전과 설치 출처는 예전과 같은 자리에서 읽는다', () => {
    const text = [
      '    versionCode=24600400 minSdk=28 targetSdk=36',
      '    versionName=2.46.0',
      '    installerPackageName=com.android.vending',
    ].join('\n')

    const d = parsePackageDetail(text)
    expect(d.versionName).toBe('2.46.0')
    expect(d.installSource).toBe('com.android.vending')
    expect(d.minSdk).toBe(28)
    expect(d.targetSdk).toBe(36)
  })

  it('minSdk 를 targetSdk 와 헷갈리지 않는다 — 한 줄에 붙어 나온다', () => {
    expect(RELEASE).toContain('versionCode=8280302 minSdk=26 targetSdk=36')
    const d = parsePackageDetail(RELEASE)
    expect(d.minSdk).toBe(26)
    expect(d.targetSdk).toBe(36)
  })
})
