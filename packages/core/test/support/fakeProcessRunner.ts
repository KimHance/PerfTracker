import type { ProcessResult, ProcessRunOptions, ProcessRunner } from '../../src/adb/process.js'

export interface FakeResponse {
  stdout?: string | Buffer
  stderr?: string
  code?: number
}

/** args 를 공백으로 이어붙인 문자열을 키로 응답을 돌려주는 ProcessRunner 스텁. */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: { file: string; args: string[]; input?: string }[] = []
  readonly #responses = new Map<string, ProcessResult[]>()

  /** 같은 키에 여러 응답을 주면 호출 순서대로 소비하고, 마지막 응답은 계속 재사용된다. */
  on(argsKey: string, ...responses: FakeResponse[]): this {
    this.#responses.set(
      argsKey,
      responses.map((r) => ({
        stdout: Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout ?? '', 'utf8'),
        stderr: r.stderr ?? '',
        code: r.code ?? 0,
      })),
    )
    return this
  }

  argsOf(index: number): string[] {
    return this.calls[index]?.args ?? []
  }

  async run(file: string, args: string[], opts: ProcessRunOptions = {}): Promise<ProcessResult> {
    this.calls.push({ file, args, input: opts.input?.toString() })
    const queue = this.#responses.get(args.join(' '))
    if (!queue || queue.length === 0) {
      return { stdout: Buffer.alloc(0), stderr: `fake 응답 없음: ${args.join(' ')}`, code: 127 }
    }
    return queue.length === 1 ? queue[0]! : queue.shift()!
  }
}
