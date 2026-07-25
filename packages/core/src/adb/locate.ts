import { homedir } from 'node:os'
import { accessSync, constants } from 'node:fs'
import { posix, win32 } from 'node:path'
import { AdbNotFoundError } from '../errors.js'

export type AdbSource = 'explicit' | 'env' | 'path' | 'android-home' | 'default-sdk'

export interface LocatedAdb {
  path: string
  source: AdbSource
}

export interface LocateAdbDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  homedir: string
  isExecutable(path: string): boolean
}

export function defaultLocateAdbDeps(): LocateAdbDeps {
  return {
    env: process.env,
    platform: process.platform,
    homedir: homedir(),
    isExecutable(p: string): boolean {
      try {
        accessSync(p, constants.X_OK)
        return true
      } catch {
        return false
      }
    },
  }
}

function exeName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'adb.exe' : 'adb'
}

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix
}

function defaultSdkRoot(deps: LocateAdbDeps): string {
  const p = getPathModule(deps.platform)
  if (deps.platform === 'darwin') return p.join(deps.homedir, 'Library', 'Android', 'sdk')
  if (deps.platform === 'win32') {
    return p.join(deps.env['LOCALAPPDATA'] ?? p.join(deps.homedir, 'AppData', 'Local'), 'Android', 'Sdk')
  }
  return p.join(deps.homedir, 'Android', 'Sdk')
}

/**
 * 탐색 순서: --adb → PERFTRACKER_ADB → PATH → ANDROID_HOME/ANDROID_SDK_ROOT → OS 기본 SDK 경로.
 * adb 가 PATH 에 없는 환경이 흔해서 폴백 사슬이 길다.
 */
export function locateAdb(explicitPath: string | undefined, deps: LocateAdbDeps): LocatedAdb {
  const searched: string[] = []
  const exe = exeName(deps.platform)
  const sep = deps.platform === 'win32' ? ';' : ':'
  const p = getPathModule(deps.platform)

  const tryPath = (candidate: string, source: AdbSource): LocatedAdb | null => {
    searched.push(candidate)
    return deps.isExecutable(candidate) ? { path: candidate, source } : null
  }

  if (explicitPath !== undefined) {
    const hit = tryPath(explicitPath, 'explicit')
    if (hit) return hit
    throw new AdbNotFoundError(searched)
  }

  const fromEnv = deps.env['PERFTRACKER_ADB']
  if (fromEnv) {
    const hit = tryPath(fromEnv, 'env')
    if (hit) return hit
  }

  for (const dir of (deps.env['PATH'] ?? '').split(sep).filter(Boolean)) {
    const hit = tryPath(p.join(dir, exe), 'path')
    if (hit) return hit
  }

  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT'] as const) {
    const root = deps.env[key]
    if (!root) continue
    const hit = tryPath(p.join(root, 'platform-tools', exe), 'android-home')
    if (hit) return hit
  }

  const hit = tryPath(p.join(defaultSdkRoot(deps), 'platform-tools', exe), 'default-sdk')
  if (hit) return hit

  throw new AdbNotFoundError(searched)
}
