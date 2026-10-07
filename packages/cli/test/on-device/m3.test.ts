import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_UID_STATS_HEADER,
  createAdbContext,
  extractRun,
  type NetworkData,
  parseThermalZones,
  probeDevice,
  readActiveSession,
  type ThermalData,
} from '@perftracker/core'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'
import { DEVICE_OPTS, DEVICE_TARGET_APP, deviceCapabilities } from './target.js'

/**
 * `mAppUidStatsMap` 표에서 uid 한 행을 **collector 와 무관하게** 다시 읽는다.
 *
 * `parseAppUidStats` 를 부르지 않는 것이 요점이다. 같은 파서로 읽으면 컬럼이 뒤바뀌어도
 * 양쪽이 똑같이 뒤바뀌어 단언이 통과한다 — 델타 배선은 지키지만 컬럼 지도는 못 지킨다.
 * 여기서 한 번 더 읽으면 그 두 번째 눈이 생긴다.
 *
 * 앵커 규칙은 파서와 같다: `BPF map status:` 절의 `mAppUidStatsMap: OK` 를 배제하기 위해
 * **콜론 뒤가 비어 있는 줄**만 절의 머리로 본다.
 */
function readUidRow(
  path: string,
  uid: number,
): { rxBytes: number; rxPackets: number; txBytes: number; txPackets: number } | null {
  const lines = readFileSync(path, 'utf8').split('\n')
  const at = lines.findIndex((l) => /^\s*mAppUidStatsMap:\s*$/.test(l))
  if (at < 0) return null

  let i = at + 1
  while (i < lines.length && lines[i]!.trim().length === 0) i++
  // 헤더가 다르면 컬럼 지도를 모른다 — 추측해서 읽지 않는다.
  if ((lines[i] ?? '').trim().replace(/\s+/g, ' ') !== APP_UID_STATS_HEADER) return null

  for (let j = i + 1; j < lines.length; j++) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(lines[j]!)
    if (m === null) break
    // 헤더 순서 그대로: uid rxBytes rxPackets txBytes txPackets.
    // (AOSP 의 `StatsMapValue` 필드 순서와 **다르다** — 헤더가 정본이다.)
    if (Number(m[1]) !== uid) continue
    return {
      rxBytes: Number(m[2]),
      rxPackets: Number(m[3]),
      txBytes: Number(m[4]),
      txPackets: Number(m[5]),
    }
  }
  return null
}

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
    const ctx = await createAdbContext(DEVICE_OPTS)
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
    const caps = await deviceCapabilities()
    const out = mkdtempSync(join(tmpdir(), 'pt-m3-'))
    const ctx = await createContext(DEVICE_OPTS)

    await runStart(ctx, { app: DEVICE_TARGET_APP, name: 'm3', launch: true, out, force: true })
    const active = await readActiveSession(ctx.serial)
    expect(active).not.toBeNull()

    await new Promise((r) => setTimeout(r, 15_000))

    const output = await runStop(await createContext(DEVICE_OPTS), { offline: false })
    expect(await readActiveSession(ctx.serial)).toBeNull()

    // 요약을 찍지 않으므로 stop 이 남기는 것은 다음에 열 파일의 경로 하나다.
    expect(output).toContain(`${active!.runDir}/result.json`)

    // 원본이 남아 있으므로 기기 없이 재산출된다.
    const result = await extractRun(active!.runDir, {})
    expect(result.schema_version).toBe('1.2.0')

    // M3 의 두 메트릭이 **산출물에** 자리를 갖는다 — 값이든 사유든 (m2 와 같은 이유).
    for (const id of ['thermal', 'network']) {
      expect(result.metrics[id], `${id} 메트릭 없음`).toBeDefined()
    }

    // ---- 가장 중요한 단언. M3 이 기기로 보내는 명령을 둘 늘렸다. ----
    // 이 값이 0 이 아니면 새 명령(`dumpsys netstats` / `pm list packages -U`) 중 하나가
    // 측정 창 안으로 새어 들어간 것이다.
    expect(result.measurement_overhead.adb_commands_during_session).toBe(0)

    /**
     * 스냅샷 원본이 전/후 짝으로 남아 있다. 파일 이름 규약(`raw/<key>_<phase>.txt`)이
     * 바뀌거나 stop 이 종료 스냅샷을 안 찍으면 여기서 깨진다.
     *
     * **못 재는 지표의 스냅샷은 찍지 않는다.** `netstats` / `packages` 는 network collector 가
     * 요청하는 것이라, network 가 미지원인 기기(sdk 34 미만)에서는 그 파일이 없는 것이 정상이다.
     * 예전에는 이 목록이 고정이라 SM-A405S 에서 `netstats_before.txt 없음` 으로 실패했는데,
     * 그것은 도구가 **재지도 않을 것을 기기에 물어보지 않았다**는 뜻이라 오히려 옳은 동작이다.
     */
    const snapshotKeys = ['thermalservice']
    if (caps.supported.has('network')) snapshotKeys.push('netstats', 'packages')
    for (const key of snapshotKeys) {
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
    expect(t.hal_ready_before).toBe(true)
    expect(t.device_status_before).not.toBeNull()

    /**
     * 옛 단언은 `t.zones.length > 0` 하나였는데 `status === 'collected'` 가 그것을 이미
     * 함의한다 (존이 하나도 없으면 collector 가 `no_thermal_zones` / `thermal_hal_not_ready`
     * 로 멈춘다). 어떤 구현 변경으로도 깨질 수 없는 줄이었다.
     *
     * 대신 **원문을 다시 읽어** 존 목록을 대조한다. 이 단언이 지키는 것 셋:
     *   1. `zones` 가 before 스냅샷의 존 전부를 담는다 (하나도 잃지 않는다)
     *   2. `before_c` 가 그 원문의 값이다 (다른 스냅샷의 값이 새어 들지 않는다)
     *   3. **순서** — HAL 절의 순서를 먼저 싣고 cached 전용을 뒤에 붙인다.
     *      `ThermalDataSchema.zones` 의 `.describe()` 가 소비자에게 그렇게 공시한다.
     */
    const beforeZones = parseThermalZones(
      readFileSync(join(active!.runDir, 'raw', 'thermalservice_before.txt'), 'utf8'),
    )
    expect(beforeZones.length).toBeGreaterThan(0)
    expect(t.zones.slice(0, beforeZones.length).map((z) => `${String(z.type)} ${z.name} ${String(z.before_c)}`)).toEqual(
      beforeZones.map((z) => `${String(z.type)} ${z.name} ${String(z.celsius)}`),
    )
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
      /**
       * **이 한 줄이 결함 1 의 회귀 방어다.** 대상이 시스템 앱이면 옛 코드에서 이 값은
       * null 이었고, network 는 "대상 앱의 uid 를 알지 못해…" 로 멈췄다 — 기기가 그 값을
       * 주고 있고 이 도구가 매 세션 그 목록을 저장까지 하는데도.
       */
      expect(result.target_app.uid, '시스템 앱의 uid 를 해석하지 못했다').not.toBeNull()

      expect(network?.data, `network: ${network?.reason ?? ''}`).not.toBeNull()
      const n = network!.data as NetworkData
      expect(n.uid).toBe(result.target_app.uid)

      /**
       * 옛 단언은 네 필드에 `>= 0` 을 걸었는데 **어떤 구현 변경으로도 깨질 수 없었다.**
       * `NetworkDataSchema` 가 네 필드에 `.int().nonnegative()` 를 걸고 `extractRun` 은
       * `safeParse` 실패 시 던지며, 음수 델타는 애초에 `counter_went_backwards` 라
       * `status !== 'collected'` 가 되어 두 줄 위에서 잡힌다.
       *
       * 대신 **원문 두 개를 다시 읽어 델타를 직접 구한다.** 크기를 단언하지 않는다는
       * 성질은 그대로다 (세션 중 앱이 통신하지 않아 전부 0 이어도 통과한다) —
       * 그러면서 델타 계산 배선은 실제로 지킨다. `after` 를 그대로 싣거나, 뺄셈의 방향이
       * 뒤집히거나, 두 스냅샷을 바꿔 읽으면 여기서 깨진다.
       */
      const raw = (phase: 'before' | 'after') =>
        readUidRow(join(active!.runDir, 'raw', `netstats_${phase}.txt`), n.uid)
      const rb = raw('before')
      const ra = raw('after')
      expect(rb, 'netstats_before.txt 에서 uid 행을 못 읽었다').not.toBeNull()
      expect(ra, 'netstats_after.txt 에서 uid 행을 못 읽었다').not.toBeNull()

      expect({
        rx_bytes: n.rx_bytes,
        rx_packets: n.rx_packets,
        tx_bytes: n.tx_bytes,
        tx_packets: n.tx_packets,
      }).toEqual({
        rx_bytes: ra!.rxBytes - rb!.rxBytes,
        rx_packets: ra!.rxPackets - rb!.rxPackets,
        tx_bytes: ra!.txBytes - rb!.txBytes,
        tx_packets: ra!.txPackets - rb!.txPackets,
      })
      // uid 한정이 사실로 채워졌는지. null 이면 그 uid 를 쓰는 패키지를 **열거하지 못한**
      // 것이다 — `[]`("열거했고 없었다")와 다르고, 그 구분이 이 필드의 존재 이유다.
      expect(n.shared_uid_packages).not.toBeNull()
      expect(n.shared_uid_packages).toContain(result.target_app.package)

      /**
       * **status 가 관측된 사실에 매여 있는지.** 이 저장소가 내린 판단이 여기서 검증된다:
       * 이 uid 를 쓰는 패키지가 하나뿐일 때만 `collected` 이고, 둘 이상이면 값은 다 싣되
       * `partial` 이다 — 그 숫자가 여러 패키지의 합이라는 사실이 `status` 만 읽는 소비자
       * (= 대부분의 CI 게이트)에게도 닿아야 하기 때문이다.
       *
       * 조건문이지만 무르지 않다. 어느 쪽 가지든 단언이 걸리고, **어느 가지로 갈지를 정하는
       * 것은 테스트가 아니라 기기가 실제로 찍은 목록**이다. 이 기기에서는 uid 1000 을
       * 86개가 공유하므로 partial 가지로 간다.
       *
       * 깨지는 조건: 공유 사유를 지우면 86개짜리 결과가 `collected` 로 나와 실패한다.
       */
      const shared = n.shared_uid_packages!
      expect(network?.status, `network(공유 ${shared.length}개): ${network?.reason ?? ''}`).toBe(
        shared.length === 1 ? 'collected' : 'partial',
      )
      if (shared.length > 1) {
        // 사유 자리는 하나뿐이고 BPF 중복이 겹치면 그쪽이 먼저다 — 그래서 코드를 못 박지
        // 않고 "사유 없이 통과하지 않는다" 를 못 박는다. 어느 쪽이든 status 는 partial 이다.
        expect(network?.reason_code, '공유 uid 인데 사유가 비어 있다').not.toBeNull()
      }
    } else {
      expect(network?.status).toBe('unsupported')
      expect(network?.reason_code).toBe('sdk_too_low')
    }
  })
})
