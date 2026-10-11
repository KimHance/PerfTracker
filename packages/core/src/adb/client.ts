import { AdbCommandError } from '../errors.js'
import { nodeProcessRunner, type ProcessResult, type ProcessRunOptions, type ProcessRunner } from './process.js'
import { MeasurementWindow } from './window.js'

export interface AdbClientOptions {
  adbPath: string
  serial?: string
  runner?: ProcessRunner
  window?: MeasurementWindow
}

/** 모든 adb 접근의 단일 관문. 여기를 통과하지 않는 기기 접촉은 없어야 한다. */
export class AdbClient {
  readonly window: MeasurementWindow
  readonly adbPath: string
  readonly serial: string | undefined
  readonly #runner: ProcessRunner

  constructor(opts: AdbClientOptions) {
    this.adbPath = opts.adbPath
    this.serial = opts.serial
    this.#runner = opts.runner ?? nodeProcessRunner
    this.window = opts.window ?? new MeasurementWindow()
  }

  withSerial(serial: string): AdbClient {
    return new AdbClient({ adbPath: this.adbPath, serial, runner: this.#runner, window: this.window })
  }

  async rawBinary(args: string[], opts: ProcessRunOptions = {}): Promise<ProcessResult> {
    const full = this.serial ? ['-s', this.serial, ...args] : args
    this.window.assertClosed(`adb ${full.join(' ')}`)
    return this.#runner.run(this.adbPath, full, opts)
  }

  async raw(
    args: string[],
    opts: ProcessRunOptions = {},
  ): Promise<{ stdout: string; stderr: string; code: number; timedOut?: true }> {
    const r = await this.rawBinary(args, opts)
    return {
      stdout: r.stdout.toString('utf8'),
      stderr: r.stderr,
      code: r.code,
      ...(r.timedOut === true ? { timedOut: true as const } : {}),
    }
  }

  /** 실패를 예외로 올리는 래퍼. */
  async check(args: string[], opts: ProcessRunOptions = {}): Promise<string> {
    const r = await this.raw(args, opts)
    if (r.code !== 0) throw new AdbCommandError(args, r.code, r.stderr)
    return r.stdout
  }

  async shell(command: string, opts: ProcessRunOptions = {}): Promise<string> {
    return this.check(['shell', command], opts)
  }

  /**
   * 스냅샷 수집 정책: 개별 명령의 실패는 빈 문자열로 흡수한다.
   * `wm size` 하나가 없는 특이 기기 때문에 측정 전체가 중단되면 안 된다. 파싱 실패는
   * 스키마의 기본값(0 / null)으로 result.json 에 그대로 드러나므로 조용히 사라지지 않는다.
   */
  async tryShell(command: string, opts: ProcessRunOptions = {}): Promise<string> {
    const r = await this.raw(['shell', command], opts)
    return r.code === 0 ? r.stdout : ''
  }

  /** 바이너리를 그대로 받아야 할 때 (resources.arsc 스트리밍). */
  async execOutBinary(command: string): Promise<Buffer> {
    const r = await this.rawBinary(['exec-out', command])
    if (r.code !== 0) throw new AdbCommandError(['exec-out', command], r.code, r.stderr)
    return r.stdout
  }
}
