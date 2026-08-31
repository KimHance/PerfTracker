import type { AppProcessCandidate } from '../../appProcess.js'
import { resolveAppProcess, type ResolvedAppProcess } from '../../appProcess.js'
import type { ExtractContext } from '../../types.js'
import type { FrameSample } from '../model.js'

/**
 * **sdk 31+ 경로.** perfetto `android.surfaceflinger.frametimeline` 이 프레임마다 한 행을 낸다.
 *
 * 이 파일이 아는 것: 트레이스에서 프레임을 꺼내는 법.
 * 이 파일이 **모르는 것**: 표본 상한, 버킷 — 전부 `toDomain.ts` 의 몫이다.
 */
export const FRAMETIMELINE_DATA_SOURCE = 'android.surfaceflinger.frametimeline'
export const FRAMETIMELINE_MIN_SDK = 31

/** `resolveAppProcess` 가 받는 후보 하나. `frames` 는 이 프로세스가 낸 프레임 행 수 — 접기 전 로직 그대로다. */
export interface FrameProcessCandidate extends AppProcessCandidate {
  frames: number
}

/**
 * **후보 목록.** frame 은 프레임을 낸 프로세스만 후보로 삼으므로
 * `collectors/appProcess.ts` 의 공용 쿼리(`appProcessSql`) 대신
 * `actual_frame_timeline_slice` 를 조인한 자기 쿼리를 쓴다. 접기 전 코드
 * (`e38075b^:packages/core/src/collectors/frame/sources/frametimeline.ts`) 의 것을 그대로 가져왔다.
 */
export const FRAME_PROCESS_SQL =
  "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name, 'frames', frames)) as j " +
  'from (select p.upid as upid, p.pid as pid, p.name as name, count(*) as frames ' +
  'from actual_frame_timeline_slice f join process p using(upid) group by p.upid order by frames desc)'

const TRACE_START = '(select min(ts) from actual_frame_timeline_slice)'

/**
 * **한 행이 화면에 나간 프레임 하나다.**
 *
 * `actual_frame_timeline_slice` 는 **레이어마다** 한 행을 낸다. 앱이 SurfaceView 를 쓰면
 * 뒤에 까는 `Background for …` 짝까지 붙어 화면 한 번 갱신에 최대 20행이 달린다
 * (실측 Stream 33초: 행 6,932 · 실제 프레임 2,875 — 2.4배). 부풀기만 하는 것이 아니라
 * **모양이 바뀐다** — 빈 배경 레이어는 1~2ms 에 끝나 빠른 쪽에 몰린다.
 *
 * 그래서 `display_frame_token` 으로 접고 **가장 오래 걸린 레이어**를 그 프레임의 앱 시간으로
 * 쓴다. **레이어 이름으로 거르지 않는다** — 이름 목록 방어가 성립하지 않는 것은 이 저장소가
 * 이미 겪었다 (`collectors/appProcess.ts`).
 *
 * `dur >= 0` 이 필수다. trace_processor 는 종료 이벤트를 못 받은 slice 에 `dur = -1` 을
 * 내는데, `--stop` 이 트레이스를 끊는 순간 진행 중이던 프레임이 정확히 그 모양이다. 거르지
 * 않으면 그 유령 프레임이 **가장 빠른 쪽에 앉는다.**
 *
 * 표시 프레임(`layer_name is null`)은 같은 `display_frame_token` 으로 붙인다. 실측상 앱
 * 프레임이 끝난 뒤에 시작하므로(SM-F936N: 앱 0.00~6.30ms, 표시 7.11~15.08ms) 두 칸이 겹치지
 * 않고 화면에서 그대로 쌓인다.
 *
 * **접기 전 코드와 다른 점 둘.** 초 단위 버킷이 아니라 **밀리초 단위 개별 프레임**을 낸다 —
 * 이것은 시계열 집계가 아니라 프레임 하나하나의 타임라인이다. 그리고 앱 시간뿐 아니라
 * **표시 프레임의 시간도 함께** 낸다 — `presentMs` 가 그것이다.
 */
export function frameSamplesSql(upid: number): string {
  return (
    'select json_group_array(json_array(t_ms, app_ms, present_ms, deadline_ms)) as j from (' +
    `select cast((a.ts - ${TRACE_START}) / 1000000.0 as int) as t_ms, ` +
    'a.dur / 1000000.0 as app_ms, ' +
    'coalesce(d.dur, 0) / 1000000.0 as present_ms, ' +
    'e.dur / 1000000.0 as deadline_ms, ' +
    'row_number() over (partition by a.display_frame_token order by a.dur desc) as rn ' +
    'from actual_frame_timeline_slice a ' +
    'left join expected_frame_timeline_slice e ' +
    'on e.surface_frame_token = a.surface_frame_token and e.upid = a.upid ' +
    'left join actual_frame_timeline_slice d ' +
    'on d.display_frame_token = a.display_frame_token and d.layer_name is null ' +
    `where a.upid = ${upid} and a.layer_name is not null and a.dur >= 0) ` +
    'where rn = 1 order by t_ms'
  )
}

type FrameSampleRow = [number, number, number, number | null]

/** `json_array` 네 칸(위치는 SQL 이 정한 순서 그대로)을 `FrameSample` 로 옮긴다. */
function rowsToSamples(rows: FrameSampleRow[]): FrameSample[] {
  return rows.map(([tMs, appMs, presentMs, deadlineMs]) => ({
    tMs,
    appMs,
    presentMs,
    deadlineMs,
  }))
}

/**
 * `frameSamplesSql` 의 결과 원문(JSON 문자열)을 표본으로 읽는다. `TraceProcessor.queryJson` 이
 * 이미 한 번 파싱해서 돌려주므로 이 함수는 그 파이프라인 안에서 다시 불리지 않는다 —
 * 트레이스 없이도 SQL 결과 텍스트만으로 파싱 로직을 검증하려고 따로 둔 순수 함수다.
 */
export function parseFrameSamples(json: string): FrameSample[] {
  return rowsToSamples(JSON.parse(json) as FrameSampleRow[])
}

/**
 * 프로세스 특정에 **추측이 없다.** `resolveAppProcess` 가 이름도 pid 도 못 맞추면 `null` 을
 * 돌려주고, 호출자(`index.ts`)가 그 사실을 `reason_code` 로 내보낸다. 값을 절반만 채워
 * 내보내느니 아예 내지 않는 쪽을 고른다.
 */
export async function collectFromFrametimeline(
  ctx: ExtractContext,
): Promise<{ samples: FrameSample[]; resolved: ResolvedAppProcess<FrameProcessCandidate> } | null> {
  const candidates = await ctx.tp.queryJson<FrameProcessCandidate[]>(FRAME_PROCESS_SQL)
  const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
  if (resolved === null) return null

  const rows = await ctx.tp.queryJson<FrameSampleRow[]>(frameSamplesSql(resolved.candidate.upid))
  const samples = rowsToSamples(rows)

  return { samples, resolved }
}
