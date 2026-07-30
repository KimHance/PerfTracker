import type { AdbClient } from '../adb/client.js'
import type { CpuCluster, DeviceStatic } from '../schema/result.js'

const GETPROP_KEYS = [
  'ro.product.manufacturer',
  'ro.product.model',
  'ro.build.version.release',
  'ro.build.version.sdk',
  'ro.product.cpu.abilist',
  'ro.soc.model',
  'ro.soc.manufacturer',
  'ro.build.fingerprint',
  // 한 줄 늘어도 왕복은 그대로 한 번이다 (아래 GETPROP_COMMAND 가 셸 안에서 돈다).
  'ro.opengles.version',
] as const

/** getprop 을 키마다 호출하면 왕복이 8번이라 한 번의 shell 로 묶는다. */
const GETPROP_COMMAND = `for p in ${GETPROP_KEYS.join(' ')}; do echo "$p=$(getprop $p)"; done`

const CPU_FREQ_COMMAND =
  'for c in /sys/devices/system/cpu/cpu[0-9]*; do [ -d "$c" ] && ' +
  'echo "$(basename $c) $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null)"; done'

export function parseGetpropLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

export function parseCpuMaxFreqLines(text: string): { cpu: number; maxFreqKhz: number | null }[] {
  const out: { cpu: number; maxFreqKhz: number | null }[] = []
  for (const line of text.split('\n')) {
    const m = /^cpu(\d+)\s*(\d+)?\s*$/.exec(line.trim())
    if (!m) continue
    out.push({ cpu: Number(m[1]), maxFreqKhz: m[2] !== undefined ? Number(m[2]) : null })
  }
  return out.sort((a, b) => a.cpu - b.cpu)
}

/** 연속한 코어가 같은 최대 주파수를 가지면 한 클러스터로 본다 (big.LITTLE 구성 추정이 아니라 관측된 그룹화). */
export function groupCpuClusters(cpus: { cpu: number; maxFreqKhz: number | null }[]): CpuCluster[] {
  const clusters: CpuCluster[] = []
  for (const entry of cpus) {
    const last = clusters[clusters.length - 1]
    if (last && last.max_freq_khz === entry.maxFreqKhz) last.cpus.push(entry.cpu)
    else clusters.push({ cpus: [entry.cpu], max_freq_khz: entry.maxFreqKhz })
  }
  return clusters
}

export function parseMemTotalKb(text: string): number {
  const m = /MemTotal:\s+(\d+)\s*kB/.exec(text)
  return m ? Number(m[1]) : 0
}

export function parseWmSize(text: string): { width: number; height: number } {
  const m = /Physical size:\s*(\d+)x(\d+)/.exec(text)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 }
}

export function parseWmDensity(text: string): number {
  const m = /Physical density:\s*(\d+)/.exec(text)
  return m ? Number(m[1]) : 0
}

/**
 * **화면이 하나라는 보장이 없다.** 폴더블·외부 모니터·DeX·미러링이면 `dumpsys display` 에
 * 화면마다 `mActiveSfDisplayMode` 가 하나씩 나온다. 예전에는 `.exec()` 로 **첫 번째**를
 * 집었는데, 실측 SM-F936N(접힌 상태)에서 첫 번째가 **꺼져 있는 내부 화면**이었다:
 *
 *     mActiveSfDisplayMode=DisplayMode{... 1812x2176 ... peakRefreshRate=60.000004}   ← 꺼짐
 *     mActiveSfDisplayMode=DisplayMode{...  904x2316 ... peakRefreshRate=120.00001}   ← 쓰는 중
 *
 * 그래서 해상도(`wm size`)는 커버 화면 것인데 주사율만 꺼진 화면 것인, **한 객체 안에 두
 * 화면이 섞인** 값이 나갔다. `frame.deadlines` 가 8.33ms(=120Hz)라고 말하는 같은 파일에서.
 *
 * 지금은 `mViewports` 의 `isActive=true` 로 **쓰는 화면의 패널 크기**를 먼저 정하고 그
 * 크기의 모드만 본다. 순서로 고르지 않는다 — 순서가 의미를 가진다는 보장이 어디에도 없다.
 * 회전 중이면 가로세로가 뒤집혀 나올 수 있어 **순서 없이** 비교한다.
 *
 * **고르지 못하면 `null` 이다.** 화면이 여럿인데 어느 것인지 모르면서 하나를 찍으면
 * 그것이 정확히 예전 버그다 (규칙 3).
 *
 * 가변 주사율 패널은 모드가 여럿이고 세션 중에도 바뀐다 — 이 값은 **세션 시작 직전 한
 * 순간**의 스냅샷이다. 세션 동안 실제로 무엇이었는지는 `metrics.frame.data.deadlines` 가
 * 프레임 단위로 말한다 (실측 한 세션에 8.33·16.67·41.67ms 가 함께 있었다).
 * 120.00001 같은 값이 그대로 나오므로 소수 둘째 자리에서 정리한다.
 */
export function parseDisplayModes(text: string): { active: number | null; supported: number[] } {
  const round = (v: string): number => Math.round(Number(v) * 100) / 100
  const key = (w: number, h: number): string => [w, h].sort((a, b) => a - b).join('x')

  // 쓰는 화면의 패널 크기. `isActive=true` 가 둘이면(있을 수 없지만) 고르지 않는다.
  const active = [...text.matchAll(/DisplayViewport\{[^}]*?\}/g)]
    .map((m) => /isActive=true[^}]*?deviceWidth=(\d+), deviceHeight=(\d+)/.exec(m[0]))
    .filter((m): m is RegExpExecArray => m !== null)
  const panel = active.length === 1 ? key(Number(active[0]![1]), Number(active[0]![2])) : null

  const modes = [
    ...text.matchAll(/DisplayMode\{[^}]*?width=(\d+), height=(\d+)[^}]*?peakRefreshRate=([\d.]+)/g),
  ].map((m) => ({ panel: key(Number(m[1]), Number(m[2])), hz: round(m[3]!), whole: m[0] }))

  // 크기를 못 정했으면 화면이 하나뿐인 기기다 — 그때는 전부가 그 화면 것이다.
  const mine = panel === null ? modes : modes.filter((m) => m.panel === panel)

  const activeModes = [
    ...text.matchAll(
      /mActiveSfDisplayMode=DisplayMode\{[^}]*?width=(\d+), height=(\d+)[^}]*?peakRefreshRate=([\d.]+)/g,
    ),
  ].map((m) => ({ panel: key(Number(m[1]), Number(m[2])), hz: round(m[3]!) }))
  const picked =
    panel === null
      ? activeModes.length === 1
        ? activeModes[0]
        : undefined
      : activeModes.find((m) => m.panel === panel)

  return {
    active: picked?.hz ?? null,
    supported: [...new Set(mine.map((m) => m.hz))].sort((a, b) => a - b),
  }
}

/**
 * 방향은 **물리 해상도의 가로세로 비교**다. 기기에 따로 묻지 않는다.
 *
 * `dumpsys window` 의 회전값을 읽는 방법도 있지만 그 값은 세션 중에도 바뀌고, 이 도구는
 * 회전을 추적하지 않는다. 추적하지 않는 것을 한 시점의 스냅샷으로 실으면 "세션 내내 세로였다"
 * 로 읽힌다 — 그래서 묻지 않고, 무엇을 비교한 값인지 `.describe()` 에 적는다.
 * 왕복이 늘지 않는 것은 덤이다.
 */
export function deriveOrientation(
  width: number,
  height: number,
): 'portrait' | 'landscape' | 'square' | null {
  if (width <= 0 || height <= 0) return null
  if (width === height) return 'square'
  return width < height ? 'portrait' : 'landscape'
}

/**
 * 안드로이드 화면 크기 구간. **짧은 변**을 dp 로 환산해 가른다 (`smallestWidth`).
 * 경계는 플랫폼이 정한 320 / 480 / 720 dp 다.
 *
 * 긴 변이 아니라 짧은 변인 이유: 같은 기기를 눕혔다고 크기 구간이 바뀌면 안 되기 때문이다.
 */
export function deriveSizeClass(
  width: number,
  height: number,
  densityDpi: number,
): 'small' | 'normal' | 'large' | 'xlarge' | null {
  if (width <= 0 || height <= 0 || densityDpi <= 0) return null
  const swDp = (Math.min(width, height) / densityDpi) * 160
  if (swDp >= 720) return 'xlarge'
  if (swDp >= 480) return 'large'
  if (swDp >= 320) return 'normal'
  return 'small'
}

/**
 * 스펙 수집도 상태 스냅샷과 같은 정책을 쓴다 (`AdbClient.tryShell`):
 * 개별 명령 실패는 흡수하고 기본값으로 남긴다. 예전에는 여기만 던지는 `shell()` 을 써서
 * `wm size` 가 실패하는 특이 기기 하나가 `start` 전체를 중단시켰고, 같은 실패가
 * 상태 스냅샷에서는 흡수됐다 — 한 저장소 안에 정책이 두 개였다.
 */
export async function collectDeviceStatic(adb: AdbClient): Promise<DeviceStatic> {
  const props = parseGetpropLines(await adb.tryShell(GETPROP_COMMAND))
  const cpus = parseCpuMaxFreqLines(await adb.tryShell(CPU_FREQ_COMMAND))
  const memory = parseMemTotalKb(await adb.tryShell('grep MemTotal /proc/meminfo'))
  const size = parseWmSize(await adb.tryShell('wm size'))
  const density = parseWmDensity(await adb.tryShell('wm density'))
  const modes = parseDisplayModes(await adb.tryShell('dumpsys display'))

  const abilist = props['ro.product.cpu.abilist'] ?? ''

  return {
    manufacturer: props['ro.product.manufacturer'] ?? '',
    model: props['ro.product.model'] ?? '',
    android_release: props['ro.build.version.release'] ?? '',
    sdk_int: Number(props['ro.build.version.sdk'] ?? 0),
    build_fingerprint: props['ro.build.fingerprint'] ?? '',
    abis: abilist ? abilist.split(',').filter(Boolean) : [],
    soc_model: props['ro.soc.model'] || null,
    soc_manufacturer: props['ro.soc.manufacturer'] || null,
    cpu: { core_count: cpus.length, clusters: groupCpuClusters(cpus) },
    memory_total_kb: memory,
    display: {
      width_px: size.width,
      height_px: size.height,
      density_dpi: density,
      active_refresh_rate_hz: modes.active,
      supported_refresh_rates_hz: modes.supported,
      orientation: deriveOrientation(size.width, size.height),
      size_class: deriveSizeClass(size.width, size.height, density),
      // 값의 뜻(16진 인코딩)은 해석하지 않고 기기가 준 문자열 그대로 싣는다.
      opengl_es_version: props['ro.opengles.version'] || null,
    },
  }
}
