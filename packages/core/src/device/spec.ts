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
 * 가변 주사율 패널은 모드가 여럿이고 세션 중에도 바뀐다.
 * 120.00001 같은 값이 그대로 나오므로 소수 둘째 자리에서 정리한다.
 */
export function parseDisplayModes(text: string): { active: number | null; supported: number[] } {
  const round = (v: string): number => Math.round(Number(v) * 100) / 100

  const supported = new Set<number>()
  for (const m of text.matchAll(/DisplayMode\{[^}]*?peakRefreshRate=([\d.]+)/g)) {
    supported.add(round(m[1]!))
  }

  const activeMatch = /mActiveSfDisplayMode=DisplayMode\{[^}]*?peakRefreshRate=([\d.]+)/.exec(text)

  return {
    active: activeMatch ? round(activeMatch[1]!) : null,
    supported: [...supported].sort((a, b) => a - b),
  }
}

export async function collectDeviceStatic(adb: AdbClient): Promise<DeviceStatic> {
  const props = parseGetpropLines(await adb.shell(GETPROP_COMMAND))
  const cpus = parseCpuMaxFreqLines(await adb.shell(CPU_FREQ_COMMAND))
  const memory = parseMemTotalKb(await adb.shell('grep MemTotal /proc/meminfo'))
  const size = parseWmSize(await adb.shell('wm size'))
  const density = parseWmDensity(await adb.shell('wm density'))
  const modes = parseDisplayModes(await adb.shell('dumpsys display'))

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
    },
  }
}
