import { frameCollector } from './frame.js'
import type { Collector } from './types.js'

/** M1 은 frame 하나. M2 에서 cpu/memory/log/startup 이, M3 에서 network/thermal/power 가 여기 붙는다. */
export const COLLECTORS: Collector<unknown>[] = [frameCollector]
