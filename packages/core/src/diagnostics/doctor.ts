import { type AdbContextOptions, createBaseAdb, hasActiveSession } from '../adb/context.js'
import { listDevices, selectDevice } from '../device/list.js'
import { evaluateDataSources, probeDevice } from '../device/probe.js'
import { traceProcessorCacheState } from '../perfetto/traceProcessor/locate.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

/**
 * 환경 점검. 각 단계의 실패를 던지지 않고 항목으로 보고한다 — 그게 이 명령의 존재 이유다.
 * 측정 세션이 진행 중이면 기기 프로브를 건너뛴다 (규칙 1): doctor 때문에 측정이 오염되면
 * 진단이 진단 대상을 바꾼 셈이다.
 */
export async function runDoctor(opts: AdbContextOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  let base
  try {
    const created = createBaseAdb(opts)
    base = created.adb
    checks.push({ name: 'adb', ok: true, detail: `${created.located.path} (${created.located.source})` })
  } catch (e) {
    checks.push({ name: 'adb', ok: false, detail: (e as Error).message })
    return checks
  }

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

    if (await hasActiveSession(device.serial, opts.home)) {
      checks.push({
        name: 'measurement window',
        ok: true,
        detail: '측정 세션 진행 중 — 기기 점검을 건너뜁니다 (규칙 1). stop 후 다시 실행하세요.',
      })
    } else {
      const probe = await probeDevice(base.withSerial(device.serial))
      checks.push({
        name: 'perfetto',
        ok: probe.hasPerfetto,
        detail: probe.hasPerfetto ? '/system/bin/perfetto 사용 가능' : 'perfetto 실행 파일 없음',
      })

      for (const source of evaluateDataSources(probe)) {
        checks.push({
          name: `data source: ${source.name}`,
          ok: source.ok,
          detail: source.reason ?? '등록됨',
        })
      }
    }
  } catch (e) {
    checks.push({ name: 'device', ok: false, detail: (e as Error).message })
  }

  const tp = traceProcessorCacheState()
  checks.push({
    name: 'trace_processor',
    ok: true,
    detail: tp.present ? `캐시됨: ${tp.path}` : '아직 없음 — 첫 stop 실행 시 자동으로 받습니다',
  })

  return checks
}
