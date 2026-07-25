/**
 * `adb shell <문자열>` 은 인자를 기기의 셸에 **그대로** 넘긴다 — 공백·따옴표·`;`·`$` 가
 * 전부 셸 메타문자다. 저장소 열 곳 남짓이 패키지명과 APK 경로를 그 문자열에 보간하는데,
 * 각자 알아서 인용하면(또는 안 하면) 언젠가 한 곳이 틀린다. 인용은 여기 한 곳에서 한다.
 *
 * POSIX single-quote 규칙: 작은따옴표 안에서는 `'` 만이 특별하므로, `'` 를 `'\''` 로 바꾸고
 * 전체를 작은따옴표로 감싼다.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
