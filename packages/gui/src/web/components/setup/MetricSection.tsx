import { metricChips } from '../../format/metrics.js'
import { selectedDevice } from '../../state/derive.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { SectionHead } from '../ui/SectionHead.jsx'

/**
 * 이 기기에서 못 재는 지표를 **시작 전에** 말한다.
 *
 * 예전 CLI 는 이것을 `stop` 뒤 result.json 을 열어야 알 수 있었다. 사람이 30초 동안 앱을
 * 조작하고 나서야 "프레임이 안 잡혔다" 를 아는 것은 측정을 한 번 더 하게 만드는 정보다.
 *
 * 판정은 여기서 하지 않는다 — 서버가 doctor 와 같은 경로(`collector.supports(env)`)로 채워
 * 준 것을 그대로 그린다. 화면이 따로 판단하면 "된다고 했는데 안 되는" 상태가 생긴다.
 *
 * **설명 문단을 두지 않는다.** 칩 자체가 ✓/✗ 로 말하고 이유는 툴팁에 있으며 몇 개가 되는지는
 * 머리말이 센다. 그 아래 한 문단을 더 깔면 읽는 사람이 먼저 보는 것(어느 칩이 ✗ 인가)이
 * 글에 묻힌다. 지표 개수를 문장에 박아 두면 지표가 늘 때 조용히 거짓이 되기도 한다 —
 * 실제로 "7개 지표" 라고 적힌 채 여덟 번째가 들어왔다.
 */
export function MetricSection({ tab }: { tab: Tab }) {
  const { state } = useStore()
  const device = selectedDevice(state, tab)
  const chips = metricChips(device?.metrics ?? [])
  const okCount = chips.filter((c) => c.ok).length

  return (
    <section>
      <SectionHead
        num="02"
        title="이 기기에서 측정 가능한 지표"
        aside={
          device === null || device.spec === null
            ? '기기를 먼저 선택하세요'
            : `${okCount}/${chips.length} 측정 가능 · SDK ${device.spec.sdkInt}`
        }
      />

      <div className="chip-row">
        {chips.map((c) => (
          <span key={c.label} className={c.ok ? 'chip chip-ok' : 'chip chip-off'} title={c.reason}>
            {c.ok ? '✓' : '✗'} {c.label}
          </span>
        ))}
      </div>

    </section>
  )
}
