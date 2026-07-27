import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../../src/adb/client.js'
import { loadLabelCache } from '../../../src/app/label/cache.js'
import {
  parseLauncherActivities,
  parsePmPath,
  parseResolveActivity,
  resolveAppLabel,
} from '../../../src/app/label/resolve.js'
import { buildArsc } from '../../support/arscBuilder.js'
import { FakeProcessRunner } from '../../support/fakeProcessRunner.js'

const RESOLVE = readFileSync(fileURLToPath(new URL('../../fixtures/resolve-activity.txt', import.meta.url)), 'utf8')

/**
 * 실기기(SM-F936N) 원문. **진입점이 둘인 디버그 빌드**에 `resolve-activity` 를 부르면
 * 대상 앱의 액티비티가 아니라 시스템 선택창(`packageName=android`)이 돌아온다.
 */
const RESOLVE_AMBIGUOUS = readFileSync(
  fileURLToPath(new URL('../../fixtures/resolve-activity-ambiguous.txt', import.meta.url)),
  'utf8',
)
/** 같은 기기의 `query-activities --brief` 원문 (83개 앱의 진입점 전부). */
const QUERY_ACTIVITIES = readFileSync(
  fileURLToPath(new URL('../../fixtures/query-activities.txt', import.meta.url)),
  'utf8',
)
const DEBUG_PKG = 'com.example.streaming.debug'
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
    .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`, { stdout: RESOLVE })
    .on(`shell pm path '${PKG}'`, { stdout: `package:${APK}\n` })
    .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: ARSC })
}

describe('parseResolveActivity', () => {
  it('런처 액티비티와 ApplicationInfo 의 labelRes 를 뽑는다', () => {
    expect(parseResolveActivity(RESOLVE)).toEqual({
      launcherActivity: 'com.naver.webtoon.splash.SplashActivity',
      launcherActivityPackage: 'com.nhn.android.webtoon',
      labelRes: 0x7f140047,
      nonLocalizedLabel: null,
    })
  })

  /**
   * **이 저장소가 실기기에서 맞은 결함이다.** 진입점이 둘 이상인 앱에 `resolve-activity` 를
   * 부르면 그 앱의 액티비티가 아니라 시스템 선택창이 돌아온다. 예전에는 `name=` 만 읽어
   * `am start -n <pkg>/com.android.internal.app.ResolverActivity` 를 보냈고 앱이 뜨지 않았다.
   *
   * `packageName` 을 짝으로 읽는 것이 그 방어다 — 이름만으로는 남의 액티비티인 줄 알 수 없다.
   */
  it('선택창이 돌아온 것을 소유 패키지로 알아본다', () => {
    const info = parseResolveActivity(RESOLVE_AMBIGUOUS)

    expect(info.launcherActivity).toBe('com.android.internal.app.ResolverActivity')
    // 대상 앱이 아니라 시스템이 소유한다. 호출자는 이 불일치를 보고 폴백한다.
    expect(info.launcherActivityPackage).toBe('android')
    expect(info.launcherActivityPackage).not.toBe(DEBUG_PKG)
  })

  /**
   * `name=` 과 `packageName=` 을 따로 찾으면 ActivityInfo 의 이름과 ApplicationInfo 의
   * 패키지명(**항상 대상 패키지다**)이 짝지어져, 검사가 언제나 통과하는 죽은 검사가 된다.
   */
  it('ActivityInfo 의 name·packageName 을 짝으로 읽는다 — 뒤쪽 packageName 과 섞지 않는다', () => {
    // 두 절의 packageName 이 **다른** 합성 원문. 짝으로 읽지 않고 각각 첫 매치를 취하면
    // 액티비티 소유자가 'com.target.app' 으로 읽혀 검사가 언제나 통과하는 죽은 검사가 된다.
    const text =
      'ActivityInfo:\n' +
      '  name=com.android.internal.app.ResolverActivity\n' +
      '  packageName=android\n' +
      'ApplicationInfo:\n' +
      '  name=com.target.app.App\n' +
      '  packageName=com.target.app\n'

    expect(parseResolveActivity(text).launcherActivityPackage).toBe('android')
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
      launcherActivityPackage: null,
      labelRes: null,
      nonLocalizedLabel: null,
    })
  })
})

describe('parseLauncherActivities', () => {
  it('대상 패키지의 진입점만 골라낸다', () => {
    expect(parseLauncherActivities(QUERY_ACTIVITIES, DEBUG_PKG)).toEqual([
      'com.example.streaming.splash.SplashActivity',
      'leakcanary.internal.activity.LeakLauncherActivity',
    ])
  })

  /** 같은 원문에 83개 앱이 들어 있다. 다른 앱의 진입점이 섞이면 남의 앱을 띄우게 된다. */
  it('다른 앱의 진입점을 가져오지 않는다', () => {
    const found = parseLauncherActivities(QUERY_ACTIVITIES, DEBUG_PKG)

    expect(QUERY_ACTIVITIES).toContain('com.android.settings/')
    expect(found.some((a) => a.includes('settings'))).toBe(false)
    expect(found.some((a) => a.includes('chrome'))).toBe(false)
  })

  /**
   * 접두어만 맞는 다른 패키지를 잡으면 안 된다 — 이 기기에는 `...streaming` 와
   * `...streaming.debug` 가 **둘 다** 깔려 있어서 실제로 위험한 경우다.
   */
  it('접두어가 같은 다른 패키지를 잡지 않는다', () => {
    const base = parseLauncherActivities(QUERY_ACTIVITIES, 'com.example.streaming')

    expect(QUERY_ACTIVITIES).toContain(`${DEBUG_PKG}/`)
    // `.debug` 쪽 진입점(LeakCanary)이 여기 섞이면 접두어 매칭이 새고 있다는 뜻이다.
    expect(base.some((a) => a.includes('leakcanary'))).toBe(false)
  })

  it('상대 표기(.Settings)도 그대로 남긴다 — am start -n 이 받는 형태다', () => {
    expect(parseLauncherActivities(QUERY_ACTIVITIES, 'com.android.settings')).toContain('.Settings')
  })

  it('없는 패키지는 빈 배열', () => {
    expect(parseLauncherActivities(QUERY_ACTIVITIES, 'com.does.not.exist')).toEqual([])
  })

  /**
   * 기기가 준 순서가 곧 우선순위(`priority` / `preferredOrder`)다. 여기서 정렬하면 그 정보가
   * 사라지고, 호출자가 고르는 "첫 번째" 의 의미가 바뀐다.
   * (실기기 원문은 마침 사전순과 같아서 순서 보존을 증명하지 못한다 — 사전 역순 입력으로 본다.)
   */
  it('기기가 준 순서를 지킨다 — 정렬하지 않는다', () => {
    const text = 'com.x/zzz.LastActivity\ncom.x/aaa.FirstActivity\n'

    expect(parseLauncherActivities(text, 'com.x')).toEqual([
      'zzz.LastActivity',
      'aaa.FirstActivity',
    ])
  })

  it('중복된 줄은 한 번만 센다', () => {
    const text = 'com.x/a.A\ncom.x/a.A\ncom.x/b.B\n'

    expect(parseLauncherActivities(text, 'com.x')).toEqual(['a.A', 'b.B'])
  })

  it('실기기 원문에서 첫 번째가 앱 자신의 진입점이다 — LeakCanary 가 아니다', () => {
    expect(parseLauncherActivities(QUERY_ACTIVITIES, DEBUG_PKG)[0]).toBe(
      'com.example.streaming.splash.SplashActivity',
    )
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
      // 캐시가 없어 어차피 resolve-activity 를 불렀고, 그 액티비티는 이 패키지 소유다.
      launcherActivity: 'com.naver.webtoon.splash.SplashActivity',
      // 후보를 고를 일이 없었다 — `[]`(고를 게 없었다)와 구분되는 null 이다.
      launcherCandidates: null,
    })
  })

  it('호스트 언어가 없으면 기본 config 라벨을 쓴다', async () => {
    const adb = new AdbClient({ adbPath: '/fake/adb', runner: runnerWithApk() })

    const r = await resolveAppLabel(adb, PKG, { preferredLanguage: 'fr' })

    expect(r.label).toBe('Naver Webtoon')
  })

  it('nonLocalizedLabel 이 있으면 APK 를 건드리지 않는다', async () => {
    const runner = new FakeProcessRunner().on(
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`,
      { stdout: 'ApplicationInfo:\n    labelRes=0x0 nonLocalizedLabel=Plain App icon=0x1\n' },
    )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG)

    expect(r).toMatchObject({ label: 'Plain App', source: 'apk_resources' })
    expect(runner.calls).toHaveLength(1)
  })

  it('arsc 해석에 실패하면 패키지명으로 폴백한다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`, { stdout: RESOLVE })
      .on(`shell pm path '${PKG}'`, { stdout: `package:${APK}\n` })
      .on(`exec-out unzip -p '${APK}' resources.arsc`, { stdout: Buffer.from('not an arsc') })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(resolveAppLabel(adb, PKG)).resolves.toMatchObject({
      label: PKG,
      source: 'package_name',
    })
  })

  it('APK 경로를 못 찾아도 폴백한다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`, { stdout: RESOLVE })
      .on(`shell pm path '${PKG}'`, { stdout: '' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(resolveAppLabel(adb, PKG)).resolves.toMatchObject({ source: 'package_name' })
  })

  it('캐시가 있으면 기기를 건드리지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    cache.set(PKG, 24600400, { label: '캐시된 라벨', source: 'apk_resources' })

    const runner = new FakeProcessRunner().on(
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`,
      { stdout: RESOLVE },
    )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG, { cache, versionCode: 24600400 })

    expect(r.label).toBe('캐시된 라벨')
    // 라벨만 필요한 경로는 adb 왕복이 0회다. 예전에는 캐시가 100% 적중해도 설치된 앱마다
    // resolve-activity 를 한 번씩 돌았다 (테스트 기기 169회).
    expect(runner.calls).toHaveLength(0)
  })

  it('런처 액티비티가 필요하면 캐시 적중이어도 딱 한 번만 묻는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    cache.set(PKG, 24600400, { label: '캐시된 라벨', source: 'apk_resources' })

    const runner = new FakeProcessRunner().on(
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`,
      { stdout: RESOLVE },
    )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, PKG, {
      cache,
      versionCode: 24600400,
      withLauncherActivity: true,
    })

    expect(r.label).toBe('캐시된 라벨')
    expect(r.launcherActivity).not.toBeNull()
    expect(runner.calls).toHaveLength(1)
  })

  /**
   * **GUI 의 "시작" 버튼이 디버그 빌드에서 동작해야 한다.** 진입점이 둘 이상이면
   * `resolve-activity` 는 시스템 선택창(`packageName=android`)을 돌려주는데, 옛 코드는 그것을
   * `am start -n <pkg>/com.android.internal.app.ResolverActivity` 로 보냈고 앱이 뜨지 않았다.
   * 이제는 `query-activities` 로 그 패키지의 진입점을 모아 첫 번째를 쓴다.
   */
  it('선택창이 오면 query-activities 로 폴백해 진짜 진입점을 고른다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${DEBUG_PKG}'`, {
        stdout: RESOLVE_AMBIGUOUS,
      })
      .on(
        'shell cmd package query-activities --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN',
        { stdout: QUERY_ACTIVITIES },
      )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, DEBUG_PKG, { withLauncherActivity: true })

    // 시스템 선택창이 아니라 앱 자신의 액티비티를 골랐다.
    expect(r.launcherActivity).toBe('com.example.streaming.splash.SplashActivity')
    expect(r.launcherActivity).not.toContain('ResolverActivity')
    // 고른 사실과 후보 전체가 남는다 — 조용한 추측이 아니다.
    expect(r.launcherCandidates).toEqual([
      'com.example.streaming.splash.SplashActivity',
      'leakcanary.internal.activity.LeakLauncherActivity',
    ])
  })

  it('진입점이 하나뿐이면 고른 것이 아니므로 후보를 남기지 않는다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${DEBUG_PKG}'`, {
        stdout: RESOLVE_AMBIGUOUS,
      })
      .on(
        'shell cmd package query-activities --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN',
        { stdout: `  ${DEBUG_PKG}/only.MainActivity\n` },
      )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, DEBUG_PKG, { withLauncherActivity: true })

    expect(r.launcherActivity).toBe('only.MainActivity')
    expect(r.launcherCandidates).toBeNull()
  })

  it('폴백해도 진입점이 없으면 추측하지 않고 null 을 낸다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${DEBUG_PKG}'`, {
        stdout: RESOLVE_AMBIGUOUS,
      })
      .on(
        'shell cmd package query-activities --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN',
        { stdout: '0 activities found:\n' },
      )
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, DEBUG_PKG, { withLauncherActivity: true })

    // ResolverActivity 를 실어 보내느니 null 이다 — start 가 그것을 사유로 낸다.
    expect(r.launcherActivity).toBeNull()
    expect(r.launcherCandidates).toBeNull()
  })

  /** 목록 렌더링(`apps`)은 진입점을 안 쓴다. 그 경로가 왕복을 늘리면 앱 수만큼 느려진다. */
  it('런처가 필요없는 호출은 query-activities 를 부르지 않는다', async () => {
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${DEBUG_PKG}'`, {
        stdout: RESOLVE_AMBIGUOUS,
      })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const r = await resolveAppLabel(adb, DEBUG_PKG)

    expect(runner.calls.some((c) => c.args.join(' ').includes('query-activities'))).toBe(false)
    // 남의 액티비티(ResolverActivity)를 값으로 싣지도 않는다.
    expect(r.launcherActivity).toBeNull()
  })

  it('해석 실패(package_name)는 캐시에 기록하지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-cache-'))
    const cache = await loadLabelCache('S1', home)
    const runner = new FakeProcessRunner()
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`, { stdout: RESOLVE })
      .on(`shell pm path '${PKG}'`, { stdout: `package:${APK}\n` })
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
      .on(`shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${PKG}'`, { stdout: RESOLVE })
      .on(`shell pm path '${PKG}'`, { stdout: `package:${APK}\n` })
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
    // 실제로 깨진 파일을 놓는다 — 예전에는 그냥 "파일 없음" 을 테스트하고 있었다.
    mkdirSync(join(home, 'labels'), { recursive: true })
    writeFileSync(join(home, 'labels', 'S1.json'), '{"com.a@1": {"label": "A"', 'utf8')

    const cache = await loadLabelCache('S1', home)
    expect(cache.get('com.a', 1)).toBeUndefined()

    // 깨진 파일 위에도 새로 쓸 수 있어야 한다.
    cache.set('com.a', 1, { label: 'A', source: 'apk_resources' })
    await cache.save()
    expect((await loadLabelCache('S1', home)).get('com.a', 1)?.label).toBe('A')
  })
})
