import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type CpuData,
  PROCESS_RUNTIME_MIN_SDK,
  extractRun,
  type LogData,
  type MemoryData,
  readActiveSession,
  type StartupData,
} from '@perftracker/core'
import { runStart } from '../../src/commands/start.js'
import { runStop } from '../../src/commands/stop.js'
import { createContext } from '../../src/context.js'
import { deviceCapabilities, DEVICE_OPTS, DEVICE_TARGET_APP } from './target.js'

/**
 * 실기기 또는 에뮬레이터가 필요하다. `npm run test:device` 로만 실행된다.
 *
 * **에뮬레이터에서 정직하게 검증되지 않는 것은 여기서 단언하지 않는다.** 목록과 이유는
 * `docs/usage.md` 의 "검증 환경" 절에 있다 (계획서는 저장소에 없다 — 새로 clone 한
 * 사람이 실제로 찾아볼 수 있는 문서를 가리킨다). 요약하면: 주파수 **값의 크기**
 * (에뮬은 cpuinfo_max_freq=2), android.log 개수(SELinux 가 logdr 를 막음),
 * runtime.* 이 0 보다 큰 것(10ms 해상도), 그리고 `am start -W` 가 TotalTime 을 내는 것
 * (이 앱의 콜드 스타트가 12~15초라 ActivityManager 가 자주 `Status: timeout` 을 낸다 —
 * 실측 11회 중 4회). frame 수집은 이제 단언한다: `--launch` 세션 11회 모두 대상 앱의 프레임이
 * 잡혔다(옛 "에뮬 런처는 frametimeline 을 안 채운다" 는 런처만 조작한 세션의 관측이었다).
 */
describe('M2 기기 통합', () => {
  it('M2 가 요구하는 데이터소스가 이 기기에 등록되어 있다', async () => {
    const caps = await deviceCapabilities()

    /**
     * 이 넷은 **sdk 와 무관하다.** cpu / memory / log 는 데이터소스 등록 여부만 보고,
     * sdk 30 인 SM-A405S 에서도 셋 다 실제로 수집된다 (실측). 하나라도 없으면 회귀다.
     */
    for (const name of ['linux.process_stats', 'linux.sys_stats', 'linux.ftrace', 'android.log']) {
      expect(caps.dataSources, `${name} 미등록`).toContain(name)
    }

    /**
     * `frametimeline` 만 sdk 하한(31)이 있다. 이 기기가 frame 을 잰다고 판정됐으면 소스가
     * 있어야 하고, 못 잰다고 판정됐으면 **왜 못 재는지 말해야** 한다 — 조용히 빠지는 것과
     * 이유를 대는 것은 다르다.
     */
    if (caps.supported.has('frame')) {
      expect(caps.dataSources, 'frametimeline 미등록').toContain('android.surfaceflinger.frametimeline')
    } else {
      expect(caps.unsupported.get('frame'), 'frame 이 미지원인데 사유가 없음').toMatch(/sdk|데이터소스/)
    }
  })

  it('start → stop 이 M2 메트릭 다섯 개를 값이든 사유든 내놓는다', async () => {
    const caps = await deviceCapabilities()
    const out = mkdtempSync(join(tmpdir(), 'pt-m2-'))
    const ctx = await createContext(DEVICE_OPTS)

    await runStart(ctx, { app: DEVICE_TARGET_APP, name: 'm2', launch: true, out, force: true })
    const active = await readActiveSession(ctx.serial)
    expect(active).not.toBeNull()

    // 폴링 주기가 1초라 delta 를 내려면 표본이 여러 개 필요하다.
    await new Promise((r) => setTimeout(r, 15_000))

    const output = await runStop(await createContext(DEVICE_OPTS), { offline: false })
    expect(await readActiveSession(ctx.serial)).toBeNull()

    // 요약을 찍지 않으므로 stop 이 남기는 것은 다음에 열 파일의 경로 하나다.
    expect(output).toContain(`${active!.runDir}/result.json`)

    // 원본이 남아 있으므로 기기 없이 재산출된다.
    const result = await extractRun(active!.runDir, {})
    expect(result.schema_version).toBe('1.2.0')

    // M2 의 다섯 메트릭이 **산출물에** 자리를 갖는다 — 값이든 사유든. 예전에는 이것을 터미널
    // 요약의 글자로 확인했는데, 그러면 렌더링이 지키던 것이 산출물의 계약처럼 읽힌다.
    for (const id of ['frame', 'startup', 'cpu', 'memory', 'log']) {
      expect(result.metrics[id], `${id} 메트릭 없음`).toBeDefined()
    }
    expect(result.measurement_overhead.adb_commands_during_session).toBe(0)

    // --- 에뮬레이터에서도 정직하게 참인 단언들 ---

    // 렌더: `dumpsys gfxinfo` 세션 전후 차이라 버전 하한이 없다 — 어느 기기에서든 나와야 한다.
    // 프레임 **수**는 단언하지 않는다 — 15초 세션이라 통계적 의미는 실기기 몫이다.
    const hwui = result.metrics.hwui
    if (hwui !== undefined) {
      expect(hwui.status, `hwui: ${hwui.reason ?? ''}`).toMatch(/^(collected|partial)$/)
      expect(hwui.data, `hwui: ${hwui.reason ?? ''}`).not.toBeNull()
      expect(hwui.data!.total_frames ?? 0).toBeGreaterThan(0)
    }

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
    // 내는 경우가 흔하다 (docs/usage.md "검증 환경" 절에 실측과 함께 적어 뒀다).
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
    expect(cpuData.device_samples).toBeGreaterThanOrEqual(2)
    expect(cpuData.device_total_busy_pct).toBeGreaterThanOrEqual(0)
    expect(cpuData.device_total_busy_pct).toBeLessThanOrEqual(100)
    expect(cpuData.device_per_core.length).toBeGreaterThan(0)
    for (const core of cpuData.device_per_core) {
      expect(core.busy_pct).toBeGreaterThanOrEqual(0)
      expect(core.busy_pct).toBeLessThanOrEqual(100)
    }
    // 주파수는 **필드의 존재**만 단언한다. 에뮬레이터에서 ftrace power/cpu_frequency 이벤트가
    // 실제로 흐르는 것은 실측으로 확인된 사실이므로 null 이면 회귀다. 값의 크기는 보지 않는다 —
    // 이 이미지의 cpuinfo_max_freq 는 2 이고 그것은 kHz 가 아니다.
    expect(cpuData.device_frequency, `cpu: ${cpu?.reason ?? ''}`).not.toBeNull()
    expect(cpuData.device_frequency!.length).toBeGreaterThan(0)

    /**
     * CPU **앱 단위**는 지표 지원 여부와 별개의 하한을 갖는다.
     *
     * 앱별 CPU 시간은 트레이스의 `runtime.user_ns` / `runtime.kernel_ns` 카운터에서 나오고,
     * 그 카운터는 process_stats 의 `record_process_runtime` 을 켜야 찍힌다. 그런데 그 필드는
     * perfetto v44 에 들어와서 **sdk 35 미만 기기에는 존재하지 않는다** — 넣으면 기기가
     * config 전체를 거부하므로 `processStatsBlock` 이 sdk 로 가른다 (`PROCESS_RUNTIME_MIN_SDK`).
     *
     * 그래서 sdk 30 인 SM-A405S 에서 `cpu` 는 **지원되는 지표**이면서도 앱 자리는 비어 있다.
     * 스펙이 볼 것은 "값이 있다" 가 아니라 **"기기 전역은 실었고 앱 자리는 0 으로 채우지
     * 않았으며 왜 비었는지 말한다"** 이다.
     */
    if (caps.sdkInt >= PROCESS_RUNTIME_MIN_SDK) {
      // 이 세션은 `--launch` 라 대상 앱이 반드시 떠 있다. 앱 자리가 null 이면 회귀다
      // (기기 전역 값만 내던 옛 동작이 그 모양이었다).
      expect(cpuData.app, `cpu: ${cpu?.reason ?? ''}`).not.toBeNull()
      expect(cpuData.app!.process.startsWith(result.target_app.package)).toBe(true)
      expect(cpuData.app!.total_ms).toBe(cpuData.app!.user_ms + cpuData.app!.kernel_ms)
      // 한 프로세스가 기기 전체 CPU 시간보다 많이 쓸 수는 없다. 분모가 벽시계였다면
      // (또는 코어 하나였다면) 이 상계가 성립하지 않는다.
      expect(cpuData.app!.share_of_device_cpu_pct).toBeGreaterThanOrEqual(0)
      expect(cpuData.app!.share_of_device_cpu_pct).toBeLessThanOrEqual(100)
    } else {
      expect(cpuData.app, 'sdk 35 미만인데 앱 단위 CPU 가 채워졌다').toBeNull()
      // 비어 있는 이유를 말해야 한다 — 조용히 null 이면 소비자는 "안 썼다" 로 읽는다.
      expect(cpu?.reason_code, 'cpu 앱 자리가 비었는데 사유가 없음').not.toBeNull()
      // 기기 전역은 그대로 실린다. 앱을 못 쟀다고 전체를 버리지 않는다.
      expect(cpuData.device_total_busy_pct).toBeGreaterThanOrEqual(0)
    }

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

    /**
     * Overhead. 크기는 보지 않는다 — `runtime.*` 는 10ms 단위라 짧은 세션에서 0 이 정당하다.
     *
     * **CPU 두 필드는 앱 단위 CPU 와 같은 카운터에서 나온다** (`record_process_runtime`,
     * sdk 35+). `collectors/blocks.ts` 가 그 사실을 이미 적어 두고 있다:
     * "이 필드가 빠진 세션에서는 measurement_overhead 의 CPU 필드가 null 이 된다 —
     *  null 은 '안 쟀다' 이고, 그것이 이 기기에서 참인 문장이다."
     * RSS 는 다른 카운터라 sdk 와 무관하게 나온다.
     */
    const o = result.measurement_overhead
    expect(o.tracing_processes_peak_rss_kb).not.toBeNull()
    expect(o.tracing_processes_peak_rss_kb).toBeGreaterThan(0)

    if (caps.sdkInt >= PROCESS_RUNTIME_MIN_SDK) {
      expect(o.tracing_processes_cpu_time_ms).not.toBeNull()
      expect(o.tracing_processes_cpu_time_ms).toBeGreaterThanOrEqual(0)
      expect(o.tracing_processes_cpu_share_pct).not.toBeNull()
      expect(o.tracing_processes_cpu_share_pct).toBeLessThan(100)
    } else {
      // 0 이 아니라 null 이어야 한다. 0 이면 "트레이싱이 CPU 를 안 썼다" 는 없던 사실이 된다.
      expect(o.tracing_processes_cpu_time_ms, 'sdk 35 미만인데 0 으로 채워졌다').toBeNull()
      expect(o.tracing_processes_cpu_share_pct, 'sdk 35 미만인데 0 으로 채워졌다').toBeNull()
    }

    // Log: 이 에뮬레이터 이미지는 SELinux 가 logdr 를 막아 항상 비어 있다.
    // 그래서 "개수가 맞다" 가 아니라 "빈 것을 0 이라고 우기지 않는다" 를 검증한다.
    const log = result.metrics.log
    expect(log?.status).toMatch(/^(collected|partial)$/)
    if (log?.data === null) {
      expect(log.reason_code).toBe('no_log_entries')
    }

    const logData = log?.data as LogData | null
    if (logData !== null) {
      // 앱 단위 개수가 나와야 한다 — `--launch` 세션이라 앱 프로세스가 트레이스에 있다.
      expect(logData.app, `log: ${log?.reason ?? ''}`).not.toBeNull()
      expect(logData.app!.process.startsWith(result.target_app.package)).toBe(true)
      // **필터가 실제로 좁히는지**를 본다. upid 조건을 지우면 두 값이 같아진다.
      // (기기 전역에는 system_server / surfaceflinger 등 다른 프로세스의 줄이 반드시 섞인다 —
      //  실측: 실기기 세션에서 앱 37줄 대 기기 전역 1,507줄.)
      expect(logData.app!.total).toBeLessThan(logData.device_total)
    }

    // **여러 지표가 같은 프로세스를 가리킨다.** 이것이 `resolveAppProcess` 를 공유하는
    // 이유이고, 어느 collector 하나가 자기만의 규칙으로 되돌아가면 여기서 깨진다.
    // (cpu 앱 자리는 sdk 35 미만에서 비어 있으므로 있을 때만 본다 — 위 주석 참조.)
    if (cpuData.app != null) expect(cpuData.app.pid).toBe(memData.pid)
    if (logData?.app != null) expect(logData.app.pid).toBe(memData.pid)
  })

  it('--launch 없이 시작하면 startup 이 skipped 다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'pt-m2-nolaunch-'))
    const ctx = await createContext(DEVICE_OPTS)

    await runStart(ctx, { app: DEVICE_TARGET_APP, name: 'm2-nolaunch', launch: false, out, force: true })
    const active = await readActiveSession(ctx.serial)

    await new Promise((r) => setTimeout(r, 5_000))
    await runStop(await createContext(DEVICE_OPTS), { offline: false })

    const result = await extractRun(active!.runDir, {})
    expect(result.metrics.startup?.status).toBe('skipped')
    expect(result.metrics.startup?.reason_code).toBe('launch_not_requested')
  })
})
