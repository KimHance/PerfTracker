import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAdbContext,
  extractRun,
  type NetworkData,
  probeDevice,
  readActiveSession,
  type ThermalData,
} from '@perftracker/core'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'

/**
 * 실기기 또는 에뮬레이터가 필요하다. `npm run test:device` 로만 실행된다.
 *
 * **에뮬레이터에서 정직하게 검증되지 않는 것은 여기서 단언하지 않는다.** 목록과 이유는
 * 저장소 루트 `README.md` 의 "검증 환경" 절에 있다 (계획서는 저장소에 없다 — 새로 clone 한
 * 사람이 실제로 찾아볼 수 있는 문서를 가리킨다). 요약하면:
 *
 *   - **온도가 부하에 반응하는 것.** 에뮬 thermal HAL 은 AOSP 예제 구현이라 하드코딩 상수를
 *     돌려주고 `registerThermalChangedCallback()` 을 부르는 코드가 없다. `delta_c` 는 항상
 *     0 이다. **`delta_c !== 0` 을 단언하면 안 된다** — 거기가 공허한 단언이 될 자리다.
 *   - **네트워크 바이트의 크기.** 에뮬은 호스트 NAT 를 타고 세션 중 앱이 통신하지 않을 수
 *     있다. `rx_bytes > 0` 은 flaky 하므로 `>= 0` 과 status 만 본다.
 *   - **여러 존을 가진 기기의 섹션 병합.** 에뮬은 존이 1개라 실기기의 `PA1THM`(cached 전용)
 *     같은 경우를 밟지 못한다. 유닛 테스트와 `runs/` 실기기 원본이 덮는다.
 *   - **sdk 34 미만의 Network 미지원 경로 / 카운터 되감김 / BPF 맵 중복 행.** 재현할 방법이
 *     없어 유닛 테스트로만 덮인다.
 */
describe('M3 기기 통합', () => {
  it('이 기기가 M3 의 두 지표를 낼 수 있는 조건을 갖췄다', async () => {
    const ctx = await createAdbContext({})
    const probe = await probeDevice(ctx.adb)

    // Thermal 은 sdk 29+, Network 는 sdk 34+ 다. 둘 다 데이터소스를 요구하지 않는다.
    expect(probe.sdkInt).toBeGreaterThanOrEqual(29)

    const thermal = await ctx.adb.tryShell('dumpsys thermalservice')
    expect(thermal, 'dumpsys thermalservice 가 온도를 하나도 안 준다').toContain('Temperature{')

    if (probe.sdkInt >= 34) {
      const netstats = await ctx.adb.tryShell('dumpsys netstats')
      // 콜론 뒤에 아무것도 없는 줄만 앵커다 — `BPF map status:` 절의 `mAppUidStatsMap: OK` 를
      // 배제한다. 이 단언이 깨지면 파서가 조용히 빈 결과를 낼 이미지라는 뜻이다.
      expect(netstats, 'mAppUidStatsMap 절 없음 — 계획서 Task 6 Step 1 의 대안 경로를 보라').toMatch(
        /^\s*mAppUidStatsMap:\s*$/m,
      )
      // 헤더가 다르면 파서는 한 행도 읽지 않고 snapshot_unparsable 로 멈춘다 (G1).
      // AOSP 자바 필드 순서(rxPackets, rxBytes, ...)가 덤프 헤더와 **다르다** —
      // 헤더에 고정하지 않으면 바이트와 패킷이 뒤바뀐 채 통과할 수 있다.
      expect(netstats).toContain('uid rxBytes rxPackets txBytes txPackets')
    }
  })

  it('start → stop 이 thermal 과 network 를 내놓고 측정 창은 여전히 깨끗하다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-m3-'))
    const ctx = await createContext({})

    await runStart(ctx, { name: 'm3', launch: true, video: false, out, force: true })
    const active = await readActiveSession(ctx.serial)
    expect(active).not.toBeNull()

    await new Promise((r) => setTimeout(r, 15_000))

    const summary = await runStop(await createContext({}), { offline: false })
    expect(await readActiveSession(ctx.serial)).toBeNull()

    // 요약에 두 항목의 자리가 있어야 한다 — 값이든 사유든.
    for (const label of ['Thermal', 'Network']) {
      expect(summary, `${label} 줄 없음`).toContain(label)
    }

    // 원본이 남아 있으므로 기기 없이 재산출된다.
    const result = await extractRun(active!.runDir, {})
    expect(result.schema_version).toBe('1.1.0')

    // ---- 가장 중요한 단언. M3 이 기기로 보내는 명령을 둘 늘렸다. ----
    // 이 값이 0 이 아니면 새 명령(`dumpsys netstats` / `pm list packages -U`) 중 하나가
    // 측정 창 안으로 새어 들어간 것이다.
    expect(result.measurement_overhead.adb_commands_during_session).toBe(0)

    // 스냅샷 원본이 전/후 짝으로 남아 있다. 파일 이름 규약(`raw/<key>_<phase>.txt`)이
    // 바뀌거나 stop 이 종료 스냅샷을 안 찍으면 여기서 깨진다.
    for (const key of ['thermalservice', 'netstats', 'packages']) {
      for (const phase of ['before', 'after']) {
        const rel = join('raw', `${key}_${phase}.txt`)
        expect(existsSync(join(active!.runDir, rel)), `${rel} 없음`).toBe(true)
        expect(result.artifacts.raw, `${rel} 미등재`).toContain(rel)
      }
    }

    // ---- Thermal ----
    const thermal = result.metrics.thermal
    expect(thermal?.status, `thermal: ${thermal?.reason ?? ''}`).toBe('collected')
    const t = thermal!.data as ThermalData
    expect(t.zones.length).toBeGreaterThan(0)
    expect(t.hal_ready_before).toBe(true)
    expect(t.device_status_before).not.toBeNull()
    for (const z of t.zones) {
      expect(z.before_c, `${z.name}.before_c`).not.toBeNull()
      expect(z.after_c, `${z.name}.after_c`).not.toBeNull()
      expect(z.delta_c, `${z.name}.delta_c`).not.toBeNull()
    }
    // 온도가 **변한다**고 단언하지 않는다 — 에뮬 thermal HAL 은 상수를 돌려준다.

    /**
     * 중복 파싱 결함의 회귀 방어. 에뮬은 `Cached temperatures` 와
     * `Current temperatures from HAL` 에 같은 센서가 하나씩 있어서, 옛 파서는 존을 2개로
     * 만들었다. **존 1개짜리 기기가 오히려 이 결함을 정확히 드러낸다.**
     */
    const zoneKeys = t.zones.map((z) => `${String(z.type)} ${z.name}`)
    expect(new Set(zoneKeys).size).toBe(zoneKeys.length)
    for (const zones of [result.device.state_before.thermal_zones, result.device.state_after!.thermal_zones]) {
      expect(zones.map((z) => z.name)).toEqual([...new Set(zones.map((z) => z.name))])
      // 재산출된 배열이라 type/source 를 들고 있어야 한다 — 없으면 capture.json 의
      // 옛 값이 그대로 실린 것이고, 그 값에는 중복이 남아 있을 수 있다.
      for (const z of zones) expect(z.source, `${z.name}.source`).toBeDefined()
    }

    // ---- Network ----
    const network = result.metrics.network
    if (result.device.static.sdk_int >= 34) {
      expect(network?.status, `network: ${network?.reason ?? ''}`).toBe('collected')
      const n = network!.data as NetworkData
      expect(n.uid).toBe(result.target_app.uid)
      // 크기는 단언하지 않는다 — 세션 중 앱이 통신하지 않을 수 있다.
      for (const v of [n.rx_bytes, n.tx_bytes, n.rx_packets, n.tx_packets]) {
        expect(v).toBeGreaterThanOrEqual(0)
      }
      // uid 한정이 사실로 채워졌는지. null 이면 packages 스냅샷을 못 읽은 것이다 —
      // `[]` 와 다르고, 그 구분이 이 필드의 존재 이유다.
      expect(n.shared_uid_packages).not.toBeNull()
      expect(n.shared_uid_packages).toContain(result.target_app.package)
    } else {
      expect(network?.status).toBe('unsupported')
      expect(network?.reason_code).toBe('sdk_too_low')
    }
  })
})
