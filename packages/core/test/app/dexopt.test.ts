import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { getAppDetail } from '../../src/app/detail.js'
import {
  baseDexLine,
  compileStateChangeWarning,
  compileStateFields,
  dexoptUnavailable,
  parseDexoptState,
  readDexoptState,
} from '../../src/app/dexopt.js'
import { copyViolations } from '../../src/copy/wordform.js'
import { renderReason } from '../../src/schema/reasons.js'
import { type DexoptLine, TargetAppSchema } from '../../src/schema/result.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

const YT = 'com.google.android.youtube'
const INSTALL = '/data/app/~~j3NKMoNZzMtIkX7kyHNSsQ==/com.google.android.youtube-_ZCw5JfQvaAuZ5khXQX0GQ=='
const BASE = `${INSTALL}/base.apk`

/**
 * 실기기 원문 셋 (SM-S901N · sdk 36 · YouTube 21.40.161 · 2026-10-11 research `raw-baseline/`):
 *   - `dumpsys-package-dexopt-youtube.txt` — A1 `dumpsys package` 를 줄였다 (Packages 머리 · `Dexopt state` ~
 *     `Profile utilization state` 앞부분 · `Compiler stats` · `HeimdAllFS state`). HeimdAllFS 절에도 `[<pkg>]` 와
 *     `path:` 줄이 있어 절 경계를 시험한다.
 *   - `dumpsys-package-dexopt-restored.txt` — F3 그대로 (speed-profile 로 되돌린 뒤 · 보조 dex 둘이 `location is error`).
 *   - `dumpsys-package-dexopt-reset.txt` — C-state1 의 `--reset` 직후 원문. research 파일의 머리 4줄(명령 echo ·
 *     `Success` · `exit=0` · 걸린 시간)은 dumpsys 출력이 아니라 빼고, research 가 `[<pkg>]` 부터 잘라 담아 없는
 *     `Dexopt state:` 머리 한 줄을 붙였다. 그 아래 4줄은 원문 5–8행과 바이트까지 같다.
 *   - `dumpsys-package-dexopt-all-excerpt.txt` — A3 `dumpsys package dexopt`(전 패키지) 발췌: 1행(`Dexopt state:`) ·
 *     581–862행(GMS 부터 WebView 까지 이어진 패키지 블록 47개 — WebView 는 두 ABI) · 2148–2152행(Samsung Internet
 *     블록). 줄은 바이트 그대로이고
 *     발췌 경계에서만 이어 붙였다. 같은 기기의 꼴 셋이 여기 있다 — `used by other apps: […]`(6칸 · 8칸) ·
 *     `class loader context: =VaryingClassLoaderContexts=` 아래 `<pkg>: <문맥>` 하위 줄 · 보조 dex 경로 끝 ` (public)`.
 */
describe('parseDexoptState — 실기기 원문', () => {
  it('BP-1 dumpsys Dexopt state 파싱 (A1) — base.apk speed-profile / profile-utilization · 보조 dex 셋 verify / vdex', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT)

    expect(read.reason).toBeNull()
    expect(read.lines).toEqual([
      {
        path: BASE,
        secondary_dex: false,
        public_dex: false,
        abi: 'arm64',
        status: 'speed-profile',
        reason: 'profile-utilization',
        primary_abi: true,
        location: `${INSTALL}/oat/arm64/base.odex`,
      },
      ...[
        '/data/user/0/com.google.android.youtube/app_pccache2/5/59F779C9C12C0775BF45AFF26D8B5E2FA5A89D5B',
        '/data/user/0/com.google.android.youtube/app_pccache2/5/C261F5452FADA828A0BEBA37A55BDC37FE758C0A',
        '/data/user/0/com.google.android.youtube/app_yqzdkcache/drgd/v',
      ].map((dir) => ({
        path: `${dir}/pcam.jar`,
        secondary_dex: true,
        public_dex: false,
        abi: 'arm64',
        status: 'verify',
        reason: 'vdex',
        primary_abi: true,
        location: `${dir}/oat/arm64/pcam.vdex`,
      })),
    ])
    // 같은 출력의 HeimdAllFS 절 `path: …/split_config.*.apk` 는 Dexopt state 가 아니다.
    expect(read.lines!.some((l) => l.path.includes('split_config'))).toBe(false)
  })

  it('BP-1 dumpsys Dexopt state 파싱 (F3) — location 이 error 원문 그대로', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-restored.txt'), YT)

    expect(read.reason).toBeNull()
    expect(read.lines!.map((l) => [l.status, l.reason, l.location?.endsWith('.odex') || l.location?.endsWith('.vdex') ? 'file' : l.location])).toEqual([
      ['speed-profile', 'cmdline', 'file'],
      ['verify', 'vdex', 'file'],
      ['run-from-apk', 'unknown', 'error'],
      ['run-from-apk', 'unknown', 'error'],
    ])
  })

  it('BP-1 dumpsys Dexopt state 파싱 (C-state1) — 공백 든 location 문장이 원문 그대로', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-reset.txt'), YT)

    expect(read.lines).toEqual([
      {
        path: BASE,
        secondary_dex: false,
        public_dex: false,
        abi: 'arm64',
        status: 'verify',
        reason: 'vdex-dm',
        primary_abi: true,
        location: `primary.vdex mapped directly in memory from ${INSTALL}/base.dm`,
      },
    ])
  })

  const EXCERPT = 'dumpsys-package-dexopt-all-excerpt.txt'

  it('BP-1 dumpsys Dexopt state 파싱 (A3 Samsung Internet) — 비보조 dex 아래 used by other apps 줄은 꼴을 알고 싣지 않는다', () => {
    const read = parseDexoptState(fixture(EXCERPT), 'com.sec.android.app.sbrowser')

    expect(read.reason).toBeNull()
    expect(read.lines!.map((l) => [l.path.endsWith('/base.apk'), l.status, l.reason, l.primary_abi])).toEqual([
      [true, 'speed-profile', 'profile-utilization', true],
    ])
  })

  it('BP-1 dumpsys Dexopt state 파싱 (A3 GMS) — 보조 dex 의 (public) 은 public_dex 로 · Varying 문맥 하위 줄 · used by other apps', () => {
    const read = parseDexoptState(fixture(EXCERPT), 'com.google.android.gms')

    expect(read.reason).toBeNull()
    const lines = read.lines!
    // ` (public)` 은 경로 값에 섞이지 않는다 — 표시는 public_dex 하나로.
    expect(lines.filter((l) => l.path.includes('(public)'))).toEqual([])
    expect(lines.filter((l) => l.public_dex)).toHaveLength(24)
    expect(lines.filter((l) => l.public_dex && !l.secondary_dex)).toEqual([])
    const theApk = '/data/user/150/com.google.android.gms/app_dg_cache/8348DD80A734238B4413C219FE27351BE6B49361/the.apk'
    expect(lines.find((l) => l.path === theApk)).toMatchObject({
      secondary_dex: true,
      public_dex: true,
      status: 'verify',
      reason: 'vdex',
    })
    // `=VaryingClassLoaderContexts=` 아래 하위 줄 뒤에도 다음 보조 dex 를 그대로 읽는다.
    expect(lines.find((l) => l.path.includes('dl-AdsFdrDynamite'))).toMatchObject({ status: 'verify', public_dex: true })
    expect(lines.find((l) => l.path.includes('dl-TfliteDynamiteDynamite'))).toMatchObject({ status: 'verify' })
    // 비보조 dex 는 base.apk 와 split 들 — 그 줄 아래 used by other apps 를 건너뛰어도 줄 수는 그대로.
    expect(lines.filter((l) => !l.secondary_dex)[0]?.path.endsWith('/base.apk')).toBe(true)
    expect(baseDexLine(lines)?.reason).toBe('vdex')
  })

  /**
   * 같은 기기에서 실측된 꼴을 "모르는 줄" 로 거부하지 않는다 (검수 #1). A3 전 패키지(635)로 재면 ok 566 · null 69 이고
   * 69 는 전부 dex 줄이 없는 패키지(오버레이 · `android`)다 — 발췌의 패키지 48개로 같은 성질을 고정한다.
   */
  it('BP-2 실기기 A3 발췌 — null 은 dex 줄이 하나도 없는 패키지뿐이다', () => {
    const text = fixture(EXCERPT)
    const pkgs = [...text.matchAll(/^ {2}\[(.+)\]$/gm)].map((m) => m[1]!)
    expect(pkgs).toHaveLength(48)
    const nulls = pkgs.filter((p) => parseDexoptState(text, p).lines === null)
    for (const p of nulls) {
      expect(parseDexoptState(text, p).reason, p).toEqual({ code: 'dexopt_state_unparsable', detail: { line: null } })
      // 그 패키지 머리 바로 다음 줄이 또 패키지 머리다 — dex 줄이 없다.
      const at = text.indexOf(`  [${p}]\n`)
      expect(text.slice(at).split('\n')[1], p).toMatch(/^ {2}\[/)
    }
    expect(nulls.length).toBeGreaterThan(0)
    expect(pkgs.length - nulls.length).toBeGreaterThan(20)
  })

  it('BP-1 파싱한 줄이 스키마를 그대로 통과한다', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT)
    const app = { package: YT, label: 'YouTube', label_source: 'package_name', version_name: null, version_code: null,
      uid: null, install_source: null, launcher_activity: null, pid: null, ...compileStateFields('start', read) }
    expect(TargetAppSchema.parse(app)).toEqual(app)
  })
})

describe('parseDexoptState — 못 읽으면 null + 이유', () => {
  it('BP-2 Dexopt state 없음 null — 절이 없는 실기기 원문', () => {
    const read = parseDexoptState(fixture('dumpsys-package-release.txt'), 'com.example.streaming')
    expect(read).toEqual({ lines: null, reason: { code: 'dexopt_state_section_missing' } })
  })

  it('BP-2 Dexopt state 대상 패키지 줄 없음 null', () => {
    const read = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), 'com.example.other')
    expect(read).toEqual({
      lines: null,
      reason: { code: 'dexopt_state_package_missing', detail: { package: 'com.example.other' } },
    })
  })

  /** 결정 12 — 절은 있는데 줄 꼴을 모르면 추측하지 않는다. 한 줄이라도 모르면 상태 전체가 null. */
  it.each([
    ['ABI 줄 꼴이 다름', '      arm64: status=speed-profile reason=install'],
    ['칸이 하나 더', '      arm64: [status=speed] [reason=cmdline] [primary-abi] [extra]'],
    ['모르는 줄', '    something new: 1'],
    ['used by other apps 꼴이 다름 (대괄호 없음)', '      used by other apps: com.foo'],
    ['비보조 dex 아래 class loader context', '      class loader context: PCL[]'],
    ['dex 없이 ABI 줄', null],
  ])('BP-2 줄 꼴 모름 null — %s', (_, extra) => {
    const text =
      extra === null
        ? `Dexopt state:\n  [${YT}]\n      arm64: [status=verify] [reason=vdex] [primary-abi]\n`
        : `Dexopt state:\n  [${YT}]\n    path: ${BASE}\n      arm64: [status=verify] [reason=vdex] [primary-abi]\n${extra}\n`
    const read = parseDexoptState(text, YT)
    expect(read.lines).toBeNull()
    expect(read.reason?.code).toBe('dexopt_state_unparsable')
  })

  it('BP-2 줄 꼴 모름 null — Varying 문맥 아래 하위 줄 꼴이 다르면 · 그 줄이 Varying 밖에 있으면', () => {
    const head = `Dexopt state:\n  [${YT}]\n    path: ${BASE}\n      arm64: [status=verify] [reason=vdex] [primary-abi]\n    known secondary dex files:\n      /data/user/0/x/a.jar (public)\n        arm64: [status=verify] [reason=vdex] [primary-abi]\n`
    const varying = '        class loader context: =VaryingClassLoaderContexts=\n'
    expect(parseDexoptState(`${head}${varying}          com.foo: PCL[]\n`, YT).reason).toBeNull()
    expect(parseDexoptState(`${head}${varying}          no-colon-here\n`, YT).reason?.code).toBe('dexopt_state_unparsable')
    expect(parseDexoptState(`${head}          com.foo: PCL[]\n`, YT).reason?.code).toBe('dexopt_state_unparsable')
  })

  it('BP-2 줄 꼴 모름 null — 패키지 줄만 있고 dex 줄이 하나도 없다 ([] 로 채우지 않음)', () => {
    const read = parseDexoptState(`Dexopt state:\n  [${YT}]\n\nSPEG state:\n`, YT)
    expect(read).toEqual({ lines: null, reason: { code: 'dexopt_state_unparsable', detail: { line: null } } })
  })

  it('BP-2 시작 상태 — dumpsys package 가 실패하면 null + dexopt_state_unavailable', async () => {
    const runner = new FakeProcessRunner().onMatch(/dumpsys package/, { code: 1, stderr: 'error: device offline\n' })
    const detail = await getAppDetail(new AdbClient({ adbPath: '/fake/adb', runner }), YT)
    expect(detail.compileState).toEqual(dexoptUnavailable('start', 'command_failed', 1))
  })

  it('BP-2 끝 상태 — 실행기가 던져도 null + dexopt_state_unavailable (stop 을 죽이지 않는다)', async () => {
    const adb = new AdbClient({
      adbPath: '/fake/adb',
      runner: {
        run: () => {
          throw new Error('spawn adb ENOENT')
        },
      },
    })
    expect(await readDexoptState(adb, YT)).toEqual(dexoptUnavailable('end', 'command_failed'))
  })

  it('BP-2 새 사유 문장은 단어형이다 — 평가 · 권유 낱말 0 (DM-15 규칙)', () => {
    const reasons = [
      { code: 'dexopt_state_section_missing' as const },
      { code: 'dexopt_state_package_missing' as const, detail: { package: YT } },
      { code: 'dexopt_state_unparsable' as const, detail: { line: '    x: 1' } },
      { code: 'dexopt_state_unparsable' as const, detail: { line: null } },
      ...(['start', 'end'] as const).flatMap((phase) =>
        (['command_failed', 'session_running', 'not_recorded'] as const).map((cause) => dexoptUnavailable(phase, cause, 1).reason!),
      ),
    ]
    for (const r of reasons) {
      const text = renderReason(r)!
      expect(text, r.code).not.toBe(r.code)
      expect(copyViolations(text), text).toEqual([])
    }
  })
})

const line = (over: Partial<DexoptLine>): DexoptLine => ({
  path: BASE,
  secondary_dex: false,
  public_dex: false,
  abi: 'arm64',
  status: 'speed-profile',
  reason: 'profile-utilization',
  primary_abi: true,
  location: null,
  ...over,
})

describe('compileStateChangeWarning — 세션 중 바뀐 사실', () => {
  it('BP-3 상태 바뀜 경고 — 실기기 A1 → F3 (reason profile-utilization → cmdline)', () => {
    const start = parseDexoptState(fixture('dumpsys-package-dexopt-youtube.txt'), YT).lines
    const end = parseDexoptState(fixture('dumpsys-package-dexopt-restored.txt'), YT).lines
    const w = compileStateChangeWarning(start, end)

    expect(w?.code).toBe('compile_state_changed')
    expect(w?.message).toContain('status speed-profile → speed-profile')
    expect(w?.message).toContain('reason profile-utilization → cmdline')
    // 관측된 사건 — 평가 낱말 0.
    expect(copyViolations(w!.message)).toEqual([])
  })

  it('BP-3 상태 바뀜 경고 — 보조 dex 만 바뀌면 경고 0 (기준은 base.apk 줄)', () => {
    const start = [line({}), line({ path: '/data/user/0/x/pcam.jar', secondary_dex: true, status: 'verify' })]
    const end = [line({}), line({ path: '/data/user/0/x/pcam.jar', secondary_dex: true, status: 'run-from-apk' })]
    expect(compileStateChangeWarning(start, end)).toBeNull()
    expect(compileStateChangeWarning(start, [line({ status: 'speed' })])?.code).toBe('compile_state_changed')
  })

  it('BP-3 ABI 줄 여럿이면 primary-abi 줄로 — 실기기 A3 WebView (arm64 [primary-abi] · arm)', () => {
    const start = parseDexoptState(fixture('dumpsys-package-dexopt-all-excerpt.txt'), 'com.google.android.webview').lines!
    expect(start.map((l) => [l.abi, l.primary_abi, l.status])).toEqual([
      ['arm64', true, 'speed-profile'],
      ['arm', false, 'speed-profile'],
    ])
    expect(baseDexLine(start)?.abi).toBe('arm64')
    // primary 가 아닌 arm 줄만 바뀌면 경고 0 · primary 줄이 바뀌면 경고.
    const armOnly = start.map((l) => (l.abi === 'arm' ? { ...l, status: 'verify' } : l))
    expect(compileStateChangeWarning(start, armOnly)).toBeNull()
    const primary = start.map((l) => (l.abi === 'arm64' ? { ...l, reason: 'bg-dexopt' } : l))
    expect(compileStateChangeWarning(start, primary)?.message).toContain('reason install-dm → bg-dexopt')
  })

  it('BP-3 ABI 줄 여럿이면 primary-abi 줄로', () => {
    const start = [line({ abi: 'arm', primary_abi: false, status: 'verify' }), line({ abi: 'arm64' })]
    const sameOnPrimary = [line({ abi: 'arm', primary_abi: false, status: 'speed' }), line({ abi: 'arm64' })]
    expect(baseDexLine(start)?.abi).toBe('arm64')
    // primary 가 아닌 ABI 줄만 바뀌었다 — 경고 0.
    expect(compileStateChangeWarning(start, sameOnPrimary)).toBeNull()
    // primary 줄이 바뀌었다 — 경고.
    const changed = [line({ abi: 'arm', primary_abi: false, status: 'verify' }), line({ abi: 'arm64', reason: 'bg-dexopt' })]
    expect(compileStateChangeWarning(start, changed)?.code).toBe('compile_state_changed')
    // 여럿인데 primary 표시가 없으면 고르지 않는다 (순서로 고르지 않음) — 경고 0.
    const noPrimary = [line({ abi: 'arm', primary_abi: false }), line({ abi: 'arm64', primary_abi: false })]
    expect(baseDexLine(noPrimary)).toBeNull()
    expect(compileStateChangeWarning(noPrimary, [line({ status: 'speed' })])).toBeNull()
  })

  it('BP-3 null 이면 경고 없음 — 시작 · 끝 어느 쪽이든', () => {
    expect(compileStateChangeWarning(null, [line({})])).toBeNull()
    expect(compileStateChangeWarning([line({})], null)).toBeNull()
    expect(compileStateChangeWarning(undefined, [line({ status: 'speed' })])).toBeNull()
    expect(compileStateChangeWarning([line({})], [line({})])).toBeNull()
  })
})
