import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CPU_TIMES_SQL } from '../../src/collectors/cpu.js'
import { FRAME_PROCESS_SQL, frameDurationsSql } from '../../src/collectors/frame.js'
import { SessionStateError } from '../../src/errors.js'
import { BUFFER_STATS_SQL, extractRun, readSnapshots } from '../../src/extract/run.js'
import { TRACING_OVERHEAD_SQL } from '../../src/extract/overhead.js'
import { writeCaptureManifest } from '../../src/session/manifest.js'
import { type ActiveSession, writeActiveSession, writeRunSession } from '../../src/session/state.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const PKG = 'com.nhn.android.webtoon'

function deviceState() {
  return {
    captured_at: '2026-07-25T14:32:10.000Z',
    battery_level: 68,
    battery_temp_c: 34.8,
    charging: true,
    connection: 'usb' as const,
    screen_brightness: 131,
    power_save_mode: false,
    network: 'wifi',
    mem_available_kb: 3511516,
    animator_duration_scale: 1,
    thermal_zones: [{ name: 'AP', celsius: 37.1 }],
  }
}

async function makeRun(
  overrides: {
    trace?: string | null
    sdkInt?: number
    state?: 'running' | 'completed' | 'aborted' | 'failed'
    endedAt?: string | null
    adbCommandsDuringSession?: number
    launch?: boolean
    appPid?: number | null
  } = {},
): Promise<string> {
  const runDir = mkdtempSync(join(tmpdir(), 'pt-extract-'))
  const trace = overrides.trace === undefined ? 'trace.perfetto-trace' : overrides.trace
  if (trace) writeFileSync(join(runDir, trace), 'fake')
  const endedAt = overrides.endedAt === undefined ? '2026-07-25T14:32:52.735Z' : overrides.endedAt

  await writeRunSession(
    runDir,
    {
      version: 1,
      id: 'a3f9c1',
      name: '홈 스크롤',
      serial: 'S1',
      packageName: PKG,
      runDir,
      perfettoKey: 'perftracker_a3f9c1',
      remoteTracePath: '/data/misc/perfetto-traces/perftracker_a3f9c1.pftrace',
      startedAt: '2026-07-25T14:32:10.000Z',
      configuredDurationMs: 1_800_000,
      options: { launch: overrides.launch ?? true, video: false },
      startup:
        (overrides.launch ?? true) ? { totalTimeMs: 1842, launchState: 'COLD' } : null,
      ...(overrides.appPid !== undefined ? { appPid: overrides.appPid } : {}),
    },
    {
      ...(endedAt !== null ? { endedAt } : {}),
      state: overrides.state ?? 'completed',
    },
  )

  await writeCaptureManifest(runDir, {
    version: 1,
    device: {
      serial: 'S1',
      static: {
        manufacturer: 'samsung',
        model: 'SM-S931N',
        android_release: '16',
        sdk_int: overrides.sdkInt ?? 36,
        build_fingerprint: 'x',
        abis: ['arm64-v8a'],
        soc_model: 'SM8750',
        soc_manufacturer: 'QTI',
        cpu: { core_count: 8, clusters: [{ cpus: [0], max_freq_khz: 3532800 }] },
        memory_total_kb: 11380228,
        display: {
          width_px: 1080,
          height_px: 2340,
          density_dpi: 480,
          active_refresh_rate_hz: 120,
          supported_refresh_rates_hz: [60, 120],
        },
      },
      state_before: deviceState(),
      state_after: deviceState(),
    },
    target_app: {
      package: PKG,
      label: '네이버 웹툰',
      label_source: 'apk_resources',
      version_name: '2.46.0',
      version_code: 24600400,
      uid: 10359,
      install_source: 'com.android.vending',
      launcher_activity: 'com.naver.webtoon.splash.SplashActivity',
      render_process: null,
      pid: null,
    },
    env: {
      sdkInt: overrides.sdkInt ?? 36,
      dataSources: ['android.surfaceflinger.frametimeline'],
    },
    warnings: [{ code: 'charging_during_session', message: 'USB 충전 중이었음' }],
    adb_commands_during_session: overrides.adbCommandsDuringSession ?? 0,
    artifacts: { trace, video: null, raw: ['raw/battery_before.txt'] },
  })

  return runDir
}

function runner(tracePath: string): FakeProcessRunner {
  return new FakeProcessRunner()
    .on(`query ${tracePath} ${FRAME_PROCESS_SQL}`, {
      stdout: `"j"\n"[{"upid":2,"pid":24193,"name":"${PKG}","frames":4}]"\n`,
    })
    .on(`query ${tracePath} ${frameDurationsSql(2)}`, {
      stdout: '"j"\n"[8000000,20000000,4000000,900000000]"\n',
    })
    .on(`query ${tracePath} ${BUFFER_STATS_SQL}`, { stdout: '"j"\n"[]"\n' })
    .on(`query ${tracePath} ${TRACING_OVERHEAD_SQL}`, {
      stdout:
        '"j"\n"[{"process":"/system/bin/traced","counter":"mem.rss","first":3346432,"last":3477504},' +
        '{"process":"/system/bin/traced","counter":"runtime.user_ns","first":0,"last":40000000},' +
        '{"process":"/system/bin/traced","counter":"runtime.kernel_ns","first":0,"last":110000000}]"\n',
    })
    .on(`query ${tracePath} ${CPU_TIMES_SQL}`, {
      stdout:
        '"j"\n"[{"cpu":0,"counter":"cpu.times.idle_ns","first":0,"last":11010000000,' +
        '"first_ts":0,"last_ts":11055000000,"samples":13}]"\n',
    })
}

describe('extractRun', () => {
  it('스키마를 통과하는 result.json 을 만든다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(trace),
      toolVersion: '0.1.0',
    })

    expect(result.schema_version).toBe('1.1.0')
    expect(result.metrics.frame.status).toBe('collected')
    expect(result.metrics.frame.data?.total_frames).toBe(4)
    expect(result.session.duration_ms).toBe(42_735)
    expect(result.target_app.label).toBe('네이버 웹툰')
    expect(result.device.static.model).toBe('SM-S931N')
    expect(result.references.length).toBeGreaterThan(0)
    expect(result.warnings[0]?.code).toBe('charging_during_session')
  })

  it('result.json 을 디스크에 쓴다', async () => {
    const runDir = await makeRun()

    await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    const written = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8')) as Record<string, unknown>
    expect(written['schema_version']).toBe('1.1.0')
  })

  it('Android 12 미만이면 frame 을 unsupported 로 남긴다', async () => {
    const runDir = await makeRun({ sdkInt: 30 })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.metrics.frame.status).toBe('unsupported')
    // 기계가 매칭하는 것은 코드, 사람이 읽는 것은 문장 — 두 필드가 따로 있다.
    expect(result.metrics.frame.reason_code).toBe('sdk_too_low')
    expect(result.metrics.frame.reason).toContain('sdk_int=30')
    expect(result.metrics.frame.data).toBeNull()
  })

  it('트레이스가 없으면 trace_missing 코드를 남긴다', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })

    expect(result.metrics.frame.reason_code).toBe('trace_missing')
  })

  it('수집에 성공하면 target_app 의 렌더 프로세스와 pid 를 채운다', async () => {
    const runDir = await makeRun()

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.target_app.render_process).toBe(PKG)
    expect(result.target_app.pid).toBe(24193)
    expect(result.metrics.frame.reason_code).toBeNull()
  })

  it('렌더 프로세스를 못 찾은 것과 프레임이 없는 것을 다른 코드로 구분한다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const noFrames = runner(trace).on(`query ${trace} ${frameDurationsSql(2)}`, {
      stdout: '"j"\n"[]"\n',
    })

    const result = await extractRun(runDir, { traceProcessorPath: process.execPath, runner: noFrames })

    expect(result.metrics.frame.status).toBe('partial')
    expect(result.metrics.frame.reason_code).toBe('no_frames')
    expect(result.metrics.frame.reason).toContain('프레임')
  })

  it('트레이스가 없으면 frame 을 failed 로 남기고 나머지는 채운다', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })

    expect(result.metrics.frame.status).toBe('failed')
    expect(result.device.static.model).toBe('SM-S931N')
  })

  it('쿼리가 터져도 다른 필드는 살린다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const broken = new FakeProcessRunner()
      .on(`query ${trace} ${FRAME_PROCESS_SQL}`, { code: 1, stderr: 'no such table' })
      .on(`query ${trace} ${BUFFER_STATS_SQL}`, { stdout: '"j"\n"[]"\n' })

    const result = await extractRun(runDir, { traceProcessorPath: process.execPath, runner: broken })

    expect(result.metrics.frame.status).toBe('failed')
    expect(result.metrics.frame.reason_code).toBe('query_failed')
    expect(result.metrics.frame.reason).toContain('no such table')
    expect(result.measurement_overhead.trace_buffer_overrun).toBe(false)
  })

  it('아직 stop 하지 않은 run 디렉토리에도 결과를 낸다 (raw ZodError 아님)', async () => {
    const runDir = await makeRun({ trace: null, state: 'running', endedAt: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
      home: mkdtempSync(join(tmpdir(), 'pt-home-')),
    })

    expect(result.session.state).toBe('running')
    expect(result.metrics.frame.status).toBe('failed')
    expect(result.warnings.map((w) => w.code)).toContain('session_still_running')
    // 끝나지 않은 세션의 길이는 0 이 아니라 "모른다" 다 — 아래 M4 블록 참고.
    expect(result.session.duration_ms).toBeNull()
  })

  it('session.json 의 version 이 다르면 조용히 잘못 읽지 않고 거부한다', async () => {
    const runDir = await makeRun()
    const file = join(runDir, 'session.json')
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    writeFileSync(file, JSON.stringify({ ...stored, version: 2 }))

    await expect(
      extractRun(runDir, { traceProcessorPath: process.execPath, runner: new FakeProcessRunner() }),
    ).rejects.toBeInstanceOf(SessionStateError)
  })

  it('capture.json 의 version 이 다르면 거부한다', async () => {
    const runDir = await makeRun()
    const file = join(runDir, 'capture.json')
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    writeFileSync(file, JSON.stringify({ ...stored, version: 99 }))

    await expect(
      extractRun(runDir, { traceProcessorPath: process.execPath, runner: new FakeProcessRunner() }),
    ).rejects.toThrow(/version/)
  })

  it('capture.json 이 깨져 있으면 사람이 읽는 오류를 낸다', async () => {
    const runDir = await makeRun()
    writeFileSync(join(runDir, 'capture.json'), '{not json')

    await expect(
      extractRun(runDir, { traceProcessorPath: process.execPath, runner: new FakeProcessRunner() }),
    ).rejects.toBeInstanceOf(SessionStateError)
  })

  it('측정 창 위반 횟수를 result.json 까지 옮긴다', async () => {
    const runDir = await makeRun({ adbCommandsDuringSession: 3 })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.measurement_overhead.adb_commands_during_session).toBe(3)
  })

  /**
   * 같은 계열의 거짓 청정 신호. `false` 는 "넘치지 않았다" 로 읽히는데, 트레이스가 없으면
   * 우리는 **본 적조차 없다**. stop 하지 않은 세션과 aborted 세션이 정확히 이 경우다.
   */
  it('트레이스가 없으면 버퍼가 안 넘쳤다고 말하지 않는다', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })

    expect(result.measurement_overhead.trace_buffer_overrun).toBeNull()
  })

  it('버퍼 통계 쿼리가 터지면 false 가 아니라 null 이다 — 못 본 것은 청정이 아니다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const broken = runner(trace).on(`query ${trace} ${BUFFER_STATS_SQL}`, {
      code: 1,
      stderr: 'no such table: stats',
    })

    const result = await extractRun(runDir, { traceProcessorPath: process.execPath, runner: broken })

    expect(result.metrics.frame.status).toBe('collected')
    expect(result.measurement_overhead.trace_buffer_overrun).toBeNull()
  })

  it('버퍼 오버런을 사실로 기록한다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const overrun = runner(trace).on(`query ${trace} ${BUFFER_STATS_SQL}`, {
      stdout: '"j"\n"[{"name":"traced_buf_chunks_overwritten","value":12}]"\n',
    })

    const result = await extractRun(runDir, { traceProcessorPath: process.execPath, runner: overrun })

    expect(result.measurement_overhead.trace_buffer_overrun).toBe(true)
  })

  it('startup 을 session.json 의 am start -W 결과에서 채운다', async () => {
    const runDir = await makeRun()

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.metrics.startup?.status).toBe('collected')
    expect(result.metrics.startup?.data).toEqual({ total_time_ms: 1842, launch_state: 'COLD' })
  })

  it('트레이스가 없어도 startup 은 살아남는다 — 트레이스에서 나온 값이 아니다', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })

    expect(result.metrics.frame.status).toBe('failed')
    expect(result.metrics.startup?.status).toBe('collected')
    expect(result.metrics.startup?.data).toEqual({ total_time_ms: 1842, launch_state: 'COLD' })
  })

  it('--launch 없이 시작한 세션의 startup 은 skipped 다', async () => {
    const runDir = await makeRun({ launch: false })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.metrics.startup?.status).toBe('skipped')
    expect(result.metrics.startup?.reason_code).toBe('launch_not_requested')
    expect(result.metrics.startup?.data).toBeNull()
  })

  it('measurement_overhead 의 CPU·RSS 를 실제로 채운다', async () => {
    const runDir = await makeRun()

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    const o = result.measurement_overhead
    expect(o.tracing_processes_cpu_time_ms).toBe(150)
    expect(o.tracing_processes_peak_rss_kb).toBe(3396)
    expect(o.tracing_processes_cpu_share_pct).toBe(1.36)
  })

  it('트레이스가 없으면 오버헤드는 null 로 남는다 — 0 이 아니라 "안 쟀다"', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
    })

    expect(result.measurement_overhead.tracing_processes_cpu_time_ms).toBeNull()
    expect(result.measurement_overhead.tracing_processes_cpu_share_pct).toBeNull()
    expect(result.measurement_overhead.tracing_processes_peak_rss_kb).toBeNull()
  })

  /**
   * 에뮬레이터 실측 재현 (Defect 0). `--launch` 로 띄운 앱이 트레이스에는 `zygote64` 라는
   * 이름으로 들어 있고, capture 단계가 받아 둔 pid 만이 그것을 대상 앱과 이어 준다.
   */
  describe('트레이스의 프로세스 이름이 낡았을 때', () => {
    const STALE_CANDIDATES =
      '[{"upid":254,"pid":551,"name":"system_server","frames":37},' +
      '{"upid":309,"pid":6037,"name":"zygote64","frames":11}]'

    function staleRunner(tracePath: string): FakeProcessRunner {
      return runner(tracePath)
        .on(`query ${tracePath} ${FRAME_PROCESS_SQL}`, { stdout: `"j"\n"${STALE_CANDIDATES}"\n` })
        .on(`query ${tracePath} ${frameDurationsSql(309)}`, {
          stdout: '"j"\n"[8000000,20000000,4000000]"\n',
        })
    }

    it('frame 이 zygote64 대신 패키지명을 내고 그 근거를 사유로 남긴다', async () => {
      const runDir = await makeRun({ appPid: 6037 })
      const result = await extractRun(runDir, {
        traceProcessorPath: process.execPath,
        runner: staleRunner(join(runDir, 'trace.perfetto-trace')),
      })

      expect(result.metrics.frame.data?.process).toBe(PKG)
      expect(result.metrics.frame.data?.pid).toBe(6037)
      expect(result.metrics.frame.status).toBe('partial')
      expect(result.metrics.frame.reason_code).toBe('process_name_stale_in_trace')
      expect(result.metrics.frame.reason).toContain('zygote64')
      // target_app 까지 틀린 이름이 번지지 않는다.
      expect(result.target_app.render_process).toBe(PKG)
      expect(result.target_app.pid).toBe(6037)
    })

    it('pid 가 없던 시절의 session.json 은 추측 대신 render_process_not_found 를 낸다', async () => {
      const runDir = await makeRun()
      const result = await extractRun(runDir, {
        traceProcessorPath: process.execPath,
        runner: staleRunner(join(runDir, 'trace.perfetto-trace')),
      })

      expect(result.metrics.frame.data).toBeNull()
      expect(result.metrics.frame.reason_code).toBe('render_process_not_found')
      expect(result.target_app.render_process).toBeNull()
    })

    it('frame 이 값을 못 내도 캡처한 pid 는 target_app 에 남는다', async () => {
      const runDir = await makeRun({ trace: null, appPid: 6037 })
      const result = await extractRun(runDir, {
        traceProcessorPath: process.execPath,
        runner: new FakeProcessRunner(),
      })

      expect(result.metrics.frame.status).toBe('failed')
      expect(result.target_app.pid).toBe(6037)
      expect(result.target_app.render_process).toBeNull()
    })
  })

  it('오버헤드 쿼리가 터져도 result.json 은 나온다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const broken = runner(trace).on(`query ${trace} ${TRACING_OVERHEAD_SQL}`, {
      code: 1,
      stderr: 'no such table: counter',
    })

    const result = await extractRun(runDir, { traceProcessorPath: process.execPath, runner: broken })

    expect(result.metrics.frame.status).toBe('collected')
    expect(result.measurement_overhead.tracing_processes_cpu_time_ms).toBeNull()
  })
})

describe('readSnapshots', () => {
  it('artifacts.raw 의 전/후 파일을 key 로 묶는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-snap-'))
    mkdirSync(join(dir, 'raw'))
    writeFileSync(join(dir, 'raw', 'thermalservice_before.txt'), 'Thermal Status: 0\n')
    writeFileSync(join(dir, 'raw', 'thermalservice_after.txt'), 'Thermal Status: 1\n')

    const snaps = await readSnapshots(dir, [
      'raw/thermalservice_before.txt',
      'raw/thermalservice_after.txt',
    ])
    expect(snaps['thermalservice']).toEqual({
      before: 'Thermal Status: 0\n',
      after: 'Thermal Status: 1\n',
    })
  })

  /** stop 을 안 거친 run 이 그렇다. after 를 0 이나 '' 로 채우면 거짓 청정 신호가 된다. */
  it('after 파일이 없으면 after 는 null 이고 before 는 살아 있다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-snap-'))
    mkdirSync(join(dir, 'raw'))
    writeFileSync(join(dir, 'raw', 'netstats_before.txt'), 'x\n')

    expect(await readSnapshots(dir, ['raw/netstats_before.txt'])).toEqual({
      netstats: { before: 'x\n', after: null },
    })
  })

  /** tryShell 이 실패를 빈 문자열로 흡수하므로 빈 파일은 "명령이 실패했다" 는 뜻이다. */
  it('빈 파일은 null 이다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-snap-'))
    mkdirSync(join(dir, 'raw'))
    writeFileSync(join(dir, 'raw', 'netstats_before.txt'), '')
    expect((await readSnapshots(dir, ['raw/netstats_before.txt']))['netstats']?.before).toBeNull()
  })

  it('매니페스트에 있는데 디스크에 없는 파일은 null 로 남고 던지지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-snap-'))
    expect(await readSnapshots(dir, ['raw/netstats_before.txt'])).toEqual({
      netstats: { before: null, after: null },
    })
  })

  it('트레이스 같은 비-스냅샷 항목은 무시한다', async () => {
    expect(await readSnapshots('/nonexistent', ['trace.perfetto-trace', 'video.mp4'])).toEqual({})
  })
})

/**
 * M4. `stop` 을 거치지 않은 run 의 매니페스트에는 `start` 가 쓴 자리표시자 0 만 있다.
 * `adb_commands_during_session` 은 "이 세션 데이터가 오염됐는가" 를 나타내는 바로 그 필드라,
 * 0 은 소비자에게 **검증된 청정**으로 읽힌다. 실제 누적은 활성 세션 포인터에 있다.
 */
describe('아직 stop 하지 않은 run 에 extract 를 돌렸을 때', () => {
  const RUN_ID = 'a3f9c1'

  function pointerFor(runDir: string, overrides: Partial<ActiveSession> = {}): ActiveSession {
    return {
      version: 1,
      id: RUN_ID,
      name: '홈 스크롤',
      serial: 'S1',
      packageName: PKG,
      runDir,
      perfettoKey: `perftracker_${RUN_ID}`,
      remoteTracePath: `/data/misc/perfetto-traces/perftracker_${RUN_ID}.pftrace`,
      startedAt: '2026-07-25T14:32:10.000Z',
      configuredDurationMs: 1_800_000,
      options: { launch: true, video: false },
      startup: null,
      ...overrides,
    }
  }

  /** 세션이 도는 중인 run 디렉토리 + (원하면) 그 세션의 활성 포인터. */
  async function runningRun(
    pointer?: Partial<ActiveSession>,
  ): Promise<{ runDir: string; home: string }> {
    const runDir = await makeRun({ trace: null, state: 'running', endedAt: null })
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    if (pointer !== undefined) await writeActiveSession(pointerFor(runDir, pointer), home)
    return { runDir, home }
  }

  const extract = (runDir: string, home: string) =>
    extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: new FakeProcessRunner(),
      home,
    })

  it('포인터에 쌓인 위반 횟수를 싣는다 — start 가 쓴 0 이 아니라', async () => {
    const { runDir, home } = await runningRun({ adbCommandsDuringSession: 2 })

    const result = await extract(runDir, home)

    expect(result.measurement_overhead.adb_commands_during_session).toBe(2)
  })

  it('포인터가 없으면 0 이 아니라 null 이다 — 셀 수 없는 것은 청정이 아니다', async () => {
    const { runDir, home } = await runningRun()

    const result = await extract(runDir, home)

    expect(result.measurement_overhead.adb_commands_during_session).toBeNull()
  })

  it('포인터가 다른 세션의 것이면 그 숫자를 빌려 쓰지 않는다', async () => {
    const { runDir, home } = await runningRun({ id: 'ffffff', adbCommandsDuringSession: 7 })

    const result = await extract(runDir, home)

    expect(result.measurement_overhead.adb_commands_during_session).toBeNull()
  })

  it('위반이 없던 세션의 0 은 그대로 0 이다 — 포인터가 그렇게 말한다', async () => {
    const { runDir, home } = await runningRun({ adbCommandsDuringSession: 0 })

    const result = await extract(runDir, home)

    expect(result.measurement_overhead.adb_commands_during_session).toBe(0)
  })

  it('끝나지 않은 세션의 종료 시각과 길이를 지어내지 않는다', async () => {
    // 옛 동작은 endedAt 이 없으면 startedAt 을 종료 시각 자리에 넣어 "0ms 짜리 세션" 을 만들었다.
    const { runDir, home } = await runningRun({ adbCommandsDuringSession: 0 })

    const result = await extract(runDir, home)

    expect(result.session.state).toBe('running')
    expect(result.session.ended_at).toBeNull()
    expect(result.session.duration_ms).toBeNull()
    expect(result.session.started_at).toBe('2026-07-25T14:32:10.000Z')
  })

  it('경고와 필드가 서로 다른 말을 하지 않는다', async () => {
    const { runDir, home } = await runningRun({ adbCommandsDuringSession: 2 })

    const result = await extract(runDir, home)

    const note = result.warnings.find((w) => w.code === 'session_still_running')
    expect(note).toBeDefined()
    // 경고는 이 값이 최종값이 아님을 말해야 한다 — 필드만 읽는 소비자를 위해 스키마에도 있다.
    expect(note!.message).toContain('adb_commands_during_session')
  })

  it('stop 한 run 은 남아 있는 포인터가 아니라 매니페스트를 정본으로 쓴다', async () => {
    const runDir = await makeRun({ adbCommandsDuringSession: 3 })
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    await writeActiveSession(pointerFor(runDir, { adbCommandsDuringSession: 99 }), home)

    const result = await extractRun(runDir, {
      traceProcessorPath: process.execPath,
      runner: runner(join(runDir, 'trace.perfetto-trace')),
      home,
    })

    expect(result.measurement_overhead.adb_commands_during_session).toBe(3)
  })
})
