import {
  AdbClient,
  defaultLocateAdbDeps,
  listDevices,
  locateAdb,
  probeDevice,
  selectDevice,
} from '@perftracker/core'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

const REQUIRED_DATA_SOURCES = [
  'android.surfaceflinger.frametimeline',
  'linux.process_stats',
  'linux.sys_stats',
]

export async function runDoctor(opts: { adb?: string; device?: string }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  let adbPath: string
  try {
    const located = locateAdb(opts.adb, defaultLocateAdbDeps())
    adbPath = located.path
    checks.push({ name: 'adb', ok: true, detail: `${located.path} (${located.source})` })
  } catch (e) {
    checks.push({ name: 'adb', ok: false, detail: (e as Error).message })
    return checks
  }

  const base = new AdbClient({ adbPath })
  const version = await base.raw(['version'])
  checks.push({
    name: 'adb version',
    ok: version.code === 0,
    detail: version.stdout.split('\n')[0]?.trim() ?? version.stderr.trim(),
  })

  // 기기가 붙어 있어도 오래된 adb 서버 때문에 빈 목록이 오는 일이 있어 재기동을 허용한다.
  const devices = await listDevices(base)
  try {
    const device = selectDevice(devices, opts.device)
    checks.push({ name: 'device', ok: true, detail: `${device.serial} ${device.model ?? ''}`.trim() })

    const probe = await probeDevice(base.withSerial(device.serial))
    checks.push({
      name: 'perfetto',
      ok: probe.hasPerfetto,
      detail: probe.hasPerfetto ? '/system/bin/perfetto 사용 가능' : 'perfetto 실행 파일 없음',
    })

    for (const required of REQUIRED_DATA_SOURCES) {
      const ok = probe.dataSources.includes(required)
      checks.push({
        name: `data source: ${required}`,
        ok,
        detail: ok ? '등록됨' : `등록되지 않음 (sdk_int=${probe.sdkInt})`,
      })
    }
  } catch (e) {
    checks.push({ name: 'device', ok: false, detail: (e as Error).message })
  }

  return checks
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name.padEnd(38)} ${c.detail}`).join('\n')
}
