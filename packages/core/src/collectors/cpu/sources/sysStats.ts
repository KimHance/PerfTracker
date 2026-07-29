import { relativeSecondSql } from '../../timeline.js'

export const SYS_STATS_SOURCE = 'linux.sys_stats'

/**
 * **perfetto `linux.sys_stats` + `linux.ftrace` + `linux.process_stats` 경로.**
 * 이 파일이 아는 것: 카운터를 어떤 SQL 로 꺼내는가.
 * 모르는 것: 사용률을 어떻게 접는가, ms 로 어떻게 바꾸는가 — 전부 `toDomain.ts` 의 몫이다.
 */

export const CPU_TIMES_SQL =
  "select json_group_array(json_object('cpu', cpu, 'counter', counter, 'first', first, " +
  "'last', last, 'first_ts', first_ts, 'last_ts', last_ts, 'samples', samples)) as j from (" +
  'select t.cpu as cpu, t.name as counter, ' +
  'cast(min(c.value) as int) as first, cast(max(c.value) as int) as last, ' +
  'min(c.ts) as first_ts, max(c.ts) as last_ts, count(*) as samples ' +
  'from counter c join cpu_counter_track t on c.track_id = t.id ' +
  "where t.name like 'cpu.times.%' " +
  'group by t.cpu, t.name order by t.cpu, t.name)'

/**
 * 기기 전역 `cpu.times.*` 의 **초별 마지막 표본** `[상대초, 카운터, 누적 ns]`.
 *
 * 코어를 여기서 합치지 않는 이유: `cpu.times.idle` 인지 아닌지를 가르는 것이 도메인 규칙이고
 * (`summarizeCpuTimes` 가 이미 그 규칙을 갖고 있다), SQL 에 두 벌로 두면 언젠가 갈린다.
 * 그래서 초·카운터별로 접어서 넘기고 busy 판정은 `toDomain` 이 한다.
 *
 * `max(c.value)` 로 그 초의 마지막을 고르는 것은 `appCpuTimelineSql` 과 같은 이유다 —
 * 누적 카운터라 최댓값이 곧 마지막 값이다. 폴링 지터로 한 초에 표본이 둘 이상이어도
 * 같은 카운터가 두 번 더해지지 않는다.
 *
 * 시간 기준점은 frame·memory·log 와 같은 `trace_bounds.start_ts` 다.
 */
export const DEVICE_CPU_TIMELINE_SQL =
  'select json_group_array(json_array(t_s, counter, v)) as j from (' +
  'select t_s, counter, sum(v) as v from (' +
  `select ${relativeSecondSql('c.ts')} as t_s, t.name as counter, t.cpu as cpu, ` +
  'cast(max(c.value) as int) as v ' +
  'from counter c join cpu_counter_track t on c.track_id = t.id ' +
  "where t.name like 'cpu.times.%' " +
  'group by t_s, t.name, t.cpu) ' +
  'group by t_s, counter order by t_s, counter)'

/** ftrace `power/cpu_frequency` 는 `cpufreq` 라는 이름의 cpu_counter_track 이 된다 (실측 확인). 단위는 kHz. */
export const CPU_FREQ_SQL =
  "select json_group_array(json_object('cpu', cpu, 'samples', samples, 'min_khz', min_khz, " +
  "'max_khz', max_khz, 'avg_khz', avg_khz)) as j from (" +
  'select t.cpu as cpu, count(*) as samples, min(c.value) as min_khz, ' +
  'max(c.value) as max_khz, avg(c.value) as avg_khz ' +
  'from counter c join cpu_counter_track t on c.track_id = t.id ' +
  "where t.name = 'cpufreq' group by t.cpu order by t.cpu)"


/**
 * upid 목록으로 runtime 카운터를 가져온다. upid 는 숫자라 인터폴레이션이 안전하다
 * (`memory/sources` 의 `appMemorySql`, `frame/sources` 의 `frameSamplesSql` 과 같은 규칙).
 *
 * `mem.rss` 는 일부러 조회하지 않는다 — 이 collector 가 쓰지 않는 값을 한 배열에 섞어
 * 오면 접는 쪽에서 CPU 합에 메모리 값이 들어갈 자리가 생긴다.
 */
export function appCpuSql(upids: number[]): string {
  return (
    "select json_group_array(json_object('upid', upid, 'counter', counter, 'first', first_v, " +
    "'last', last_v, 'samples', n, 'first_ts', first_ts, 'last_ts', last_ts)) as j from (" +
    'select t.upid as upid, t.name as counter, cast(min(c.value) as int) as first_v, ' +
    'cast(max(c.value) as int) as last_v, count(*) as n, ' +
    'min(c.ts) as first_ts, max(c.ts) as last_ts ' +
    'from counter c join process_counter_track t on c.track_id = t.id ' +
    `where t.upid in (${upids.map((u) => Math.trunc(u)).join(', ')}) ` +
    "and t.name in ('runtime.user_ns', 'runtime.kernel_ns') " +
    'group by t.upid, t.name order by t.upid, t.name)'
  )
}

/**
 * 앱 `runtime.*` 누적값의 초별 마지막 표본 `[상대초, user+kernel 누적 ns]`.
 *
 * `max(c.value)` 로 그 초의 마지막을 고른다 — 누적 카운터라 최댓값이 곧 마지막 값이다.
 * 두 카운터(user/kernel)를 각각 그렇게 고른 뒤 합쳐야 한다. 안쪽 group by 없이 바로
 * `sum(value)` 을 쓰면 같은 초에 표본이 둘 이상일 때(폴링 지터) 같은 카운터가 여러 번 더해진다.
 *
 * 시간 기준점은 frame·memory·log 와 같은 `trace_bounds.start_ts` 다.
 */
export function appCpuTimelineSql(upid: number): string {
  return (
    'select json_group_array(json_array(t_s, total_ns)) as j from (' +
    'select t_s, sum(v) as total_ns from (' +
    `select ${relativeSecondSql('c.ts')} as t_s, ` +
    't.name as n, max(c.value) as v ' +
    'from counter c join process_counter_track t on c.track_id = t.id ' +
    `where t.upid = ${Math.trunc(upid)} ` +
    "and t.name in ('runtime.user_ns', 'runtime.kernel_ns') " +
    'group by t_s, t.name) group by t_s order by t_s)'
  )
}

/**
 * 누적값을 **이웃한 두 표본의 차이**로 바꾼다.
 *
 * **첫 표본의 초는 결과에 없다.** 그 앞에 뺄 대상이 없기 때문이고, 0 으로 채우면 "그 초에
 * CPU 를 안 썼다" 는 없던 사실이 된다. `app.total_ms` 가 하한인 것과 정확히 같은 이유다.
 *
 * 차이가 음수면 그 구간을 버린다 — 프로세스별 누적 CPU 는 되감기지 않으므로, 음수가 나왔다면
 * 그 upid 가 우리가 생각하는 프로세스가 아니라는 뜻이다 (`AppCpuSummary.nonMonotonic` 과
 * 같은 판단). 지어낸 값을 싣느니 그 초를 비운다.
 */