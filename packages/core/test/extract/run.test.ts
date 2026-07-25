import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRAME_PROCESS_SQL, frameDurationsSql } from '../../src/collectors/frame.js'
import { BUFFER_STATS_SQL, extractRun } from '../../src/extract/run.js'
import { writeCaptureManifest } from '../../src/session/manifest.js'
import { writeRunSession } from '../../src/session/state.js'
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

async function makeRun(overrides: { trace?: string | null; sdkInt?: number } = {}): Promise<string> {
  const runDir = mkdtempSync(join(tmpdir(), 'pt-extract-'))
  const trace = overrides.trace === undefined ? 'trace.perfetto-trace' : overrides.trace
  if (trace) writeFileSync(join(runDir, trace), 'fake')

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
      options: { launch: true, video: false },
      startup: { totalTimeMs: 1842, launchState: 'COLD' },
    },
    { endedAt: '2026-07-25T14:32:52.735Z', state: 'completed' },
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
    adb_commands_during_session: 0,
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
}

describe('extractRun', () => {
  it('스키마를 통과하는 result.json 을 만든다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')

    const result = await extractRun(runDir, {
      traceProcessorPath: '/bin/tp',
      runner: runner(trace),
      toolVersion: '0.1.0',
    })

    expect(result.schema_version).toBe('1.0.0')
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

    await extractRun(runDir, { traceProcessorPath: '/bin/tp', runner: runner(join(runDir, 'trace.perfetto-trace')) })

    const written = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8')) as Record<string, unknown>
    expect(written['schema_version']).toBe('1.0.0')
  })

  it('Android 12 미만이면 frame 을 unsupported 로 남긴다', async () => {
    const runDir = await makeRun({ sdkInt: 30 })

    const result = await extractRun(runDir, {
      traceProcessorPath: '/bin/tp',
      runner: runner(join(runDir, 'trace.perfetto-trace')),
    })

    expect(result.metrics.frame.status).toBe('unsupported')
    expect(result.metrics.frame.reason).toContain('sdk_int=30')
    expect(result.metrics.frame.data).toBeNull()
  })

  it('트레이스가 없으면 frame 을 failed 로 남기고 나머지는 채운다', async () => {
    const runDir = await makeRun({ trace: null })

    const result = await extractRun(runDir, { traceProcessorPath: '/bin/tp', runner: new FakeProcessRunner() })

    expect(result.metrics.frame.status).toBe('failed')
    expect(result.device.static.model).toBe('SM-S931N')
  })

  it('쿼리가 터져도 다른 필드는 살린다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const broken = new FakeProcessRunner()
      .on(`query ${trace} ${FRAME_PROCESS_SQL}`, { code: 1, stderr: 'no such table' })
      .on(`query ${trace} ${BUFFER_STATS_SQL}`, { stdout: '"j"\n"[]"\n' })

    const result = await extractRun(runDir, { traceProcessorPath: '/bin/tp', runner: broken })

    expect(result.metrics.frame.status).toBe('failed')
    expect(result.metrics.frame.reason).toContain('no such table')
    expect(result.measurement_overhead.trace_buffer_overrun).toBe(false)
  })

  it('버퍼 오버런을 사실로 기록한다', async () => {
    const runDir = await makeRun()
    const trace = join(runDir, 'trace.perfetto-trace')
    const overrun = runner(trace).on(`query ${trace} ${BUFFER_STATS_SQL}`, {
      stdout: '"j"\n"[{"name":"traced_buf_chunks_overwritten","value":12}]"\n',
    })

    const result = await extractRun(runDir, { traceProcessorPath: '/bin/tp', runner: overrun })

    expect(result.measurement_overhead.trace_buffer_overrun).toBe(true)
  })
})
