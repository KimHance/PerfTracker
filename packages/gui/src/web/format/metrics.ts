import { METRIC_ORDER, type MetricId, type MetricSupportView } from '../../contract/api.js'
/**
 * **칩은 지표가 아니라 "무엇을 잴 수 있나" 다.**
 *
 * 지금은 지표 하나가 칩 하나지만 그 규칙을 여기 남겨 둔다 — 렌더를 트레이스(`frame`)와
 * `hwui` 두 경로로 재던 시절, 보고서는 둘을 "렌더" 하나로 내는데 이 화면만 둘로 세워서
 * sdk 30 에서 `✗ frame` 이 **"렌더를 못 잰다"** 로 읽혔다. 실제로는 hwui 로 쟀는데도.
 * 한 개념을 두 경로로 재는 날이 다시 오면 `CHIP_GROUPS` 에 한 줄이면 된다.
 */
export interface MetricChip {
  /** 칩에 적는 이름. 묶인 것은 보고서 섹션과 같은 이름을 쓴다. */
  label: string
  ok: boolean
  /** 툴팁. 묶인 것은 경로마다 한 줄씩 — 무엇이 되고 무엇이 안 되는지 둘 다 필요하다. */
  reason: string
  /**
   * **판정을 받은 적이 있는가.** 기기를 고르기 전에는 아무 판정도 없고, 그때 `ok: false` 는
   * "안 된다" 가 아니라 "모른다" 다. 칩은 둘 다 ✗ 로 그리지만 **"미지원 N개" 로 셀 때는
   * 갈라야 한다** — 모르는 것을 못 재는 것으로 세면 기기를 고르기 전 화면이 "7개 미지원"
   * 이라고 말한다.
   */
  known: boolean
}

/** 묶어서 낼 것. 여기 없는 지표는 자기 id 그대로 칩 하나가 된다. */
const CHIP_GROUPS: { label: string; ids: MetricId[] }[] = []

export function metricChips(metrics: MetricSupportView[]): MetricChip[] {
  const grouped = new Set(CHIP_GROUPS.flatMap((g) => g.ids))
  const find = (id: MetricId): MetricSupportView | undefined => metrics.find((m) => m.id === id)
  const out: MetricChip[] = []

  for (const id of METRIC_ORDER) {
    const group = CHIP_GROUPS.find((g) => g.ids[0] === id)
    if (group !== undefined) {
      const parts = group.ids.map((gid) => ({ id: gid, v: find(gid) }))
      out.push({
        label: group.label,
        // 기기를 고르기 전에는 모른다 — 모르는 것을 "가능" 으로 그리지 않는다.
        ok: parts.some((p) => p.v?.ok === true),
        known: parts.some((p) => p.v !== undefined),
        reason: parts
          .map((p) => `${p.id}: ${p.v?.reason ?? '기기를 선택하면 판정합니다'}`)
          .join('\n'),
      })
      continue
    }
    if (grouped.has(id)) continue

    const v = find(id)
    out.push({
      label: id,
      ok: v?.ok ?? false,
      known: v !== undefined,
      reason: v?.reason ?? '기기를 선택하면 판정합니다',
    })
  }
  return out
}

export function unsupportedChips(metrics: MetricSupportView[]): MetricChip[] {
  // 판정을 안 받은 것은 세지 않는다 — 모르는 것과 못 재는 것은 다른 사실이다.
  return metricChips(metrics).filter((c) => c.known && !c.ok)
}
