import { type AdbContextOptions, createBaseAdb, hasActiveSession } from '../adb/context.js'
import { COLLECTORS } from '../collectors/registry.js'
import type { CollectorEnv } from '../collectors/types.js'
import { renderReason } from '../schema/reasons.js'
import { listDevices, selectDevice } from '../device/list.js'
import { evaluateDataSources, probeDevice } from '../device/probe.js'
import { traceProcessorCacheState } from '../perfetto/traceProcessor/locate.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
  /**
   * **고칠 수 있는 것인가, 기기가 원래 그런 것인가.**
   *
   *   - `requirement` : 사람이 고쳐야 측정이 되는 것 (adb 없음, 기기 미연결, perfetto 부재).
   *                     하나라도 실패하면 `doctor` 는 **실패로 끝난다**.
   *   - `capability`  : 이 기기가 무엇을 잴 수 있는가. 실패해도 `doctor` 자체는 성공이다 —
   *                     "Android 11 이라 프레임을 못 잰다" 는 **고칠 수 없는 사실**이고,
   *                     그것을 환경 오류로 내보내면 CI 가 멀쩡한 기기를 불합격으로 잡는다.
   *                     대신 화면에는 ✗ 로 보인다: 못 잰다는 사실 자체는 감추지 않는다.
   */
  kind: 'requirement' | 'capability'
}

/** `doctor` 의 종료 코드를 가르는 기준. capability 실패는 종료 코드를 바꾸지 않는다. */
export function hasBlockingFailure(checks: DoctorCheck[]): boolean {
  return checks.some((c) => !c.ok && c.kind === 'requirement')
}


/**
 * 지표별 지원 여부. **collector 의 `supports()` 를 그대로 부른다** — doctor 가 따로 판단하면
 * 여기서 "된다" 고 한 것이 실제 측정에서 안 되는 상태가 생긴다. 판정의 출처는 하나여야 한다.
 */
export function metricSupportChecks(env: CollectorEnv): DoctorCheck[] {
  return COLLECTORS.map((c) => {
    const support = c.supports(env)
    return {
      name: `metric: ${c.id}`,
      ok: support.supported,
      kind: 'capability' as const,
      detail: support.supported
        ? '측정 가능'
        : `이 기기에서는 측정할 수 없습니다 — ${renderReason(support.reason) ?? support.reason.code}`,
    }
  })
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
    checks.push({ name: 'adb', ok: true, kind: 'requirement', detail: `${created.located.path} (${created.located.source})` })
  } catch (e) {
    checks.push({ name: 'adb', ok: false, kind: 'requirement', detail: (e as Error).message })
    return checks
  }

  const version = await base.raw(['version'])
  checks.push({
    name: 'adb version',
    ok: version.code === 0,
    kind: 'requirement',
    detail: version.stdout.split('\n')[0]?.trim() ?? version.stderr.trim(),
  })

  // 기기가 붙어 있어도 오래된 adb 서버 때문에 빈 목록이 오는 일이 있어 재기동을 허용한다.
  const devices = await listDevices(base)
  try {
    const device = selectDevice(devices, opts.device)
    checks.push({ name: 'device', ok: true, kind: 'requirement', detail: `${device.serial} ${device.model ?? ''}`.trim() })

    if (await hasActiveSession(device.serial, opts.home)) {
      checks.push({
        name: 'measurement window',
        ok: true,
        kind: 'requirement',
        detail: '측정 세션 진행 중 — 기기 점검을 건너뜁니다 (규칙 1). stop 후 다시 실행하세요.',
      })
    } else {
      const probe = await probeDevice(base.withSerial(device.serial))
      checks.push({
        name: 'perfetto',
        ok: probe.hasPerfetto,
        kind: 'requirement',
        detail: probe.hasPerfetto ? '/system/bin/perfetto 사용 가능' : 'perfetto 실행 파일 없음',
      })

      for (const source of evaluateDataSources(probe)) {
        checks.push({
          name: `data source: ${source.name}`,
          ok: source.ok,
          kind: 'capability',
          detail: source.reason ?? '등록됨',
        })
      }

      /**
       * **이 기기에서 어떤 지표를 잴 수 있는가.** 데이터소스 이름만 보여주면
       * `android.surfaceflinger.frametimeline` 이 없다는 사실이 **무엇을 못 잰다는 뜻인지**
       * 사용자가 알 수 없다. 지표 이름으로 다시 말한다.
       *
       * 왜 여기서 말해야 하는가: 예전에는 이것을 `stop` 뒤 `result.json` 을 열어야 알았다.
       * 사람이 30초 동안 앱을 조작하고 나서야 "프레임이 안 잡혔다" 를 아는 것은
       * **측정을 한 번 더 하게 만드는 정보**이고, 그것은 기기를 꽂은 순간 알 수 있었던 사실이다
       * (실측: SM-A405S / Android 11 은 frame·network 둘 다 원리적으로 불가).
       */
      const env = { sdkInt: probe.sdkInt, dataSources: probe.dataSources }
      for (const line of metricSupportChecks(env)) checks.push(line)
    }
  } catch (e) {
    checks.push({ name: 'device', ok: false, kind: 'requirement', detail: (e as Error).message })
  }

  const tp = traceProcessorCacheState()
  checks.push({
    name: 'trace_processor',
    ok: true,
    kind: 'requirement',
    detail: tp.present ? `캐시됨: ${tp.path}` : '아직 없음 — 첫 stop 실행 시 자동으로 받습니다',
  })

  return checks
}
