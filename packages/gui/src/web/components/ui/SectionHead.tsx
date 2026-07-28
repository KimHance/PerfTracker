import type { ReactNode } from 'react'

/** 설정 화면의 `01`~`04` 섹션 머리. 번호 · 제목 · 우측 보조(실행 명령명 등). */
export function SectionHead({
  num,
  title,
  aside,
  action,
}: {
  num: string
  title: string
  aside?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="section-head">
      <span className="section-num">{num}</span>
      <h2 className="section-title">{title}</h2>
      {aside !== undefined && <span className="section-aside truncate">{aside}</span>}
      {action}
    </div>
  )
}
