import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAdbContext,
  type CpuData,
  extractRun,
  type MemoryData,
  probeDevice,
  readActiveSession,
  type StartupData,
} from '@perftracker/core'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'

/**
 * 실기기 또는 에뮬레이터가 필요하다. `npm run test:device` 로만 실행된다.
 *
 * **에뮬레이터에서 정직하게 검증되지 않는 것은 여기서 단언하지 않는다.** 목록과 이유는
 * 저장소 루트 `README.md` 의 "검증 환경" 절에 있다 (계획서는 저장소에 없다 — 새로 clone 한
 * 사람이 실제로 찾아볼 수 있는 문서를 가리킨다). 요약하면: 주파수 **값의 크기**
 * (에뮬은 cpuinfo_max_freq=2), android.log 개수(SELinux 가 logdr 를 막음),
 * frame 수집 성공(에뮬 런처는 frametimeline 을 안 채움), runtime.* 이 0 보다 큰 것(10ms 해상도).
 */
describe('M2 기기 통합', () => {
  it('M2 가 요구하는 데이터소스가 이 기기에 등록되어 있다', async () => {
    const ctx = await createAdbContext({})
    const probe = await probeDevice(ctx.adb)

    for (const name of [
      'android.surfaceflinger.frametimeline',
      'linux.process_stats',
      'linux.sys_stats',
      'linux.ftrace',
      'android.log',
    ]) {
      expect(probe.dataSources, `${name} 미등록`).toContain(name)
    }
  })

  it('start → stop 이 M2 메트릭 다섯 개를 모두 내놓는다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-m2-'))
    const ctx = await createContext({})

    await runStart(ctx, { name: 'm2', launch: true, video: false, out, force: true })
    const active = await readActiveSession(ctx.serial)
    expect(active).not.toBeNull()

    // 폴링 주기가 1초라 delta 를 내려면 표본이 여러 개 필요하다.
    await new Promise((r) => setTimeout(r, 15_000))

    const summary = await runStop(await createContext({}), { offline: false })
    expect(await readActiveSession(ctx.serial)).toBeNull()

    // 요약에 다섯 항목의 자리가 모두 있어야 한다 — 값이든 사유든.
    for (const label of ['Frame', 'Startup', 'CPU', 'Memory', 'Log', 'Overhead']) {
      expect(summary, `${label} 줄 없음`).toContain(label)
    }

    // 원본이 남아 있으므로 기기 없이 재산출된다.
    const result = await extractRun(active!.runDir, {})
    expect(result.schema_version).toBe('1.1.0')
    expect(result.measurement_overhead.adb_commands_during_session).toBe(0)

    // --- 에뮬레이터에서도 정직하게 참인 단언들 ---

    // Startup.
    //
    // 옛 단언은 `not.toBe('skipped')` 였는데, `--launch` 세션에서 startup 이 skipped 가 되는
    // 경로는 **존재하지 않는다** (`collectors/startup.ts` 는 launchRequested 가 false 일 때만
    // skipped 다). 어떤 구현 변경으로도 깨지지 않는 단언이라 아무것도 지키지 않았다.
    //
    // 실제로 지켜야 할 것은 두 가지다:
    //   (1) 값이 나오면 그 값이 진짜 시작 시간이다.
    //   (2) 값이 없으면 그 이유가 **기기가 실제로 말한 것**이어야 한다 — 도구가 지어낸
    //       "앱이 다시 실행되지 않았을 수 있음" 이 아니라.
    // 이 앱의 콜드 스타트는 이 에뮬레이터에서 12~15초라 `am start -W` 가 `Status: timeout` 을
    // 내는 경우가 흔하다 (README "검증 환경" 절에 실측과 함께 적어 뒀다).
    const startup = result.metrics.startup
    expect(startup?.status, `startup: ${startup?.reason ?? ''}`).toMatch(/^(collected|partial)$/)
    if (startup?.data != null) {
      expect(startup.status).toBe('collected')
      expect(startup.reason_code).toBeNull()
      expect((startup.data as StartupData).total_time_ms).toBeGreaterThan(0)
    } else {
      expect(startup?.reason_code, `startup: ${startup?.reason ?? ''}`).toBe('launch_wait_timed_out')
      expect(result.warnings.map((w) => w.code)).toContain('app_launch_time_unmeasured')
    }

    // 시작 시간을 못 쟀더라도 앱이 실제로 떴다는 사실은 pid 로 확인된다 —
    // 옛 경고 문구("앱이 다시 실행되지 않았을 수 있음")가 왜 거짓이었는지가 여기 있다.
    expect(result.target_app.pid).not.toBeNull()

    // CPU: 사용률은 나와야 한다. 주파수 값은 보지 않는다 (에뮬은 kHz 가 아니다).
    const cpu = result.metrics.cpu
    expect(cpu?.status, `cpu: ${cpu?.reason ?? ''}`).toMatch(/^(collected|partial)$/)
    const cpuData = cpu?.data as CpuData
    expect(cpuData.samples).toBeGreaterThanOrEqual(2)
    expect(cpuData.total_busy_pct).toBeGreaterThanOrEqual(0)
    expect(cpuData.total_busy_pct).toBeLessThanOrEqual(100)
    expect(cpuData.per_core.length).toBeGreaterThan(0)
    for (const core of cpuData.per_core) {
      expect(core.busy_pct).toBeGreaterThanOrEqual(0)
      expect(core.busy_pct).toBeLessThanOrEqual(100)
    }
    // 주파수는 **필드의 존재**만 단언한다. 에뮬레이터에서 ftrace power/cpu_frequency 이벤트가
    // 실제로 흐르는 것은 실측으로 확인된 사실이므로 null 이면 회귀다. 값의 크기는 보지 않는다 —
    // 이 이미지의 cpuinfo_max_freq 는 2 이고 그것은 kHz 가 아니다.
    expect(cpuData.frequency, `cpu: ${cpu?.reason ?? ''}`).not.toBeNull()
    expect(cpuData.frequency!.length).toBeGreaterThan(0)

    // Memory: 앱 RSS 와 시스템 메모리 둘 다 나와야 한다.
    //
    // `collected` 하나로 못 박지 않는 이유는 레이스가 남아서가 아니다 — 트레이스가 앱을
    // `zygote64` 로 기록한 세션에서 이 도구는 캡처한 pid 로 앱을 **찾아내고**, 그 사실을
    // `partial` + `process_name_stale_in_trace` 로 정직하게 남긴다. 그것이 정상 동작이다.
    // 그래서 status 대신 **실제로 중요한 것**을 단언한다: 앱을 찾았는가, 값이 있는가,
    // 그리고 옛 결함(`process_not_in_trace` 로 값을 통째로 잃던 것)이 돌아오지 않았는가.
    const memory = result.metrics.memory
    expect(memory?.status, `memory: ${memory?.reason ?? ''}`).toMatch(/^(collected|partial)$/)
    expect(memory?.reason_code, `memory: ${memory?.reason ?? ''}`).not.toBe('process_not_in_trace')
    expect(memory?.data, `memory: ${memory?.reason ?? ''}`).not.toBeNull()
    const memData = memory?.data as MemoryData
    expect(memData.rss.max_kb).toBeGreaterThan(0)
    // 확인되지 않은 이름이 결과에 실리지 않는다 (Defect 0). 멀티프로세스 앱이면
    // `패키지:서브프로세스` 일 수 있으므로 접두어까지만 본다 — 요점은 `zygote64` 같은
    // 무관한 이름이 절대 오지 않는다는 것이다.
    expect(memData.process.startsWith(result.target_app.package)).toBe(true)
    expect(memData.system).not.toBeNull()
    expect(memData.system!.mem_total_kb).toBeGreaterThan(0)

    // Overhead: 두 필드가 null 이 아니어야 한다. 크기는 보지 않는다 —
    // runtime.* 는 10ms 단위라 짧은 세션에서 0 이 정당하다.
    const o = result.measurement_overhead
    expect(o.tracing_processes_cpu_time_ms).not.toBeNull()
    expect(o.tracing_processes_cpu_time_ms).toBeGreaterThanOrEqual(0)
    expect(o.tracing_processes_peak_rss_kb).not.toBeNull()
    expect(o.tracing_processes_peak_rss_kb).toBeGreaterThan(0)
    expect(o.tracing_processes_cpu_share_pct).not.toBeNull()
    expect(o.tracing_processes_cpu_share_pct).toBeLessThan(100)

    // Log: 이 에뮬레이터 이미지는 SELinux 가 logdr 를 막아 항상 비어 있다.
    // 그래서 "개수가 맞다" 가 아니라 "빈 것을 0 이라고 우기지 않는다" 를 검증한다.
    const log = result.metrics.log
    expect(log?.status).toMatch(/^(collected|partial)$/)
    if (log?.data === null) {
      expect(log.reason_code).toBe('no_log_entries')
    }
  })

  it('--launch 없이 시작하면 startup 이 skipped 다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-m2-nolaunch-'))
    const ctx = await createContext({})

    await runStart(ctx, { name: 'm2-nolaunch', launch: false, video: false, out, force: true })
    const active = await readActiveSession(ctx.serial)

    await new Promise((r) => setTimeout(r, 5_000))
    await runStop(await createContext({}), { offline: false })

    const result = await extractRun(active!.runDir, {})
    expect(result.metrics.startup?.status).toBe('skipped')
    expect(result.metrics.startup?.reason_code).toBe('launch_not_requested')
  })
})
