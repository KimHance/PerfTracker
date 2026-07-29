import { describe, expect, it } from 'vitest'
import { formatApps } from '../../src/commands/apps.js'

const apps = [
  {
    packageName: 'com.nhn.android.webtoon',
    versionCode: 24600400,
    uid: 10359,
    label: '네이버 웹툰',
    labelSource: 'apk_resources' as const,
  },
  {
    packageName: 'com.a.b',
    versionCode: null,
    uid: null,
    label: 'com.a.b',
    labelSource: 'package_name' as const,
  },
]

describe('formatApps', () => {
  it('라벨과 패키지명과 버전코드를 함께 보여준다', () => {
    const out = formatApps(apps)
    expect(out).toContain('네이버 웹툰')
    expect(out).toContain('com.nhn.android.webtoon')
    expect(out).toContain('24600400')
  })

  it('라벨이 폴백이면 표시로 알린다', () => {
    expect(formatApps(apps)).toContain('(패키지명)')
  })

  it('앱이 없으면 안내 문구를 낸다', () => {
    expect(formatApps([])).toContain('열 수 있는 앱이 없습니다')
  })
})
