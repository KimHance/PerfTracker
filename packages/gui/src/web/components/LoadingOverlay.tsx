import type { Loading } from '../state/model.js'

/**
 * 대기 구간을 덮는 **하나뿐인** 오버레이. `{label, command}` 만 받는다.
 *
 * 왜 전체 화면인가(사용자 결정): 대기는 탭 하나의 사정이 아니라 기기 하나를 붙잡는 일이다.
 * 왜 명령을 같이 보여 주는가: 사람이 무엇을 기다리는지 알아야 기다릴지 끊을지 판단한다.
 *
 * 지연은 고정값이 아니라 응답이 올 때까지다 — 프로토타입의 1100ms/1800ms 는 시늉이었고,
 * 실제 흐름에서는 `effects.withLoading` 이 응답까지 이 컴포넌트를 띄워 둔다.
 */
export function LoadingOverlay({ loading }: { loading: Loading }) {
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="spinner" aria-hidden />
      <div className="overlay-label">{loading.label}</div>
      <div className="overlay-command">$ {loading.command}</div>
    </div>
  )
}
