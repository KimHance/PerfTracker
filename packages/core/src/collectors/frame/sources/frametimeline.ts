import type { AppProcessCandidate } from '../../appProcess.js'
import { resolveAppProcess, type ResolvedAppProcess } from '../../appProcess.js'
import type { ExtractContext } from '../../types.js'
import { TRACE_START_SUBQUERY } from '../../timeline.js'
import type { FrameCollection } from '../model.js'

/**
 * **sdk 31+ 경로.** perfetto `android.surfaceflinger.frametimeline` 이 프레임마다 한 행을 낸다.
 *
 * 이 파일이 아는 것: 트레이스에서 프레임을 꺼내는 법.
 * 이 파일이 **모르는 것**: 버킷 경계, 백분위, 시계열 — 전부 `toDomain.ts` 의 몫이다.
 */
export const FRAMETIMELINE_DATA_SOURCE = 'android.surfaceflinger.frametimeline'
export const FRAMETIMELINE_MIN_SDK = 31

export interface FrameProcessCandidate extends AppProcessCandidate {
  frames: number
}

export const FRAME_PROCESS_SQL =
  "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name, 'frames', frames)) as j " +
  'from (select p.upid as upid, p.pid as pid, p.name as name, count(*) as frames ' +
  'from actual_frame_timeline_slice f join process p using(upid) group by p.upid order by frames desc)'


/**
 * `dur >= 0` 이 필수다. trace_processor 는 종료 이벤트를 못 받은 slice 에 `dur = -1` 을 내는데,
 * --stop 이 트레이스를 끊는 순간 진행 중이던 프레임이 정확히 그 모양이다.
 * 거르지 않으면 그 유령 프레임이 **가장 빠른 버킷에 앉는다** — 끝나지 않은 프레임이 0ms 대의
 * 초고속 프레임으로 집계되면 분포가 실제보다 좋은 쪽으로 기운다.
 *
 * 초 계산은 SQL 이 한다(공통 기준점을 쓰려고). 백분위는 도메인 계층이 한다.
 */
export function frameSamplesSql(upid: number): string {
  return (
    'select json_group_array(json_array(' +
    `cast((ts - ${TRACE_START_SUBQUERY}) / 1000000000 as int), dur)) as j ` +
    `from actual_frame_timeline_slice where upid = ${upid} and dur >= 0 order by ts`
  )
}

/** 옛 이름 — 이 쿼리를 직접 쓰는 코드는 없지만 `dur >= 0` 규칙의 문서 역할로 남긴다. */
export function frameDurationsSql(upid: number): string {
  return `select json_group_array(dur) as j from actual_frame_timeline_slice where upid = ${upid} and dur >= 0`
}

export interface FrametimelineResult {
  collection: FrameCollection | null
  /** 프로세스를 특정했으나 트레이스가 다른 이름으로 알고 있는 경우의 근거. */
  resolved: ResolvedAppProcess<FrameProcessCandidate> | null
}

/**
 * 프로세스 특정에 **추측이 없다.** `data.process` 는 사실로 팔리는 값이므로, 확인하지 못한
 * 이름을 넣느니 값을 내지 않는 쪽을 고른다. 규칙 자체는 `collectors/appProcess.ts` 에 있다.
 */
export async function collectFromFrametimeline(ctx: ExtractContext): Promise<FrametimelineResult> {
  const candidates = await ctx.tp.queryJson<FrameProcessCandidate[]>(FRAME_PROCESS_SQL)
  const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
  if (resolved === null) return { collection: null, resolved: null }

  const rows = await ctx.tp.queryJson<[number, number][]>(frameSamplesSql(resolved.candidate.upid))

  return {
    resolved,
    collection: {
      process: resolved.name,
      pid: resolved.candidate.pid,
      samples: rows.map(([second, durNs]) => ({ second, durationMs: durNs / 1e6 })),
    },
  }
}
