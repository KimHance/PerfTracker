import type { MemoryData, MemoryStat, MemoryTimelinePoint, SystemMemory } from '../../schema/result.js'
import { bytesToKb } from '../num.js'
import type { CounterStatBytes, MemoryCollection, MemorySample, SystemMemoryBytes } from './model.js'

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
  }
}
