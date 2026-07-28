/**
 * Industry 의 등록 표식(코너 `+`). 네 모서리 마크를 빠뜨리지 않기 위해 컴포넌트로 둔다 —
 * 원본 시스템의 규칙은 "표식을 단 요소에서 표식을 빼지 않는다" 이다.
 */
export function BlueprintCorners() {
  return (
    <>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </>
  )
}
