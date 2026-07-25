import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../../src/adb/client.js'
import { loadLabelCache } from '../../../src/app/label/cache.js'
import { parsePmPath, parseResolveActivity, resolveAppLabel } from '../../../src/app/label/resolve.js'
import { buildArsc } from '../../support/arscBuilder.js'
import { FakeProcessRunner } from '../../support/fakeProcessRunner.js'

const RESOLVE = readFileSync(fileURLToPath(new URL('../../fixtures/resolve-activity.txt', import.meta.url)), 'utf8')
const PKG = 'com.nhn.android.webtoon'
const APK = '/data/app/~~yuoecb64ZW6vMoefPN-3Dg==/com.nhn.android.webtoon-iNbfUKgarB7aA1ZzKF8B4w==/base.apk'

const ARSC = buildArsc({
  packageId: 0x7f,
  typeId: 0x14,
  entryCount: 0x0048,
  strings: ['Naver Webtoon', '네이버 웹툰'],
  entries: [
    { entryIndex: 0x0047, language: null, stringIndex: 0 },
    { entryIndex: 0x0047, language: 'ko', stringIndex: 1 },
  ],
})

function runnerWithApk(): FakeProcessRunner {
  return new FakeProcessRunner()
    .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`, { stdout: RESOLVE })
    .on(`shell pm path ${PKG}`, { stdout: `package:${APK}\n` })
    .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: ARSC })
}

describe('parseResolveActivity', () => {
  it('런처 액티비티와 ApplicationInfo 의 labelRes 를 뽑는다', () => {
    expect(parseResolveActivity(RESOLVE)).toEqual({
      launcherActivity: 'com.naver.webtoon.splash.SplashActivity',
      labelRes: 0x7f140047,
      nonLocalizedLabel: null,
    })
  })

  it('nonLocalizedLabel 이 있으면 그대로 읽는다', () => {
    const text = 'ApplicationInfo:\n    labelRes=0x0 nonLocalizedLabel=My App icon=0x1\n'
    expect(parseResolveActivity(text).nonLocalizedLabel).toBe('My App')
  })

  it('labelRes 가 0x0 이면 null 로 정규화한다', () => {
    const text = 'ApplicationInfo:\n    labelRes=0x0 nonLocalizedLabel=null icon=0x1\n'
    expect(parseResolveActivity(text).labelRes).toBeNull()
  })

  it('아무것도 못 찾으면 전부 null', () => {
    expect(parseResolveActivity('No activity found')).toEqual({
      launcherActivity: null,
      labelRes: null,
      nonLocalizedLabel: null,
    })
  })
})

describe('parsePmPath', () => {
  it('base.apk 경로를 고른다', () => {
    expect(parsePmPath(`package:/x/split_config.apk\npackage:${APK}\n`)).toBe(APK)
  })

  it('base.apk 가 없으면 첫 경로를 쓴다', () => {
    expect(parsePmPath('package:/x/only.apk\n')).toBe('/x/only.apk')
  })

  it('경로가 없으면 null', () => {
    expect(parsePmPath('')).toBeNull()
  })
})

describe('resolveAppLabel', () => {
  it('arsc 에서 호스트 언어 라벨을 해석한다', async () => {
    const adb = new AdbClient({ adbPath: '/fake/adb', runner: runnerWithApk() })

    await expect(resolveAppLabel(adb, PKG, { preferredLanguage: 'ko' })).resolves.toEqual({
      label: '네이버 웹툰',
      source: 'apk_resources',
      launcherActivity: 'com.naver.webtoon.splash.SplashActivity',
    })
  })

  it('호스트 언어가 없으면 기본 config 라벨을 쓴다', async () => {
    const adb = new AdbClient({ adbPath: '/fake/adb', runner: runnerWithApk() })

    const r = await resolveAppLabel(adb, PKG, { preferredLanguage: 'fr' })

    expect(r.label).toBe('Naver Webtoon')
  })

  it('nonLocalizedLabel 이 있으면 APK 를 건드리지 않는다', async () => {
    const runner = new FakeProcessRunner().on(
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`,
      { stdout: 'ApplicationInfo:\n    labelRes=0x0 nonLocalizedLabel=Plain App icon=0x1\n' },
    )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG)

    expect(r).toMatchObject({ label: 'Plain App', source: 'apk_resources' })
    expect(runner.calls).toHaveLength(1)
  })

  it('arsc 해석에 실패하면 패키지명으로 폴백한다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`, { stdout: RESOLVE })
      .on(`shell pm path ${PKG}`, { stdout: `package:${APK}\n` })
      .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: Buffer.from('not an arsc') })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(resolveAppLabel(adb, PKG)).resolves.toMatchObject({
      label: PKG,
      source: 'package_name',
    })
  })

  it('APK 경로를 못 찾아도 폴백한다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`, { stdout: RESOLVE })
      .on(`shell pm path ${PKG}`, { stdout: '' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(resolveAppLabel(adb, PKG)).resolves.toMatchObject({ source: 'package_name' })
  })

  it('캐시가 있으면 기기를 건드리지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    cache.set(PKG, 24600400, { label: '캐시된 라벨', source: 'apk_resources' })

    const runner = new FakeProcessRunner().on(
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`,
      { stdout: RESOLVE },
    )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG, { cache, versionCode: 24600400 })

    expect(r.label).toBe('캐시된 라벨')
    expect(runner.calls).toHaveLength(1) // 런처 액티비티 확인 한 번뿐
  })

  it('해석 실패(package_name)는 캐시에 기록하지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`, { stdout: RESOLVE })
      .on(`shell pm path ${PKG}`, { stdout: `package:${APK}\n` })
      .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: Buffer.from('not an arsc') })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG, { cache, versionCode: 928 })

    expect(r.source).toBe('package_name')
    expect(cache.get(PKG, 928)).toBeUndefined()

    await cache.save()
    const reloaded = await loadLabelCache('S1', home)
    expect(reloaded.get(PKG, 928)).toBeUndefined()
  })

  it('부정 결과 다음 실행에서 성공하면 갱신된 라벨이 캐시된다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const failingRunner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER ${PKG}`, { stdout: RESOLVE })
      .on(`shell pm path ${PKG}`, { stdout: `package:${APK}\n` })
      .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: Buffer.from('not an arsc') })
    const cache = await loadLabelCache('S1', home)
    const adbFail = new AdbClient({ adbPath: '/fake/adb', runner: failingRunner })
    await resolveAppLabel(adbFail, PKG, { cache, versionCode: 939 })

    const adbOk = new AdbClient({ adbPath: '/fake/adb', runner: runnerWithApk() })
    const r = await resolveAppLabel(adbOk, PKG, { preferredLanguage: 'ko', cache, versionCode: 939 })

    expect(r.label).toBe('네이버 웹툰')
    expect(cache.get(PKG, 939)).toEqual({ label: '네이버 웹툰', source: 'apk_resources' })
  })
})

describe('loadLabelCache', () => {
  it('저장 후 다시 읽으면 값이 남아 있다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const first = await loadLabelCache('S1', home)
    first.set('com.a', 1, { label: 'A', source: 'apk_resources' })
    await first.save()

    const second = await loadLabelCache('S1', home)

    expect(second.get('com.a', 1)).toEqual({ label: 'A', source: 'apk_resources' })
    expect(second.get('com.a', 2)).toBeUndefined()
  })

  it('캐시 파일이 깨져 있어도 빈 캐시로 시작한다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    expect(cache.get('com.a', 1)).toBeUndefined()
  })
})
