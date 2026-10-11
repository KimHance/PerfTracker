import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { resolveTargetApp } from '../../src/app/target.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

/**
 * 실기기(SM-S901N / sdk 36)의 `pm list packages -U --show-versioncode` 를 줄인 것.
 * 요점은 하나다: **시스템 앱이 이 목록에 있고, 그 uid 를 여럿이 공유한다.**
 * 실측 — `com.android.settings uid:1000`, 그 기기에서 uid 1000 을 쓰는 패키지 86개.
 */
const FULL_LIST = [
  'package:com.android.settings versionCode:36 uid:1000',
  'package:com.samsung.oda.service versionCode:1 uid:1000',
  'package:com.nhn.android.webtoon versionCode:24600400 uid:10388',
  '',
].join('\n')

/** 같은 기기의 `-3`(서드파티만) 목록. 시스템 앱이 **없다** — 여기가 결함의 자리였다. */
const THIRD_PARTY_LIST = ['package:com.nhn.android.webtoon versionCode:24600400 uid:10388', ''].join(
  '\n',
)

const focus = (pkg: string): string =>
  `  mCurrentFocus=Window{e74a1a8 u0 ${pkg}/${pkg}.MainActivity}\n`

function device(foreground: string): FakeProcessRunner {
  return new FakeProcessRunner()
    .on('shell pm list packages -U --show-versioncode', { stdout: FULL_LIST })
    .on('shell pm list packages -3 -U --show-versioncode', { stdout: THIRD_PARTY_LIST })
    .on('shell dumpsys window', { stdout: focus(foreground) })
    .onMatch(/shell dumpsys package /, { stdout: '    versionName=1.0\n' })
}

const ctx = (runner: FakeProcessRunner): { adb: AdbClient; serial: string } => ({
  adb: new AdbClient({ adbPath: '/fake/adb', runner }),
  serial: 'S1',
})

// 라벨 캐시는 도구 홈에 산다. 유닛 테스트가 사용자의 진짜 캐시를 읽지 않도록 격리한다.
const realHome = process.env['PERFTRACKER_HOME']
beforeAll(() => {
  process.env['PERFTRACKER_HOME'] = mkdtempSync(join(tmpdir(), 'pt-labels-'))
})
afterAll(() => {
  if (realHome === undefined) delete process.env['PERFTRACKER_HOME']
  else process.env['PERFTRACKER_HOME'] = realHome
})

describe('resolveTargetApp', () => {
  /**
   * 이 저장소가 반복해서 잡아 온 계열 — **도구가 손에 쥔 것을 모른다고 말한다.**
   *
   * 옛 동작: 대상 해석이 `pm list packages -3 …`(서드파티만) 을 봤다. 시스템 앱은 그 목록에
   * 없으므로 `--app com.android.settings` 는 라벨 검색으로 떨어졌고, 라벨 검색도 서드파티
   * 목록만 보므로 `AppNotFoundError` 로 끝났다. **실기기에서 확인했다** — 기기는 같은 질문에
   * `package:com.android.settings versionCode:36 uid:1000` 이라고 답한다.
   *
   * 깨지는 조건: 대상 해석이 다시 `-3` 목록을 보면 이 테스트가 던져서 실패한다.
   */
  it('시스템 앱을 패키지명으로 지정하면 찾는다 — 서드파티 목록에 없다고 없는 앱이 아니다', async () => {
    const app = await resolveTargetApp(ctx(device('com.nhn.android.webtoon')), 'com.android.settings')

    expect(app.package).toBe('com.android.settings')
    expect(app.uid).toBe(1000)
    expect(app.version_code).toBe(36)
  })

  /**
   * 실기기에서 실제로 터진 경로다. 온-디바이스 테스트는 포그라운드 앱을 고르는데 그것이
   * `com.android.settings` 였고, `target_app.uid` 가 null 로 실려 network 가
   * `app_uid_unknown`("대상 앱의 uid 를 알지 못해…") 으로 멈췄다. 기기는 그 uid 를 알고
   * 있었고, 도구도 매 세션 그 목록을 통째로 찍어 저장까지 하고 있었다.
   *
   * 깨지는 조건: uid 출처가 다시 서드파티 목록이 되면 uid 가 null 이 되어 실패한다.
   */
  it('포그라운드가 시스템 앱이어도 uid 를 채운다', async () => {
    const app = await resolveTargetApp(ctx(device('com.android.settings')))

    expect(app.package).toBe('com.android.settings')
    expect(app.uid).toBe(1000)
  })

  it('서드파티 앱은 그대로 해석된다', async () => {
    const app = await resolveTargetApp(ctx(device('com.nhn.android.webtoon')))

    expect(app.uid).toBe(10388)
    expect(app.version_code).toBe(24600400)
  })

  /**
   * 원칙 1 의 회계. 이 수정은 **기기로 나가는 명령을 하나도 늘리지 않는다** — 이미 나가던
   * 한 번의 `pm list packages` 에서 `-3` 을 뺐을 뿐이다. 목록 호출이 둘이 되면 여기서 깨진다.
   *
   * 라벨 검색 경로(`--app <라벨>`)는 여전히 `-3` 목록을 따로 부른다. 그쪽은 632개 패키지의
   * 라벨을 해석하는 비용을 감당할 수 없어 서드파티로 좁히는 것이 맞고, 이 단언은 그 경로를
   * 밟지 않는 호출(정확한 패키지명)만 본다.
   */
  it('패키지명으로 찾을 때 목록 명령은 한 번뿐이다 — 명령 수를 늘려서 고치지 않았다', async () => {
    const runner = device('com.nhn.android.webtoon')
    await resolveTargetApp(ctx(runner), 'com.android.settings')

    const listCalls = runner.commands.filter((c) => c.includes('pm list packages'))
    expect(listCalls).toEqual(['shell pm list packages -U --show-versioncode'])
  })
})

/**
 * 시작 컴파일 상태 (기능 문서 baseline-profile BP-1). **명령을 늘리지 않는다** — 빌드 속성 다섯을 읽던
 * 같은 `dumpsys package` 출력에서 읽는다. `start` 전 왕복 하나가 곧 콜드 스타트가 그만큼 늦게 시작된다는 뜻이다.
 */
describe('resolveTargetApp — 시작 컴파일 상태', () => {
  const YT = 'com.google.android.youtube'
  const DUMPSYS = readFileSync(
    fileURLToPath(new URL('../fixtures/dumpsys-package-dexopt-youtube.txt', import.meta.url)),
    'utf8',
  )
  const ytDevice = (): FakeProcessRunner =>
    new FakeProcessRunner()
      .on('shell pm list packages -U --show-versioncode', {
        stdout: `${FULL_LIST}package:${YT} versionCode:1561301413 uid:10257\n`,
      })
      .on(`shell dumpsys package '${YT}'`, { stdout: DUMPSYS })

  it('BP-1 시작 상태는 같은 dumpsys 출력에서 — 기기 명령 목록 그대로 · dumpsys package 한 번', async () => {
    const runner = ytDevice()
    const app = await resolveTargetApp(ctx(runner), YT)

    // 이 기능 전과 같은 목록 — 컴파일 상태 때문에 늘어난 줄이 없다.
    expect(runner.commands).toEqual([
      'shell pm list packages -U --show-versioncode',
      `shell cmd package resolve-activity -c android.intent.category.LAUNCHER '${YT}'`,
      'shell cmd package query-activities --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN',
      `shell dumpsys package '${YT}'`,
    ])
    expect(runner.commands.filter((c) => c.includes('dumpsys package'))).toEqual([`shell dumpsys package '${YT}'`])
    // 같은 출력에서 빌드 속성도 나온다 — 두 몫이 한 번의 출력을 나눠 읽는다는 증거.
    expect(app.version_name).toBe('21.40.161')
    expect(app.compile_state_start?.[0]).toMatchObject({ status: 'speed-profile', reason: 'profile-utilization' })
    expect(app.compile_state_start).toHaveLength(4)
    expect(app.compile_state_start_reason_code).toBeNull()
    expect(app.compile_state_start_reason).toBeNull()
    // 끝 상태는 stop 몫이다 — 대상 해석은 그 키를 만들지 않는다.
    expect('compile_state_end' in app).toBe(false)
  })

  it('BP-2 시작 상태를 못 읽으면 null + 코드 — [] 로 채우지 않는다', async () => {
    const runner = device('com.nhn.android.webtoon') // dumpsys package 가 `versionName=1.0` 한 줄뿐
    const app = await resolveTargetApp(ctx(runner), 'com.nhn.android.webtoon')

    expect(app.compile_state_start).toBeNull()
    expect(app.compile_state_start_reason_code).toBe('dexopt_state_section_missing')
    expect(app.compile_state_start_reason).toContain('Dexopt state')
  })
})
