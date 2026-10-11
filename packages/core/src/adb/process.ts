import { execFile } from 'node:child_process'

export interface ProcessResult {
  stdout: Buffer
  stderr: string
  code: number
  /**
   * 호출자가 준 시간 한도(`timeoutMs`)에 걸려 **이 쪽이 프로세스를 죽였다** — 그때 `code` 는 1 이라
   * 종료 코드만으로는 "명령이 1 로 끝남" 과 가를 수 없다. 죽인 적이 없으면 키가 없다.
   * 호스트의 adb 를 죽여도 기기 쪽 작업은 계속될 수 있다 (예: `cmd package compile`).
   */
  timedOut?: true
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
          const e = error as { code?: number | string | null; killed?: boolean } | null
          const raw = e?.code
          const code = typeof raw === 'number' ? raw : error ? 1 : 0
          // `killed` 는 이 쪽이 죽였다는 뜻이다 — 한도 말고는 maxBuffer 넘침뿐이고, 그때는 code 가
          // 문자열(`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`)이다.
          const timedOut = e?.killed === true && typeof raw !== 'string'
          resolve({ stdout, stderr: stderr.toString('utf8'), code, ...(timedOut ? { timedOut: true as const } : {}) })
        },
      )
      if (opts.input !== undefined) child.stdin?.end(opts.input)
    })
  },
}
