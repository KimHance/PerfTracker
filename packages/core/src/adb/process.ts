import { execFile } from 'node:child_process'

export interface ProcessResult {
  stdout: Buffer
  stderr: string
  code: number
}

export interface ProcessRunOptions {
  input?: string | Buffer
  timeoutMs?: number
  maxBufferBytes?: number
}

export interface ProcessRunner {
  run(file: string, args: string[], opts?: ProcessRunOptions): Promise<ProcessResult>
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BUFFER = 256 * 1024 * 1024

/**
 * 실제 프로세스를 띄우는 구현.
 * 0 이 아닌 종료 코드를 예외로 바꾸지 않는다 — 호출자가 코드를 보고 판단한다
 * (adb 는 정상 흐름에서도 비영 코드를 쓴다. 예: perfetto --is_detached).
 */
export const nodeProcessRunner: ProcessRunner = {
  run(file, args, opts = {}) {
    return new Promise<ProcessResult>((resolve) => {
      const child = execFile(
        file,
        args,
        {
          encoding: 'buffer',
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          const raw = (error as { code?: number | string } | null)?.code
          const code = typeof raw === 'number' ? raw : error ? 1 : 0
          resolve({ stdout, stderr: stderr.toString('utf8'), code })
        },
      )
      if (opts.input !== undefined) child.stdin?.end(opts.input)
    })
  },
}
