import type { ProcessResult, ProcessRunOptions, ProcessRunner } from '../../src/adb/process.js'

export interface FakeResponse {
  stdout?: string | Buffer
  stderr?: string
  code?: number
}

function toResults(responses: FakeResponse[]): ProcessResult[] {
  return responses.map((r) => ({
    stdout: Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout ?? '', 'utf8'),
    stderr: r.stderr ?? '',
    code: r.code ?? 0,
  }))
}

/** args 를 공백으로 이어붙인 문자열을 키로 응답을 돌려주는 ProcessRunner 스텁. */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: { file: string; args: string[]; input?: string }[] = []
  readonly #responses = new Map<string, ProcessResult[]>()
  readonly #patterns: { pattern: RegExp; queue: ProcessResult[] }[] = []

  /** 같은 키에 여러 응답을 주면 호출 순서대로 소비하고, 마지막 응답은 계속 재사용된다. */
  on(argsKey: string, ...responses: FakeResponse[]): this {
    this.#responses.set(argsKey, toResults(responses))
    return this
  }

  /**
   * 정확한 키를 미리 알 수 없을 때 (예: 세션 id 가 섞인 `--detach=perftracker_<id>`).
   * 정확한 키를 먼저 보고, 없으면 패턴을 **나중에 등록한 것부터** 본다
   * (`on` 이 Map 이라 나중 등록이 이기는 것과 같은 규칙 — 헬퍼가 준 기본값을 테스트가 덮는다).
   */
  onMatch(pattern: RegExp, ...responses: FakeResponse[]): this {
    this.#patterns.unshift({ pattern, queue: toResults(responses) })
    return this
  }

  argsOf(index: number): string[] {
    return this.calls[index]?.args ?? []
  }

  /** 실제로 기기에 나간 명령들. 호출 순서 단언에 쓴다. */
  get commands(): string[] {
    return this.calls.map((c) => c.args.join(' '))
  }

  async run(file: string, args: string[], opts: ProcessRunOptions = {}): Promise<ProcessResult> {
    const key = args.join(' ')
    this.calls.push({ file, args, input: opts.input?.toString() })

    const queue = this.#responses.get(key) ?? this.#patterns.find((p) => p.pattern.test(key))?.queue
    if (!queue || queue.length === 0) {
      return { stdout: Buffer.alloc(0), stderr: `fake 응답 없음: ${key}`, code: 127 }
    }
    return queue.length === 1 ? queue[0]! : queue.shift()!
  }
}
