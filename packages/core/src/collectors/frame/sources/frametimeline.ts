import type { AppProcessCandidate } from '../../appProcess.js'
import { resolveAppProcess, type ResolvedAppProcess } from '../../appProcess.js'
import type { ExtractContext } from '../../types.js'
import { TRACE_START_SUBQUERY } from '../../timeline.js'
import type { FrameCollection, FrameJankRow } from '../model.js'

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
 * **한 줄이 화면에 나간 프레임 하나다.**
 *
 * `actual_frame_timeline_slice` 는 **레이어마다** 한 행을 낸다. 앱이 SurfaceView 를 쓰면 그
 * 뒤에 까는 `Background for …` 짝까지 붙어서, 화면 한 번 갱신에 이 앱 행이 최대 20개까지
 * 달린다. 실측(Stream 33초): 행 6,932개인데 실제로 나간 프레임은 2,875개 — **2.4배**였고,
 * 초당 210장이라는 120Hz 기기에서 나올 수 없는 수가 나왔다.
 *
 * 부풀기만 하는 것이 아니라 **분포 모양이 바뀐다.** 빈 배경 레이어는 그릴 것이 없어 1~2ms 에
 * 끝나 0–5ms 칸에 몰린다 — "앱이 3ms 만에 그렸다" 가 아니라 "빈 레이어가 3ms 만에 끝났다"
 * 인데 화면에서는 구분되지 않는다. 실측 0–5ms 1,064장 중 643장이 UI 창이 아닌 레이어였다.
 *
 * 그래서 `display_frame_token`(같은 화면 갱신에 묶인 것들)으로 접고 **그중 가장 오래 걸린
 * 레이어**를 그 프레임의 값으로 쓴다 — "이 프레임을 위해 앱이 쓴 시간" 이다.
 *
 * **레이어 이름으로 거르지 않는다.** 이름 목록으로 막는 방어가 성립하지 않는 것은 이 저장소가
 * 이미 겪었다 (`collectors/appProcess.ts`). 구조로 접은 결과는 실측에서 앱 UI 창 2,658 ·
 * 스플래시 181 · 그 밖 36 으로, 이름을 매칭했을 때와 사실상 같은 자리에 닿는다. 남은 36개는
 * 그 갱신에 UI 창 프레임이 아예 없던 경우(영상만 갱신)이고, 그때는 그것이 정말로 그 프레임에
 * 앱이 한 일이다.
 *
 * `dur >= 0` 이 필수다. trace_processor 는 종료 이벤트를 못 받은 slice 에 `dur = -1` 을 내는데,
 * --stop 이 트레이스를 끊는 순간 진행 중이던 프레임이 정확히 그 모양이다.
 * 거르지 않으면 그 유령 프레임이 **가장 빠른 버킷에 앉는다** — 끝나지 않은 프레임이 0ms 대의
 * 초고속 프레임으로 집계되면 분포가 실제보다 좋은 쪽으로 기운다.
 *
 * 초 계산은 SQL 이 한다(공통 기준점을 쓰려고). 백분위는 도메인 계층이 한다.
 */
export function frameSamplesSql(upid: number): string {
  return (
    'select json_group_array(json_array(sec, dur)) as j from (' +
    `select cast((min(ts) - ${TRACE_START_SUBQUERY}) / 1000000000 as int) as sec, ` +
    'max(dur) as dur ' +
    `from actual_frame_timeline_slice where upid = ${upid} and dur >= 0 ` +
    'group by display_frame_token order by min(ts))'
  )
}

/**
 * **프레임이 왜 늦었는지는 SurfaceFlinger 가 직접 적어 둔다.** 우리가 판정하는 것이 아니라
 * 기기가 프레임마다 붙여 둔 꼬리표(`jank_type`)를 세는 것뿐이다 — 규칙 2 를 지키는 자리다.
 *
 * `dur` 와 **같은 테이블 · 같은 트레이스**라 기기에 더 물어보지 않는다. 이미 받아 놓고
 * 버리던 컬럼이다.
 *
 * `jank_type` 은 값 하나가 아니라 **꼬리표의 집합**이라 `"App Deadline Missed, Buffer
 * Stuffing"` 처럼 온다. 쪼개는 일은 도메인 계층이 한다 — 여기는 원문 그대로 센다.
 *
 * `on_time_finish` 는 별개 사실이다: 꼬리표가 `None` 인데도 늦게 끝난 프레임이 실측으로
 * 있었다 (Stream 세션: `None` 240장 중 41장).
 *
 * **표본과 같은 대표 행을 쓴다** — 화면 갱신 하나당 가장 오래 걸린 레이어. 여기만 레이어를
 * 전부 세면 분포의 분모와 꼬리표의 분모가 달라져 비율이 조용히 어긋난다.
 */
export function frameJankSql(upid: number): string {
  return (
    "select json_group_array(json_array(jank_type, on_time_finish, n)) as j from (" +
    'select jank_type, on_time_finish, count(*) as n from (' +
    'select jank_type, on_time_finish, ' +
    'row_number() over (partition by display_frame_token order by dur desc) as rn ' +
    `from actual_frame_timeline_slice where upid = ${upid} and dur >= 0) ` +
    'where rn = 1 group by jank_type, on_time_finish)'
  )
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

  // 꼬리표를 못 읽는 것이 프레임 전체를 못 내는 이유가 되면 안 된다. 못 읽었으면 `null` 이고,
  // 그것은 "문제가 없었다" 와 다른 말이다.
  let jank: FrameJankRow[] | null = null
  try {
    const jankRows = await ctx.tp.queryJson<[string, number, number][]>(
      frameJankSql(resolved.candidate.upid),
    )
    jank = jankRows.map(([type, onTime, count]) => ({ type, onTime: onTime === 1, count }))
  } catch {
    jank = null
  }

  return {
    resolved,
    collection: {
      process: resolved.name,
      pid: resolved.candidate.pid,
      samples: rows.map(([second, durNs]) => ({ second, durationMs: durNs / 1e6 })),
      jank,
    },
  }
}
