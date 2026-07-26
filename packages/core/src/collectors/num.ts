/** 결과 JSON 에 부동소수 잔재(0.30000000000000004)를 남기지 않기 위한 반올림. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * trace_processor 는 메모리 카운터를 **바이트**로 낸다 — proto 의 `vm_rss_kb` / meminfo 는 kB 인데
 * importer 가 1024 를 곱한다. 실측: 2GB 에뮬레이터의 `MemTotal` 이 2070597632.
 * 스키마 필드가 `_kb` 로 끝나므로 이 함수를 반드시 통과시킨다.
 */
export function bytesToKb(bytes: number): number {
  return Math.round(bytes / 1024)
}
