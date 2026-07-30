import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import {
  collectDeviceStatic,
  deriveOrientation,
  deriveSizeClass,
  groupCpuClusters,
  parseCpuMaxFreqLines,
  parseDisplayModes,
  parseGetpropLines,
  parseMemTotalKb,
  parseWmDensity,
  parseWmSize,
} from '../../src/device/spec.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const DISPLAY = readFileSync(fileURLToPath(new URL('../fixtures/dumpsys-display.txt', import.meta.url)), 'utf8')
const FOLDABLE = readFileSync(
  fileURLToPath(new URL('../fixtures/dumpsys-display-foldable.txt', import.meta.url)),
  'utf8',
)

const GETPROP = [
  'ro.product.manufacturer=samsung',
  'ro.product.model=SM-S931N',
  'ro.build.version.release=16',
  'ro.build.version.sdk=36',
  'ro.product.cpu.abilist=arm64-v8a,armeabi-v7a,armeabi',
  'ro.soc.model=SM8750',
  'ro.soc.manufacturer=QTI',
  'ro.build.fingerprint=samsung/pa1qksx/pa1q:16/BP4A.251205.006/x:user/release-keys',
  'ro.opengles.version=196610',
  '',
].join('\n')

const CPU_FREQ = [
  'cpu0 3532800',
  'cpu1 3532800',
  'cpu2 3532800',
  'cpu3 3532800',
  'cpu4 3532800',
  'cpu5 3532800',
  'cpu6 4473600',
  'cpu7 4473600',
  '',
].join('\n')

describe('parseGetpropLines', () => {
  it('key=value 를 맵으로 만든다', () => {
    const props = parseGetpropLines(GETPROP)
    expect(props['ro.product.model']).toBe('SM-S931N')
    expect(props['ro.soc.model']).toBe('SM8750')
  })

  it('값에 = 가 들어 있어도 첫 = 만 구분자로 쓴다', () => {
    expect(parseGetpropLines('a=b=c')['a']).toBe('b=c')
  })

  it('빈 값을 허용한다', () => {
    expect(parseGetpropLines('ro.soc.model=')['ro.soc.model']).toBe('')
  })
})

describe('parseCpuMaxFreqLines / groupCpuClusters', () => {
  it('코어별 최대 주파수를 읽는다', () => {
    expect(parseCpuMaxFreqLines(CPU_FREQ)).toHaveLength(8)
  })

  it('같은 주파수를 가진 연속 코어를 클러스터로 묶는다', () => {
    expect(groupCpuClusters(parseCpuMaxFreqLines(CPU_FREQ))).toEqual([
      { cpus: [0, 1, 2, 3, 4, 5], max_freq_khz: 3532800 },
      { cpus: [6, 7], max_freq_khz: 4473600 },
    ])
  })

  it('주파수를 못 읽은 코어도 클러스터에 남긴다', () => {
    expect(groupCpuClusters(parseCpuMaxFreqLines('cpu0 \n'))).toEqual([{ cpus: [0], max_freq_khz: null }])
  })
})

describe('parseMemTotalKb / parseWmSize / parseWmDensity', () => {
  it('MemTotal 을 KB 로 읽는다', () => {
    expect(parseMemTotalKb('MemTotal:       11380228 kB\nMemFree: 1 kB\n')).toBe(11380228)
  })

  it('물리 해상도를 읽는다', () => {
    expect(parseWmSize('Physical size: 1080x2340\n')).toEqual({ width: 1080, height: 2340 })
  })

  it('Override 가 있으면 물리 density 를 우선한다', () => {
    expect(parseWmDensity('Physical density: 480\nOverride density: 420\n')).toBe(480)
  })
})

describe('parseDisplayModes', () => {
  it('지원 주사율을 정리하고 활성값을 찾는다', () => {
    expect(parseDisplayModes(DISPLAY)).toEqual({
      active: 120,
      supported: [10, 24, 30, 48, 60, 80, 120],
    })
  })

  it('모드 정보가 없으면 빈 목록과 null 을 낸다', () => {
    expect(parseDisplayModes('nothing here')).toEqual({ active: null, supported: [] })
  })

  /**
   * **실측 SM-F936N(접힌 상태).** 화면이 둘이고 `dumpsys` 가 먼저 내놓는 쪽이 **꺼진**
   * 내부 화면(1812x2176 @60Hz)이다. 첫 번째를 집으면 60 이 나오는데, 그때 `wm size` 는
   * 커버 화면(904x2316)을 답하고 `frame.deadlines` 는 8.33ms(=120Hz)를 낸다 —
   * 한 객체 안에 두 화면이 섞인 값이 나갔다.
   */
  it('화면이 둘이면 쓰는 쪽을 고른다 — 순서로 고르지 않는다', () => {
    expect(parseDisplayModes(FOLDABLE).active).toBe(120)
  })

  /**
   * 지원 목록도 화면마다 다르다. 두 화면 것을 합치면 **그 화면에 없는 모드**가 있다고
   * 말하게 된다.
   *
   * 실측 F936N 은 두 화면의 지원 집합이 우연히 같아서 그대로는 이 규칙을 못 본다 —
   * 그래서 꺼진 화면(1812x2176)에만 없는 값 하나를 넣어 새어 나오는지 본다.
   */
  it('지원 목록도 쓰는 화면 것만 낸다', () => {
    const leak = FOLDABLE.replace(
      'width=1812, height=2176, xDpi=377.252, yDpi=375.989, peakRefreshRate=10.0',
      'width=1812, height=2176, xDpi=377.252, yDpi=375.989, peakRefreshRate=7.0',
    )
    expect(leak).toContain('peakRefreshRate=7.0') // 원문에 심었고
    expect(parseDisplayModes(leak).supported).not.toContain(7) // 새어 나오면 안 된다
    expect(parseDisplayModes(FOLDABLE).supported).toEqual([10, 24, 30, 48, 60, 96, 120])
  })

  /**
   * **고르지 못하면 찍지 않는다.** 화면이 여럿인데 어느 것인지 모르면서 하나를 고르면
   * 그것이 정확히 예전 버그다 (규칙 3).
   */
  it('활성 화면을 못 정하면 null 이다 — 첫 번째로 때우지 않는다', () => {
    const noViewport = FOLDABLE.split('\n').filter((l) => !l.includes('DisplayViewport')).join('\n')
    expect(parseDisplayModes(noViewport).active).toBeNull()
  })

  /** 화면이 하나면 뷰포트를 못 읽어도 답이 하나뿐이라 모호하지 않다. */
  it('화면이 하나면 뷰포트 없이도 고른다', () => {
    expect(parseDisplayModes(DISPLAY).active).toBe(120)
  })

  /** 회전 중이면 가로세로가 뒤집혀 나올 수 있다 — 그때도 같은 화면이다. */
  it('가로세로가 뒤집혀도 같은 화면으로 본다', () => {
    const rotated = FOLDABLE.replace('deviceWidth=904, deviceHeight=2316', 'deviceWidth=2316, deviceHeight=904')
    expect(parseDisplayModes(rotated).active).toBe(120)
  })
})

describe('collectDeviceStatic', () => {
  it('기기에서 스펙을 모아 하나의 객체로 만든다', async () => {
    const runner = new FakeProcessRunner()
      .on('-s S1 shell for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.product.cpu.abilist ro.soc.model ro.soc.manufacturer ro.build.fingerprint ro.opengles.version; do echo "$p=$(getprop $p)"; done', { stdout: GETPROP })
      .on('-s S1 shell for c in /sys/devices/system/cpu/cpu[0-9]*; do [ -d "$c" ] && echo "$(basename $c) $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done', { stdout: CPU_FREQ })
      .on('-s S1 shell grep MemTotal /proc/meminfo', { stdout: 'MemTotal:       11380228 kB\n' })
      .on('-s S1 shell wm size', { stdout: 'Physical size: 1080x2340\n' })
      .on('-s S1 shell wm density', { stdout: 'Physical density: 480\n' })
      .on('-s S1 shell dumpsys display', { stdout: DISPLAY })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner }).withSerial('S1')

    const spec = await collectDeviceStatic(adb)

    expect(spec.model).toBe('SM-S931N')
    expect(spec.sdk_int).toBe(36)
    expect(spec.abis).toEqual(['arm64-v8a', 'armeabi-v7a', 'armeabi'])
    expect(spec.cpu.core_count).toBe(8)
    expect(spec.cpu.clusters).toHaveLength(2)
    expect(spec.memory_total_kb).toBe(11380228)
    // display 블록 전체를 단언한다 — 예전에는 wm size / wm density 호출을 통째로 지워도 통과했다.
    expect(spec.display).toEqual({
      width_px: 1080,
      height_px: 2340,
      density_dpi: 480,
      active_refresh_rate_hz: 120,
      supported_refresh_rates_hz: [10, 24, 30, 48, 60, 80, 120],
      // 1080x2340 @480dpi → 짧은 변 360dp → normal.
      orientation: 'portrait',
      size_class: 'normal',
      opengl_es_version: '196610',
    })
    expect(spec.manufacturer).toBe('samsung')
    expect(spec.android_release).toBe('16')
    expect(spec.soc_model).toBe('SM8750')
    expect(spec.soc_manufacturer).toBe('QTI')
    expect(spec.build_fingerprint).toContain('samsung/pa1qksx')
  })

  it('한 명령이 실패해도 나머지 스펙은 채운다 — 상태 스냅샷과 같은 정책이다', async () => {
    const runner = new FakeProcessRunner()
      .on('-s S1 shell for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.product.cpu.abilist ro.soc.model ro.soc.manufacturer ro.build.fingerprint ro.opengles.version; do echo "$p=$(getprop $p)"; done', { stdout: GETPROP })
      .on('-s S1 shell for c in /sys/devices/system/cpu/cpu[0-9]*; do [ -d "$c" ] && echo "$(basename $c) $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done', { stdout: CPU_FREQ })
      .on('-s S1 shell grep MemTotal /proc/meminfo', { stdout: 'MemTotal:       11380228 kB\n' })
      // 이 기기에는 wm size 가 없다.
      .on('-s S1 shell wm size', { code: 1, stderr: 'cmd: Failure calling service window' })
      .on('-s S1 shell wm density', { stdout: 'Physical density: 480\n' })
      .on('-s S1 shell dumpsys display', { stdout: DISPLAY })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner }).withSerial('S1')

    const spec = await collectDeviceStatic(adb)

    expect(spec.model).toBe('SM-S931N')
    expect(spec.display.width_px).toBe(0)
    expect(spec.display.density_dpi).toBe(480)
    // 해상도를 못 읽었으면 방향도 크기 구간도 **모르는 것**이다. portrait/small 로 뭉개지 않는다.
    expect(spec.display.orientation).toBeNull()
    expect(spec.display.size_class).toBeNull()
    // 같은 getprop 묶음에서 오므로 이건 살아 있다.
    expect(spec.display.opengl_es_version).toBe('196610')
  })
})

describe('deriveOrientation', () => {
  it('짧은 쪽이 가로면 portrait', () => {
    expect(deriveOrientation(904, 2316)).toBe('portrait')
  })

  it('짧은 쪽이 세로면 landscape', () => {
    expect(deriveOrientation(2316, 904)).toBe('landscape')
  })

  it('정사각이면 square — portrait 로 뭉개지 않는다', () => {
    expect(deriveOrientation(1000, 1000)).toBe('square')
  })

  it('값을 못 읽었으면 null 이다 — 0 은 방향이 아니다', () => {
    expect(deriveOrientation(0, 2316)).toBeNull()
    expect(deriveOrientation(904, 0)).toBeNull()
  })
})

describe('deriveSizeClass', () => {
  /** 실측: F936N 접힘 상태 904x2316 @420dpi → 짧은 변 344dp → normal. */
  it('짧은 변을 dp 로 환산해 가른다', () => {
    expect(deriveSizeClass(904, 2316, 420)).toBe('normal')
  })

  it('눕혀도 같은 구간이다 — 긴 변이 아니라 짧은 변을 보기 때문', () => {
    expect(deriveSizeClass(2316, 904, 420)).toBe(deriveSizeClass(904, 2316, 420))
  })

  it('320 / 480 / 720 dp 경계', () => {
    // dp = px / dpi * 160 이므로 dpi 160 에서는 px 가 곧 dp 다.
    expect(deriveSizeClass(319, 1000, 160)).toBe('small')
    expect(deriveSizeClass(320, 1000, 160)).toBe('normal')
    expect(deriveSizeClass(480, 1000, 160)).toBe('large')
    expect(deriveSizeClass(720, 1000, 160)).toBe('xlarge')
  })

  it('밀도를 못 읽었으면 null 이다', () => {
    expect(deriveSizeClass(904, 2316, 0)).toBeNull()
  })
})
