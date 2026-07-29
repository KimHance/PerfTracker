import type {
  MemoryData,
  MemoryStat,
  MemoryTimelinePoint,
  SystemMemory,
  SystemMemoryTimelinePoint,
} from '../../schema/result.js'
import { bytesToKb } from '../num.js'
import type {
  CounterStatBytes,
  MemoryCollection,
  MemorySample,
  SystemMemoryBytes,
  SystemMemoryTimelineRow,
} from './model.js'

function toStat(v: CounterStatBytes | null): MemoryStat | null {
  if (v === null) return null
  return { min_kb: bytesToKb(v.min), max_kb: bytesToKb(v.max), avg_kb: bytesToKb(v.avg) }
}

/**
 * 초당 하나로 접는다. 같은 초의 표본이 여럿이면 **마지막**이 남는다 (폴링 지터).
 * 값이 없는 초는 배열에 넣지 않는다 — 0 은 "재 봤더니 0" 이라는 뜻이 된다.
 */
export function buildMemoryTimeline(samples: MemorySample[]): MemoryTimelinePoint[] {
  const bySecond = new Map<number, number>()
  for (const { second, rssBytes } of samples) bySecond.set(second, rssBytes)

  return [...bySecond.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t_s, bytes]) => ({ t_s, rss_kb: bytesToKb(bytes) }))
}

/**
 * 기기 전체 가용 메모리의 초당 추이.
 *
 * 앱 RSS(`buildMemoryTimeline`)와 달리 **두 값(MemAvailable · MemFree)이 한 점에 함께 실린다.**
 * 둘은 같은 폴링이 낸 짝이라 따로 배열을 두면 소비자가 초로 다시 맞춰야 한다.
 *
 * **짝이 안 맞는 초는 버린다.** 한쪽만 있는 점을 실으면 나머지 하나를 0 으로 채우거나
 * 필드를 비워야 하는데, 둘 다 "재 봤더니 0" 이라는 거짓말이 된다.
 *
 * 남는 점이 하나도 없으면 `null` 이다 — `system` 이 null 인 것과 같은 원인이다.
 */
export function buildSystemMemoryTimeline(
  rows: SystemMemoryTimelineRow[],
): SystemMemoryTimelinePoint[] | null {
  if (rows.length === 0) return null

  const bySecond = new Map<number, { available?: number; free?: number }>()
  for (const [t_s, counter, bytes] of rows) {
    const acc = bySecond.get(t_s) ?? {}
    bySecond.set(t_s, acc)
    if (counter === 'MemAvailable') acc.available = bytes
    else if (counter === 'MemFree') acc.free = bytes
  }

  const out: SystemMemoryTimelinePoint[] = []
  for (const [t_s, v] of [...bySecond.entries()].sort((a, b) => a[0] - b[0])) {
    if (v.available === undefined || v.free === undefined) continue
    out.push({ t_s, mem_available_kb: bytesToKb(v.available), mem_free_kb: bytesToKb(v.free) })
  }

  return out.length > 0 ? out : null
}

function toSystem(v: SystemMemoryBytes | null): SystemMemory | null {
  if (v === null) return null
  return {
    mem_total_kb: bytesToKb(v.memTotal),
    mem_available: toStat(v.memAvailable)!,
    mem_free: toStat(v.memFree)!,
    cached: toStat(v.cached)!,
    swap_total_kb: bytesToKb(v.swapTotal),
    swap_free: toStat(v.swapFree)!,
  }
}

/** **데이터 모델 → 도메인 모델.** 기기도 SDK 도 명령도 모른다. 바이트를 kB 로 옮길 뿐이다. */
export function toMemoryData(c: MemoryCollection): MemoryData {
  return {
    process: c.process,
    pid: c.pid,
    samples: c.rss.samples,
    rss: toStat(c.rss)!,
    rss_anon: toStat(c.rssAnon),
    rss_file: toStat(c.rssFile),
    timeline: buildMemoryTimeline(c.timeline),
    rss_watermark_peak_kb: c.watermarkPeak === null ? null : bytesToKb(c.watermarkPeak),
    system: toSystem(c.system),
    system_timeline: buildSystemMemoryTimeline(c.systemTimelineRows),
  }
}
