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
