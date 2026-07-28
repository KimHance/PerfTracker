import { METRIC_ORDER } from '../../../contract/api.js'
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
 */
export function MetricSection({ tab }: { tab: Tab }) {
  const { state } = useStore()
  const device = selectedDevice(state, tab)
  const metrics = device?.metrics ?? []
  const okCount = metrics.filter((m) => m.ok).length

  return (
    <section>
      <SectionHead
        num="02"
        title="이 기기에서 측정 가능한 지표"
        aside={
          device === null || device.spec === null
            ? '기기를 먼저 선택하세요'
            : `${okCount}/${METRIC_ORDER.length} 측정 가능 · SDK ${device.spec.sdkInt}`
        }
      />

      <div className="chip-row">
        {METRIC_ORDER.map((id) => {
          const support = metrics.find((m) => m.id === id) ?? null
          // 기기를 고르기 전에는 되는지 안 되는지 모른다 — 모르는 것을 "가능" 으로 그리지 않는다.
          const ok = support?.ok ?? false
          return (
            <span
              key={id}
              className={ok ? 'chip chip-ok' : 'chip chip-off'}
              title={support?.reason ?? '기기를 선택하면 판정합니다'}
            >
              {ok ? '✓' : '✗'} {id}
            </span>
          )
        })}
      </div>

      <p className="section-note">{note(device === null, okCount, metrics.length)}</p>
    </section>
  )
}

function note(noDevice: boolean, okCount: number, total: number): string {
  if (noDevice || total === 0) {
    return '기기를 선택하면 doctor 와 같은 판정으로 7개 지표의 측정 가능 여부를 표시합니다.'
  }
  if (okCount === total) return '이 기기는 7개 지표를 모두 측정할 수 있습니다.'
  return '칩에 마우스를 올리면 이유가 보입니다. 못 재는 지표가 있어도 세션은 막히지 않고 나머지는 정상 수집됩니다 — 고칠 수 없는 기기의 성질입니다.'
}
