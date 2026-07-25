import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { PerfettoSessionError } from '../../src/errors.js'
import {
  isSessionDetached,
  pullTrace,
  remoteTracePath,
  removeRemoteTrace,
  startDetachedSession,
  stopDetachedSession,
} from '../../src/perfetto/session.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const KEY = 'perftracker_a3f9c1'
const REMOTE = '/data/misc/perfetto-traces/perftracker_a3f9c1.pftrace'
const CONFIG = 'write_into_file: true\nflush_period_ms: 30000\n'
const START_CMD = `shell rm -f ${REMOTE}; perfetto -c - --txt -o ${REMOTE} --detach=${KEY}`

describe('remoteTracePath', () => {
  it('shell 이 쓸 수 있는 디렉토리를 쓴다', () => {
    expect(remoteTracePath(KEY)).toBe(REMOTE)
  })
})

describe('startDetachedSession', () => {
  it('config 를 stdin 으로 넘겨 detached 로 띄운다', async () => {
    const runner = new FakeProcessRunner().on(START_CMD, {
      stderr: 'Connected to the Perfetto traced service, TTL: 1800s\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await startDetachedSession(adb, { key: KEY, remotePath: REMOTE, configText: CONFIG })

    expect(runner.calls[0]?.input).toBe(CONFIG)
  })

  it('perfetto 가 거부하면 stderr 를 담아 실패한다', async () => {
    const runner = new FakeProcessRunner().on(START_CMD, {
      code: 1,
      stderr: "TraceConfig's write_into_file must be true when using --detach\n",
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(
      startDetachedSession(adb, { key: KEY, remotePath: REMOTE, configText: CONFIG }),
    ).rejects.toThrow(/write_into_file/)
  })

  it('No PTY 경고는 실패로 보지 않는다', async () => {
    const runner = new FakeProcessRunner().on(START_CMD, {
      stderr: 'Warning: No PTY. CTRL+C will not gracefully stop the trace.\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(
      startDetachedSession(adb, { key: KEY, remotePath: REMOTE, configText: CONFIG }),
    ).resolves.toBeUndefined()
  })
})

describe('isSessionDetached', () => {
  it('종료 코드 0 이면 살아 있다', async () => {
    const runner = new FakeProcessRunner().on(`shell perfetto --is_detached=${KEY}`, { code: 0 })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(isSessionDetached(adb, KEY)).resolves.toBe(true)
  })

  it('종료 코드 2 면 세션이 없다', async () => {
    const runner = new FakeProcessRunner().on(`shell perfetto --is_detached=${KEY}`, { code: 2 })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(isSessionDetached(adb, KEY)).resolves.toBe(false)
  })
})

describe('stopDetachedSession', () => {
  it('attach 해서 stop 한다', async () => {
    const runner = new FakeProcessRunner().on(`shell perfetto --attach=${KEY} --stop`, {
      stderr: 'Trace written into the output file\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await stopDetachedSession(adb, KEY)

    expect(runner.calls[0]?.args).toEqual(['shell', `perfetto --attach=${KEY} --stop`])
  })

  it('attach 실패는 PerfettoSessionError 로 올린다', async () => {
    const runner = new FakeProcessRunner().on(`shell perfetto --attach=${KEY} --stop`, {
      code: 1,
      stderr: 'Session not found\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(stopDetachedSession(adb, KEY)).rejects.toBeInstanceOf(PerfettoSessionError)
  })
})

describe('pullTrace / removeRemoteTrace', () => {
  it('트레이스를 회수한다', async () => {
    const runner = new FakeProcessRunner().on(`pull ${REMOTE} /tmp/t.pftrace`, {
      stdout: '1 file pulled, 0 skipped.\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(pullTrace(adb, REMOTE, '/tmp/t.pftrace')).resolves.toBeUndefined()
  })

  it('회수 실패는 오류로 올린다', async () => {
    const runner = new FakeProcessRunner().on(`pull ${REMOTE} /tmp/t.pftrace`, {
      code: 1,
      stderr: 'does not exist\n',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(pullTrace(adb, REMOTE, '/tmp/t.pftrace')).rejects.toBeInstanceOf(PerfettoSessionError)
  })

  it('기기의 트레이스를 지운다', async () => {
    const runner = new FakeProcessRunner().on(`shell rm -f ${REMOTE}`, {})
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await removeRemoteTrace(adb, REMOTE)

    expect(runner.calls[0]?.args).toEqual(['shell', `rm -f ${REMOTE}`])
    expect(runner.calls).toHaveLength(1)
  })
})
