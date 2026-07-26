import { sqlQuote } from '../perfetto/traceProcessor/client.js'

/**
 * 트레이스 안에서 "대상 앱의 프로세스" 를 특정하는 **단 하나의 규칙.**
 *
 * 왜 이름만으로는 안 되는가 (실측):
 * `linux.process_stats` 는 프로세스를 처음 관측할 때 `/proc/<pid>/cmdline` 을 읽어 이름을
 * 한 번 확정하고 이후 갱신하지 않는다. zygote 가 fork 한 앱 프로세스는 `Process.setArgV0()`
 * 이 실제 패키지명을 붙이기 **전** 잠깐 `zygote64` 라는 이름을 갖는데, 폴링이 하필 그 창에
 * 걸리면 그 트레이스는 앱을 영원히 `zygote64` 로 안다. `--launch` 는 force-stop 후 다시
 * 띄우므로 앱 프로세스가 **항상** 갓 fork 된 상태이고, 그래서 이 경합은 예외가 아니라 상수다.
 * (에뮬레이터 API 35 실측: `select * from process where pid = 6037` →
 *  `name = "zygote64", uid = 0`. uid 조차 아직 앱의 것이 아니라 대안이 되지 못한다.)
 *
 * 그래서 캡처 단계가 `am start -W` 직후 기기에 물어 둔 pid 를 두 번째 근거로 쓴다.
 * **추측은 하지 않는다** — 이름도 pid 도 못 맞추면 null 이고, 호출자는 그 사실을
 * `reason_code` 로 내보낸다. 예전 frame collector 에는 "시스템 프로세스를 뺀 최다 프레임"
 * 휴리스틱이 있었고, 그것이 정확히 `process: "zygote64"` 라는 틀린 사실을 만들어 냈다.
 */
export interface AppProcessCandidate {
  upid: number
  pid: number
  name: string | null
}

/**
 * 무엇이 이 프로세스를 대상 앱이라고 확인해 주었는가.
 *   - `trace_name`  : 트레이스가 가진 이름이 패키지명(또는 `패키지:서브프로세스`)과 일치했다.
 *   - `capture_pid` : 이름은 일치하지 않았고, 캡처 시점에 기기가 알려 준 pid 가 일치했다.
 */
export type AppProcessMatch = 'trace_name' | 'capture_pid'

export interface ResolvedAppProcess<C extends AppProcessCandidate> {
  candidate: C
  match: AppProcessMatch
  /** 결과에 실을 이름. 우리가 실제로 확인한 이름만 들어간다. */
  name: string
  /** 트레이스가 이 프로세스를 부르던 이름. `match === 'capture_pid'` 일 때 `name` 과 다르다. */
  traceName: string | null
}

function isAppName(name: string | null, packageName: string): boolean {
  return name !== null && (name === packageName || name.startsWith(`${packageName}:`))
}

/**
 * 후보를 좁혀서 가져온다. **frame 을 뺀 세 collector(cpu / memory / log)가 이 한 쿼리를
 * 공유한다** — 셋이 각자 후보를 모으면 같은 세션의 세 지표가 서로 다른 프로세스를 가리킬 수
 * 있고, 그것이 이 파일이 존재하는 이유 자체를 무너뜨린다. (frame 은 프레임을 낸 프로세스만
 * 후보로 삼으므로 `actual_frame_timeline_slice` 를 조인한 자기 쿼리를 쓴다.)
 *
 * `glob` 을 쓰는 이유: 패키지명에 `.` 이 흔한데 `like` 에서는 `_` 가 와일드카드라
 * `com.foo_bar` 가 `com.fooXbar` 를 잡는다. glob 은 `.` 도 `_` 도 리터럴이다.
 * (`*` 와 `?` 와 `[` 는 패키지명에 나올 수 없다.)
 *
 * `appPid` 가 있으면 pid 조건도 함께 건다 — 이름이 `<pre-initialized>` 나 `zygote64` 로 굳은
 * 프로세스는 이름 조건으로는 절대 후보에 들어오지 못하기 때문이다 (위 설명 참고).
 * pid 는 숫자라 인터폴레이션이 안전하다.
 */
export function appProcessSql(packageName: string, appPid: number | null): string {
  const exact = sqlQuote(packageName)
  const sub = sqlQuote(`${packageName}:*`)
  const byPid = appPid !== null ? ` or p.pid = ${Math.trunc(appPid)}` : ''
  return (
    "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name)) as j from (" +
    `select p.upid as upid, p.pid as pid, p.name as name from process p ` +
    `where p.name = ${exact} or p.name glob ${sub}${byPid} order by p.pid)`
  )
}

/**
 * 순서: 캡처한 pid → 정확한 패키지명 → `패키지:서브프로세스`(pid 가 가장 작은 것) → 없음.
 *
 * pid 를 맨 앞에 두는 이유: pid 는 "우리가 띄운 바로 그 프로세스" 를 가리키는 유일한 식별자다.
 * 세션 중 앱이 죽고 다시 뜨면 같은 이름의 프로세스가 둘이 되는데, 그때 이름은 둘을 구분하지
 * 못한다. 그 pid 의 트레이스 이름이 마침 패키지명과 맞으면 그것은 이름으로 확인된 것이기도
 * 하므로 `trace_name` 으로 보고한다 — 굳이 약한 근거로 낮춰 말할 이유가 없다.
 *
 * 서브프로세스 중에서 pid 가 가장 작은 것을 고르는 규칙은 memory collector 에서 왔다:
 * 메인이 세션 중에 안 떴다는 뜻이므로 가장 먼저 뜬 것을 쓰고 그 이름을 결과에 그대로 남긴다.
 * 합산하지 않는다 — 합산한 RSS 는 공유 페이지를 여러 번 센다.
 */
export function resolveAppProcess<C extends AppProcessCandidate>(
  candidates: C[],
  packageName: string,
  appPid: number | null,
): ResolvedAppProcess<C> | null {
  if (appPid !== null) {
    const byPid = candidates.find((c) => c.pid === appPid)
    if (byPid !== undefined) {
      const confirmedByName = isAppName(byPid.name, packageName)
      return {
        candidate: byPid,
        match: confirmedByName ? 'trace_name' : 'capture_pid',
        name: confirmedByName ? byPid.name! : packageName,
        traceName: byPid.name,
      }
    }
  }

  const exact = candidates.find((c) => c.name === packageName)
  if (exact !== undefined) {
    return { candidate: exact, match: 'trace_name', name: packageName, traceName: exact.name }
  }

  const sub = candidates
    .filter((c) => c.name !== null && c.name.startsWith(`${packageName}:`))
    .sort((a, b) => a.pid - b.pid)[0]
  if (sub !== undefined) {
    return { candidate: sub, match: 'trace_name', name: sub.name!, traceName: sub.name }
  }

  return null
}

/**
 * 이름이 낡아 pid 로만 확인된 경우의 사유. 값은 정상적으로 나오지만 트레이스가 가진 이름과
 * 우리가 보고하는 이름이 다르다는 사실을 결과에 남긴다.
 */
export function staleNameReason(
  resolved: ResolvedAppProcess<AppProcessCandidate>,
  packageName: string,
): { code: 'process_name_stale_in_trace'; detail: Record<string, unknown> } | null {
  if (resolved.match !== 'capture_pid') return null
  return {
    code: 'process_name_stale_in_trace',
    detail: { package: packageName, pid: resolved.candidate.pid, trace_name: resolved.traceName },
  }
}
