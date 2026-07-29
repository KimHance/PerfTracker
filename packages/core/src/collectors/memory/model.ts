/**
 * **데이터 모델** — 어느 경로로 얻었는지와 무관한 중간형. **단위는 바이트다** (커널이 주는
 * 단위 그대로). kB 변환은 도메인 계층이 한다 — 여기서 미리 바꾸면 소스마다 반올림이 갈린다.
 *
 * 현재 경로는 하나뿐이다: perfetto `linux.process_stats` 의 `mem.rss*` 카운터.
 * 다른 경로(`dumpsys meminfo` 등)가 생기면 이 모양으로 채워 주기만 하면 도메인 계층은
 * 손대지 않는다.
 */
export interface CounterStatBytes {
  min: number
  max: number
  avg: number
  samples: number
}

/** 시간별 RSS 표본. `second` 는 세션 시작으로부터의 상대 초 (`collectors/timeline.ts`). */
export interface MemorySample {
  second: number
  rssBytes: number
}

export interface SystemMemoryBytes {
  memTotal: number
  memAvailable: CounterStatBytes
  memFree: CounterStatBytes
  cached: CounterStatBytes
  swapTotal: number
  swapFree: CounterStatBytes
}

/**
 * meminfo 카운터의 초별 마지막 표본 `[상대초, 카운터 이름, 바이트]`.
 *
 * 이름이 그대로 실려 오는 이유는 `DeviceCpuTimelineRow` 와 같다 — 어느 이름이 무엇인지를
 * SQL 이 알면 규칙이 두 곳에 살게 된다. 짝 맞추기는 도메인 계층이 한다.
 */
export type SystemMemoryTimelineRow = [number, string, number]

export interface MemoryCollection {
  process: string
  pid: number
  rss: CounterStatBytes
  rssAnon: CounterStatBytes | null
  rssFile: CounterStatBytes | null
  /** `mem.rss.watermark` 의 최댓값. 커널이 기억하는 최고점이라 세션 구간의 값이 아니다. */
  watermarkPeak: number | null
  timeline: MemorySample[]
  /** meminfo 는 별도 데이터소스라 없을 수 있다. 없는 것이 앱 RSS 를 죽이지 않는다. */
  system: SystemMemoryBytes | null
  /** 접기 전 원본 행. 짝 맞추기도 kB 변환도 `toDomain` 이 한다 (이 파일은 단위를 모른다). */
  systemTimelineRows: SystemMemoryTimelineRow[]
}
