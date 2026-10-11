import type { SessionCompile } from './schema/result.js'

export class PerfTrackerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = new.target.name
  }
}

export class AdbNotFoundError extends PerfTrackerError {
  constructor(readonly searched: string[]) {
    super(
      'ADB_NOT_FOUND',
      `adb 실행 파일을 찾지 못했습니다.\n탐색한 경로:\n  ${searched.join('\n  ')}\n` +
        `--adb 옵션이나 PERFTRACKER_ADB 환경변수로 직접 지정할 수 있습니다.`,
    )
  }
}

export class AdbCommandError extends PerfTrackerError {
  constructor(
    readonly args: string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super('ADB_COMMAND_FAILED', `adb ${args.join(' ')} 실패 (exit ${exitCode})\n${stderr.trim()}`)
  }
}

export class MeasurementWindowViolationError extends PerfTrackerError {
  constructor(readonly attempted: string) {
    super(
      'MEASUREMENT_WINDOW_VIOLATION',
      `측정 창이 열려 있는 동안 adb 명령을 시도했습니다: ${attempted}\n` +
        `측정 중 기기 접촉은 관찰자 효과를 만들므로 금지됩니다.`,
    )
  }
}

export class DeviceNotFoundError extends PerfTrackerError {
  constructor(message: string) {
    super('DEVICE_NOT_FOUND', message)
  }
}

export class AmbiguousDeviceError extends PerfTrackerError {
  constructor(readonly serials: string[]) {
    super(
      'AMBIGUOUS_DEVICE',
      `기기가 여러 대 연결되어 있습니다. --device 로 하나를 지정하세요:\n  ${serials.join('\n  ')}`,
    )
  }
}

export class AppNotFoundError extends PerfTrackerError {
  constructor(readonly query: string) {
    super('APP_NOT_FOUND', `"${query}" 와 일치하는 앱을 찾지 못했습니다. perftracker apps 로 목록을 확인하세요.`)
  }
}

export class AmbiguousAppError extends PerfTrackerError {
  constructor(
    readonly query: string,
    readonly candidates: { label: string; packageName: string }[],
  ) {
    super(
      'AMBIGUOUS_APP',
      `"${query}" 와 일치하는 앱이 여러 개입니다. 정확한 이름이나 패키지명을 지정하세요:\n` +
        candidates.map((c) => `  ${c.label}  ${c.packageName}`).join('\n'),
    )
  }
}

export class ArscParseError extends PerfTrackerError {
  constructor(message: string) {
    super('ARSC_PARSE_FAILED', message)
  }
}

export class TraceProcessorError extends PerfTrackerError {
  constructor(message: string) {
    super('TRACE_PROCESSOR_FAILED', message)
  }
}

export class PerfettoSessionError extends PerfTrackerError {
  constructor(message: string) {
    super('PERFETTO_SESSION_FAILED', message)
  }
}

export class SessionStateError extends PerfTrackerError {
  constructor(message: string) {
    super('SESSION_STATE_ERROR', message)
  }
}

/**
 * `start --compile` 의 상태 바꾸는 명령이 실패했다 (기능 문서 baseline-profile BP-4) — 세션은 열리지 않았다.
 * run 디렉토리 · 시작 스냅샷 · perfetto · force-stop 은 하나도 나가지 않았고, **실패 뒤 상태는 읽지 않았다**
 * (실패 경로에 기기 명령을 더하지 않는다). 기기가 어디까지 바꿨는지는 모른다 — 한도로 끊겼으면 기기는
 * 계속 컴파일하고 있을 수 있다. 칸은 cli 가 상태 줄 · 되돌림 줄을 만드는 재료다.
 */
export class CompileFailedError extends PerfTrackerError {
  constructor(
    readonly value: string,
    /** 기기로 보낸 셸 명령 원문. */
    readonly command: string,
    /** 종료 코드. 한도로 끊겼으면 null — 그때 runner 가 준 코드는 이 쪽이 죽인 결과라 명령의 것이 아니다. */
    readonly exitCode: number | null,
    readonly timedOut: boolean,
    /** 기기가 낸 출력(stdout · stderr) 원문. */
    readonly output: string,
    readonly elapsedMs: number,
  ) {
    super(
      'COMPILE_FAILED',
      (timedOut ? '컴파일 한도 10분 넘음 · 세션 안 엶' : `컴파일 실패 · 세션 안 엶 · exit ${String(exitCode)}`) +
        `\n보낸 명령  ${command}` +
        (output.trim() !== '' ? `\n${output.trim()}` : ''),
    )
  }
}

/**
 * `start --compile` 의 상태 바꾸기는 **성공했는데** 같은 `start` 의 뒤 단계(run 디렉토리 · 시작 스냅샷 · force-stop ·
 * perfetto 시작 · 앱 실행 · 기록 쓰기)가 던졌다 (plan B32) — 세션은 열리지 않았지만 **기기 컴파일 상태는 이미
 * 바뀌었다.** 원래 오류를 감싸 그 사실과 되돌림 재료(`compile` — 값 · 보낸 명령 · 바꾸기 전 상태)를 싣는다.
 * cli 는 이것으로 되돌림 줄(BP-5)을 낸다 — 감싸지 않으면 어느 오류가 compile 뒤인지 알 수 없다.
 *
 * 감싸기만 한다: 실패 뒤 기기 명령은 0 이다 (바꾼 뒤 상태를 다시 읽지 않는다). `message` · `code` 는 원래 오류의
 * 것 그대로이고(PerfTrackerError 가 아니면 code `START_FAILED_AFTER_COMPILE`) 원래 오류는 `cause` 에 있다 —
 * 원래 오류가 PerfTrackerError 가 아니면(예상 못 한 오류) 그 판단은 `cause` 로 한다.
 * compile 전 실패 · compile 자체 실패(`CompileFailedError`)는 감싸지 않는다.
 */
export class CompileAppliedError extends PerfTrackerError {
  override readonly cause: unknown

  constructor(
    /** 바꾼 기록 — `result.json` `session.compile` 과 같은 꼴. */
    readonly compile: SessionCompile,
    cause: unknown,
  ) {
    super(
      cause instanceof PerfTrackerError ? cause.code : 'START_FAILED_AFTER_COMPILE',
      cause instanceof Error ? cause.message : String(cause),
    )
    this.cause = cause
  }
}

/**
 * result.json 이 스키마를 통과하지 못했을 때.
 * zod 의 ZodError 를 그대로 밖으로 내보내면 사용자가 스택트레이스를 보게 되므로
 * 경계에서 이 오류로 바꾼다.
 */
export class SchemaValidationError extends PerfTrackerError {
  constructor(message: string) {
    super('SCHEMA_VALIDATION_FAILED', message)
  }
}
