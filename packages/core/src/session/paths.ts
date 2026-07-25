import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_SLUG_LENGTH = 60

/** 세션명을 파일시스템·URL 안전한 슬러그로 바꾼다. 원본 세션명은 session.json 에 그대로 보존된다. */
export function slugifySessionName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')

  const sliced = [...cleaned].slice(0, MAX_SLUG_LENGTH).join('')
  return sliced.length > 0 ? sliced : 'session'
}

/** 로컬 시각을 2026-07-25T14-32-10 형태로 만든다 (콜론은 파일명에 못 쓴다). */
export function formatLocalTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  )
}

export function runDirName(startedAt: Date, name: string): string {
  return `${formatLocalTimestamp(startedAt)}_${slugifySessionName(name)}`
}

/** 도구 홈. 라벨 캐시, 활성 세션 포인터, trace_processor 바이너리가 여기 산다. */
export function perfTrackerHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['PERFTRACKER_HOME'] ?? join(homedir(), '.perftracker')
}
