import { describe, expect, it } from 'vitest'
import { resultJsonSchema } from '../../src/schema/jsonSchema.js'

type Node = Record<string, unknown>

/** nullable · optional 로 감싼 노드에서 실제 object 노드를 꺼낸다. */
function unwrap(node: Node): Node {
  const anyOf = node['anyOf'] as Node[] | undefined
  if (anyOf !== undefined) return unwrap(anyOf.find((n) => n['type'] !== 'null')!)
  if (node['type'] === 'array') return unwrap(node['items'] as Node)
  return node
}

/** 노드의 설명 — nullable 이면 감싼 쪽에 붙는다. */
function descriptionOf(node: Node): string {
  const own = node['description']
  if (typeof own === 'string') return own
  const anyOf = (node['anyOf'] as Node[] | undefined) ?? []
  return anyOf.map((n) => (typeof n['description'] === 'string' ? n['description'] : '')).join('\n')
}

/** 블록 아래 모든 필드 이름 (행 · 칸까지). */
function allKeys(node: Node): string[] {
  const obj = unwrap(node)
  const props = (obj['properties'] as Record<string, Node> | undefined) ?? {}
  return Object.entries(props).flatMap(([k, v]) => [k, ...allKeys(v)])
}

const schema = resultJsonSchema() as Node
const props = schema['properties'] as Record<string, Node>
const diagnose = props['diagnose']!
const diagnoseProps = unwrap(diagnose)['properties'] as Record<string, Node>
const overheadProps = props['measurement_overhead']!['properties'] as Record<string, Node>
const optionsProps = (props['session']!['properties'] as Record<string, Node>)['options']!['properties'] as Record<
  string,
  Node
>

describe('DM-7 판정 필드 없음', () => {
  it('DM-7 판정 필드 없음 — 진단 블록 어디에도 순위 · 등급 · 기준선 · 비율 필드가 없다', () => {
    const keys = allKeys(diagnose)
    expect(keys.length).toBeGreaterThan(15)
    const verdict = keys.filter((k) =>
      /rank|top|grade|level|score|baseline|threshold|budget|ratio|pct|percent|share|slow|fast|good|bad/i.test(k),
    )
    expect(verdict, '판정 필드').toEqual([])
  })

  it('DM-7 판정 필드 없음 — 표는 배열 하나이고 정렬 키 · 상위 N 자리가 없다', () => {
    const table = diagnoseProps['target_process_slice_names']!
    const row = unwrap(table)
    expect(Object.keys(row['properties'] as Node).sort()).toEqual(
      ['async_tracks', 'main_thread', 'name', 'other_threads'].sort(),
    )
    expect(Object.keys(unwrap((row['properties'] as Record<string, Node>)['main_thread']!)['properties'] as Node).sort()).toEqual(
      ['count', 'max_ms', 'sum_ms'],
    )
  })
})

describe('DM-7 한정 describe', () => {
  it('DM-7 한정 describe — 표 설명이 "합 ms 를 행끼리 더하면 안 됨" 과 "프레임워크 · 앱 slice 를 가르지 않음" 을 말한다', () => {
    const d = descriptionOf(diagnoseProps['target_process_slice_names']!)
    expect(d).toContain('sum_ms 를 행끼리 더하면 안 된다')
    expect(d).toContain('프레임워크 slice 와 앱 slice 를 가르지 않는다')
    expect(d).toContain('자르지 않는다')
    expect(d).toContain('코드 단위 순')
  })

  it('DM-7 한정 describe — 수 · 표 칸이 frametimeline 제외와 끝나지 않은 slice 규칙을 들고 있다', () => {
    for (const key of ['trace_slices', 'target_process_slices', 'target_process_slice_names_unfolded', 'target_process_slice_names']) {
      expect(descriptionOf(diagnoseProps[key]!), key).toContain('frametimeline')
    }
    expect(descriptionOf(diagnoseProps['target_process_slices_unfinished']!)).toContain('횟수에만 들고')
  })

  it('DM-7 한정 describe — 열림은 "남겼나" 가 아니라 "실릴 수 있던 조건" 이고 false 가 없다', () => {
    const d = descriptionOf(diagnoseProps['app_slices_open']!)
    expect(d).toContain('실릴 수 있던 조건')
    expect(d).toContain('false 는 없다')
  })

  it('DM-9 블록 status 설명이 열림 칸과 따로 간다는 것을 말한다', () => {
    const d = descriptionOf(diagnoseProps['status']!)
    expect(d).toContain('app_slices_open 은 이 상태와 따로 간다')
    expect(d).toContain('process_not_in_trace')
  })
})

describe('DM-14 schema describe 한정', () => {
  const CAVEAT = ['atrace slice 비용이 앱 프로세스에 청구', '평소 세션과 수치를 나란히 놓을 수 없다']

  it('DM-14 schema describe 한정 — 진단 여부 필드와 tracing_processes_* 셋이 같은 한정을 말한다', () => {
    const fields: [string, Node][] = [
      ['session.options.diagnose', optionsProps['diagnose']!],
      ...['tracing_processes_cpu_time_ms', 'tracing_processes_cpu_share_pct', 'tracing_processes_peak_rss_kb'].map(
        (k) => [`measurement_overhead.${k}`, overheadProps[k]!] as [string, Node],
      ),
    ]
    for (const [path, node] of fields) {
      for (const phrase of CAVEAT) expect(descriptionOf(node), path).toContain(phrase)
    }
  })

  it('DM-14 schema describe 한정 — 블록 설명도 같은 한정을 들고 있다', () => {
    for (const phrase of CAVEAT) expect(descriptionOf(diagnose)).toContain(phrase)
  })
})
