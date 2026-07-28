import type { DeviceView } from '../../../contract/api.js'
import { refreshDevices, runDoctor, selectDevice } from '../../effects/effects.js'
import { formatSpecLine, unsupportedCount } from '../../format/device.js'
import { busySerials } from '../../state/derive.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { SectionHead } from '../ui/SectionHead.jsx'

export function DeviceSection({ tab }: { tab: Tab }) {
  const { state, deps } = useStore()
  const busy = busySerials(state, tab.key)

  return (
    <section>
      <SectionHead
        num="01"
        title="기기 선택"
        aside="perftracker devices"
        action={
          <button className="btn btn-ghost btn-sm" onClick={() => void refreshDevices(deps)}>
            새로고침
          </button>
        }
      />

      {state.devices.length === 0 ? (
        <div className="empty">
          <div className="empty-title">연결된 기기가 없습니다</div>
          <div className="empty-body">
            USB 로 연결하고 기기 화면의 <b>USB 디버깅 허용</b>을 눌러 주세요. 이미 연결했다면{' '}
            <span className="mono" style={{ fontSize: 11 }}>
              unauthorized / offline
            </span>{' '}
            상태일 수 있습니다.
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              justifyContent: 'center',
              marginTop: 'var(--space-4)',
            }}
          >
            <button className="btn btn-primary btn-md" onClick={() => void refreshDevices(deps)}>
              다시 조회
            </button>
            <button className="btn btn-secondary btn-md" onClick={() => void runDoctor(deps, null)}>
              환경 점검
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {state.devices.map((device) => (
            <DeviceRow
              key={device.serial}
              device={device}
              selected={device.serial === tab.serial}
              busy={busy.has(device.serial)}
              onSelect={() =>
                void selectDevice(deps, tab.key, device.serial, state.appsBySerial[device.serial] !== undefined)
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DeviceRow({
  device,
  selected,
  busy,
  onSelect,
}: {
  device: DeviceView
  selected: boolean
  busy: boolean
  onSelect: () => void
}) {
  const missing = unsupportedCount(device.metrics)
  // 쓸 수 없는 상태의 기기도 목록에서 감추지 않는다 — 꽂았는데 안 보이면 사람은 케이블을 의심한다.
  const unusable = device.state !== 'device'

  return (
    <button
      className="device-row"
      aria-pressed={selected}
      disabled={busy || unusable}
      onClick={onSelect}
      title={busy ? '다른 탭에서 이 기기로 측정 중입니다' : undefined}
    >
      <span className="device-row-top">
        <span className="device-serial">{device.serial}</span>
        <span className="device-model">{device.model ?? '모델 미상'}</span>
        {selected && <span className="badge badge-solid">선택됨</span>}
        {busy && <span className="badge badge-neutral">다른 탭에서 측정 중</span>}
        {unusable && <span className="badge badge-neutral">{device.state}</span>}
        {!selected && !busy && !unusable && missing > 0 && (
          <span className="badge badge-accent">지표 {missing}개 미지원</span>
        )}
      </span>
      <span className="device-spec">{formatSpecLine(device)}</span>
    </button>
  )
}
