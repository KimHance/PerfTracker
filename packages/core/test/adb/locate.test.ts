import { describe, expect, it } from 'vitest'
import { locateAdb } from '../../src/adb/locate.js'
import { AdbNotFoundError } from '../../src/errors.js'

function deps(existing: string[], overrides: Partial<Parameters<typeof locateAdb>[1]> = {}) {
  const set = new Set(existing)
  return {
    env: {},
    platform: 'darwin' as NodeJS.Platform,
    homedir: '/Users/dev',
    isExecutable: (p: string) => set.has(p),
    ...overrides,
  }
}

describe('locateAdb', () => {
  it('명시 경로를 최우선으로 쓴다', () => {
    expect(locateAdb('/opt/adb', deps(['/opt/adb']))).toEqual({ path: '/opt/adb', source: 'explicit' })
  })

  it('명시 경로가 실행 불가면 오류를 던진다', () => {
    expect(() => locateAdb('/opt/adb', deps([]))).toThrow(AdbNotFoundError)
  })

  it('PERFTRACKER_ADB 환경변수를 다음 순위로 쓴다', () => {
    const d = deps(['/env/adb'], { env: { PERFTRACKER_ADB: '/env/adb' } })
    expect(locateAdb(undefined, d)).toEqual({ path: '/env/adb', source: 'env' })
  })

  it('PATH 를 훑는다', () => {
    const d = deps(['/usr/local/bin/adb'], { env: { PATH: '/nope:/usr/local/bin' } })
    expect(locateAdb(undefined, d)).toEqual({ path: '/usr/local/bin/adb', source: 'path' })
  })

  it('ANDROID_HOME 의 platform-tools 를 본다', () => {
    const d = deps(['/sdk/platform-tools/adb'], { env: { ANDROID_HOME: '/sdk' } })
    expect(locateAdb(undefined, d)).toEqual({ path: '/sdk/platform-tools/adb', source: 'android-home' })
  })

  it('ANDROID_SDK_ROOT 도 본다', () => {
    const d = deps(['/sdk2/platform-tools/adb'], { env: { ANDROID_SDK_ROOT: '/sdk2' } })
    expect(locateAdb(undefined, d).source).toBe('android-home')
  })

  it('macOS 기본 SDK 경로로 폴백한다', () => {
    const d = deps(['/Users/dev/Library/Android/sdk/platform-tools/adb'])
    expect(locateAdb(undefined, d)).toEqual({
      path: '/Users/dev/Library/Android/sdk/platform-tools/adb',
      source: 'default-sdk',
    })
  })

  it('Linux 기본 SDK 경로를 쓴다', () => {
    const d = deps(['/home/dev/Android/Sdk/platform-tools/adb'], {
      platform: 'linux',
      homedir: '/home/dev',
    })
    expect(locateAdb(undefined, d).source).toBe('default-sdk')
  })

  it('Windows 에서는 adb.exe 를 찾는다', () => {
    const d = deps(['C:\\sdk\\platform-tools\\adb.exe'], {
      platform: 'win32',
      env: { ANDROID_HOME: 'C:\\sdk' },
      homedir: 'C:\\Users\\dev',
    })
    expect(locateAdb(undefined, d).path).toBe('C:\\sdk\\platform-tools\\adb.exe')
  })

  it('아무데도 없으면 탐색한 경로를 담은 오류를 던진다', () => {
    try {
      locateAdb(undefined, deps([]))
      expect.unreachable('던졌어야 한다')
    } catch (e) {
      expect(e).toBeInstanceOf(AdbNotFoundError)
      expect((e as AdbNotFoundError).searched.length).toBeGreaterThan(0)
    }
  })
})
