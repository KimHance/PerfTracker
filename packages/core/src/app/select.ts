import type { AdbClient } from '../adb/client.js'
import { AmbiguousAppError, AppNotFoundError } from '../errors.js'
import type { LabeledApp } from './list.js'

/** `mCurrentFocus=Window{... u0 com.pkg/com.pkg.Activity}` 형태에서 패키지를 뽑는다. */
export function parseForegroundPackage(text: string): string | null {
  for (const re of [/mCurrentFocus=Window\{[^}]*?\s(\S+)\/\S+\}/, /mFocusedApp=ActivityRecord\{[^}]*?\s(\S+)\/\S+/]) {
    const hit = re.exec(text)?.[1]
    if (hit && hit !== 'null') return hit
  }
  return null
}

/** start 이전 단계에서만 호출된다 — 측정 창 밖이므로 규칙 1 에 저촉되지 않는다. */
export async function detectForegroundPackage(adb: AdbClient): Promise<string | null> {
  const r = await adb.raw(['shell', 'dumpsys window'])
  return r.code === 0 ? parseForegroundPackage(r.stdout) : null
}

/**
 * 라벨과 패키지명 양쪽으로 찾는다.
 * 부분 일치가 여러 개면 자동으로 고르지 않는다 — 엉뚱한 앱을 측정한 데이터보다
 * 한 번 더 묻는 편이 낫다.
 */
export function matchApp(apps: LabeledApp[], query: string): LabeledApp {
  const needle = query.trim().toLowerCase()

  const exact = apps.filter(
    (a) => a.label.toLowerCase() === needle || a.packageName.toLowerCase() === needle,
  )
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) throw new AmbiguousAppError(query, exact)

  const partial = apps.filter(
    (a) => a.label.toLowerCase().includes(needle) || a.packageName.toLowerCase().includes(needle),
  )
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) throw new AmbiguousAppError(query, partial)

  throw new AppNotFoundError(query)
}
