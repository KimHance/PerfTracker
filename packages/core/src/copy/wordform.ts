/**
 * 진단 모드가 **새로 내는** 사용자 문구의 꼴 — 문장보다 단어 (기능 문서 DM-15 · 결정 10).
 *
 * 규칙의 주인은 이 파일 하나다. cli · gui · core 가 각자 `DM-15 단어형 규칙` 시험을 갖지만
 * (gui 는 cli 를 못 보고 core 는 둘 다 못 본다 — 규칙 4) 낱말 목록을 셋이 따로 적으면 한 곳만
 * 고쳐지는 날이 온다. 그래서 시험은 여기서 `copyViolations` 를 import 한다. 문구 자체는 각
 * 패키지의 모음에 있고 정본은 디자인 문서 `## 문구` 표다.
 *
 * 디자이너의 표 검사기(`labs/diagnostic-mode-design/v1/check_copy.py`)와 같은 규칙이다 —
 * 표를 먼저 그 검사기로, 코드를 이 함수로 돌린다.
 */

/** 권유 · 1인칭. 음절 그대로 부분 일치. */
export const COPY_ADVICE_WORDS = ['세요', '십시오', '바랍니다', '해야', '드립니다', '저희'] as const

/**
 * 평가 낱말 — **닫힌 목록**이고 음절 그대로 부분 일치한다 (결정 10).
 *
 * 어간만 적으면 명사형(`느림`)과 불규칙 활용형(`빨라` · `나빠`)이 음절이 달라 빠진다. 그렇다고
 * 자모(NFD)로 비교하면 음절 경계를 넘어 `좋`(ㅈㅗㅎ)이 `조회`(ㅈㅗ + ㅎㅚ)에 걸린다.
 * 그래서 음절 단위로 활용형까지 적는다.
 */
export const COPY_EVAL_WORDS = [
  '느리', '느린', '느림', '느려', '느릴',
  '빠르', '빠른', '빠름', '빨라', '빨리', '빠를',
  '좋',
  '나쁘', '나쁜', '나쁨', '나빠', '나쁠',
  '부드러', '부드럽',
  '무거', '무겁',
  '가벼', '가볍',
  '심각', '주의', '문제', '병목', '권장',
] as const

/** 끝 글자로 오면 안 되는 것 — 평서 · 해요체 종결. */
export const COPY_FORBIDDEN_ENDINGS = ['다', '요'] as const

/**
 * 끝 글자 — 값 자리(`{…}`)를 지우고, 문장부호(P) · 기호(S) · 구분자(Z) · 공백을 뒤에서부터
 * 건너뛴 첫 글자. `진단 {elapsed}` 의 끝 글자는 `단` 이고 `▲` · `—` 처럼 기호뿐이면 빈 문자열이다.
 */
export function copyLastChar(text: string): string {
  const chars = [...text.normalize('NFC').replace(/\{[^}]*\}/g, '')]
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]!
    if (/^[\p{P}\p{S}\p{Z}\s]$/u.test(ch)) continue
    return ch
  }
  return ''
}

/**
 * 문구 하나가 어긴 규칙들. 빈 배열이면 통과다.
 *
 * NFC 로 맞춘 뒤 **음절** 로 비교한다 — 파일이 NFD 로 저장돼도 같은 결과가 나오게 하려는 것이지
 * 자모로 비교하려는 것이 아니다 (결정 10).
 */
export function copyViolations(text: string): string[] {
  const t = text.normalize('NFC')
  const out: string[] = []
  const last = copyLastChar(t)
  if ((COPY_FORBIDDEN_ENDINGS as readonly string[]).includes(last)) out.push(`끝=${last}`)
  if (t.includes('니다')) out.push('니다')
  for (const w of COPY_ADVICE_WORDS) if (t.includes(w)) out.push(`권유:${w}`)
  for (const w of COPY_EVAL_WORDS) if (t.includes(w)) out.push(`평가:${w}`)
  return out
}
