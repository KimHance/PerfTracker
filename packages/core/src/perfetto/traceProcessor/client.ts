import { TraceProcessorError } from '../../errors.js'
import { nodeProcessRunner, type ProcessRunner } from '../../adb/process.js'

/**
 * SQL 문자열 리터럴로 감싼다. `adb/shell.ts` 의 `shellQuote` 와 같은 역할을 SQL 경계에서 한다.
 *
 * 패키지명은 `pm list packages` 에서 오므로 실제로 따옴표가 섞일 일은 거의 없지만,
 * "거의 없다" 를 근거로 인터폴레이션을 맨살로 두는 것이 정확히 이 프로젝트가 직전 커밋에서
 * adb 쪽에 대해 고친 문제다. 경계는 경계로 다룬다.
 */
export function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * trace_processor 는 결과를 CSV 로 내는데 내부 따옴표를 이스케이프하지 않는다.
 * 그래서 모든 쿼리는 "단일 행·단일 열의 JSON 문자열"이라는 계약을 지키고,
 * 바깥 따옴표만 벗겨서 JSON.parse 한다. 여러 행이 필요하면 json_group_array 를 쓴다.
 */
export class TraceProcessor {
  readonly #bin: string
  readonly #trace: string
  readonly #runner: ProcessRunner

  constructor(binPath: string, tracePath: string, runner: ProcessRunner = nodeProcessRunner) {
    this.#bin = binPath
    this.#trace = tracePath
    this.#runner = runner
  }

  async queryJson<T>(sql: string): Promise<T> {
    const r = await this.#runner.run(this.#bin, ['query', this.#trace, sql], { timeoutMs: 300_000 })

    if (r.code !== 0) {
      throw new TraceProcessorError(`쿼리 실패 (exit ${r.code})\n${r.stderr.trim()}\nSQL: ${sql}`)
    }

    const lines = r.stdout
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)

    // 첫 줄은 헤더, 둘째 줄이 데이터다.
    const row = lines[1]
    if (row === undefined) {
      throw new TraceProcessorError(`쿼리 결과 행이 없습니다.\nSQL: ${sql}`)
    }
    // "단일 행" 계약이 깨진 것을 조용히 넘기지 않는다 — 외부 바이너리와 기계 계약 사이의
    // 경계에서 데이터를 말없이 버리면 결과가 틀린 채로 정상처럼 보인다.
    if (lines.length > 2) {
      throw new TraceProcessorError(
        `쿼리가 ${lines.length - 1}행을 냈습니다 — 이 클라이언트는 단일 행만 읽습니다. ` +
          `여러 행이 필요하면 json_group_array 로 한 행에 담으세요.\nSQL: ${sql}`,
      )
    }

    const trimmed = row.trim()
    const json =
      trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
        ? trimmed.slice(1, -1)
        : trimmed

    try {
      return JSON.parse(json) as T
    } catch {
      throw new TraceProcessorError(`쿼리 결과를 JSON 으로 읽지 못했습니다: ${trimmed.slice(0, 200)}`)
    }
  }
}
