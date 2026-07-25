import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { perfTrackerHome } from '../../session/paths.js'

export interface CachedLabel {
  label: string
  source: 'apk_resources' | 'aapt2' | 'package_name'
}

export interface LabelCache {
  get(pkg: string, versionCode: number | null): CachedLabel | undefined
  set(pkg: string, versionCode: number | null, value: CachedLabel): void
  save(): Promise<void>
}

function keyOf(pkg: string, versionCode: number | null): string {
  return `${pkg}@${versionCode ?? 'unknown'}`
}

/**
 * 라벨 해석은 APK 리소스를 끌어오는 비용이 있어 (패키지, versionCode) 로 캐싱한다.
 * 앱이 업데이트되면 versionCode 가 바뀌므로 캐시가 자동으로 무효화된다.
 */
export async function loadLabelCache(serial: string, home: string = perfTrackerHome()): Promise<LabelCache> {
  const file = join(home, 'labels', `${serial}.json`)
  const entries = new Map<string, CachedLabel>()

  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, CachedLabel>
    for (const [k, v] of Object.entries(parsed)) entries.set(k, v)
  } catch {
    // 파일이 없거나 깨졌으면 빈 캐시로 시작한다 — 캐시는 언제든 버려도 되는 데이터다.
  }

  let dirty = false

  return {
    get: (pkg, versionCode) => entries.get(keyOf(pkg, versionCode)),
    set: (pkg, versionCode, value) => {
      entries.set(keyOf(pkg, versionCode), value)
      dirty = true
    },
    async save() {
      if (!dirty) return
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, 'utf8')
      dirty = false
    },
  }
}
