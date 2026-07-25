import { describe, expect, it } from 'vitest'
import { TraceProcessorError } from '../../src/errors.js'
import { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'
import { artifactFor, downloadUrl, TRACE_PROCESSOR_VERSION } from '../../src/perfetto/traceProcessor/locate.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const BIN = '/bin/trace_processor_shell'
const TRACE = '/tmp/t.pftrace'

describe('artifactFor / downloadUrl', () => {
  it('macOS arm64 아티팩트를 고른다', () => {
    const a = artifactFor('darwin', 'arm64')
    expect(a.arch).toBe('mac-arm64')
    expect(a.sha256).toBe('98a41b80e9f60da0373d64aff6455681f8c26b7c391ae5736324a5b11e3dacc2')
  })

  it('linux x64 아티팩트를 고른다', () => {
    expect(artifactFor('linux', 'x64').arch).toBe('linux-amd64')
  })

  it('windows x64 아티팩트를 고른다', () => {
    expect(artifactFor('win32', 'x64').arch).toBe('windows-amd64')
  })

  it('지원하지 않는 조합은 오류를 던진다', () => {
    expect(() => artifactFor('freebsd', 'mips')).toThrow(TraceProcessorError)
  })

  it('버전이 박힌 URL 을 만든다', () => {
    expect(downloadUrl(artifactFor('darwin', 'arm64'))).toBe(
      `https://commondatastorage.googleapis.com/perfetto-luci-artifacts/${TRACE_PROCESSOR_VERSION}/mac-arm64/trace_processor_shell`,
    )
  })
})

describe('TraceProcessor.queryJson', () => {
  const sql = "select json_object('frames', 450) as j"

  it('단일 행·단일 열 JSON 을 파싱한다', async () => {
    // trace_processor 의 CSV 는 내부 따옴표를 이스케이프하지 않는다.
    // 단일 열이므로 바깥 따옴표만 벗기면 그대로 JSON 이다.
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${sql}`, {
      stdout: '"j"\n"{"frames":450}"\n',
    })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(sql)).resolves.toEqual({ frames: 450 })
  })

  it('배열 결과도 파싱한다', async () => {
    const q = 'select json_group_array(1) as j'
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${q}`, {
      stdout: '"j"\n"[{"process":"/system/bin/surfaceflinger","frames":450}]"\n',
    })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(q)).resolves.toEqual([
      { process: '/system/bin/surfaceflinger', frames: 450 },
    ])
  })

  it('종료 코드가 0 이 아니면 stderr 를 담아 던진다', async () => {
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${sql}`, {
      code: 1,
      stderr: 'no such table: actual_frame_timeline_slice\n',
    })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(sql)).rejects.toThrow(/no such table/)
  })

  it('결과 행이 없으면 오류를 던진다', async () => {
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${sql}`, { stdout: '"j"\n' })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(sql)).rejects.toBeInstanceOf(TraceProcessorError)
  })

  it('행이 둘 이상이면 조용히 버리지 않고 던진다', async () => {
    // 외부 바이너리와 기계 계약 사이의 경계에서 조용한 저하는 잘못된 기본값이다.
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${sql}`, {
      stdout: '"j"\n"{"frames":450}"\n"{"frames":12}"\n',
    })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(sql)).rejects.toThrow(/2행/)
  })

  it('JSON 이 아니면 오류를 던진다', async () => {
    const runner = new FakeProcessRunner().on(`query ${TRACE} ${sql}`, { stdout: '"j"\nnot-json\n' })
    const tp = new TraceProcessor(BIN, TRACE, runner)

    await expect(tp.queryJson(sql)).rejects.toBeInstanceOf(TraceProcessorError)
  })
})
