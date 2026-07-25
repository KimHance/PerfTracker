import { accessSync, constants } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { TraceProcessorError } from '../../errors.js'
import { perfTrackerHome } from '../../session/paths.js'

export const TRACE_PROCESSOR_VERSION = 'v57.2'

export interface TraceProcessorArtifact {
  arch: string
  sha256: string
  sizeBytes: number
}

/** get.perfetto.dev 의 래퍼는 python 스크립트라, 플랫폼 바이너리를 직접 받는다. */
const ARTIFACTS: Record<string, TraceProcessorArtifact> = {
  'darwin-arm64': {
    arch: 'mac-arm64',
    sha256: '98a41b80e9f60da0373d64aff6455681f8c26b7c391ae5736324a5b11e3dacc2',
    sizeBytes: 12_704_456,
  },
  'darwin-x64': {
    arch: 'mac-amd64',
    sha256: 'c0f61397901da47cbe1bb9a0843624f7c2038ac92176ce15e3736ce9aa0afef0',
    sizeBytes: 13_787_208,
  },
  'linux-x64': {
    arch: 'linux-amd64',
    sha256: '55ba613fc6d4f71df81eee2dbfc293020063655c241b3e314bff75345b802684',
    sizeBytes: 14_008_280,
  },
  'linux-arm64': {
    arch: 'linux-arm64',
    sha256: '1dcc1d9aaff2eb92e8bc58f1957e4e445600294bd61dbc09345c1018c5ff0868',
    sizeBytes: 13_297_064,
  },
  'linux-arm': {
    arch: 'linux-arm',
    sha256: '0f3221a1fb6dbe584c4bdc4a7541bcf15e6e5c5dde5e4910744dfb8913ee62c5',
    sizeBytes: 10_321_532,
  },
  'win32-x64': {
    arch: 'windows-amd64',
    sha256: '100334b6091596fbc97f872556849a5747bf47a7f7190c485ba8cea8d2409c7b',
    sizeBytes: 13_617_152,
  },
}

export function artifactFor(platform: NodeJS.Platform, arch: string): TraceProcessorArtifact {
  const hit = ARTIFACTS[`${platform}-${arch}`]
  if (!hit) {
    throw new TraceProcessorError(
      `이 플랫폼(${platform}-${arch})용 trace_processor 바이너리가 없습니다. ` +
        `PERFTRACKER_TRACE_PROCESSOR 로 직접 지정하세요.`,
    )
  }
  return hit
}

export function downloadUrl(artifact: TraceProcessorArtifact): string {
  return (
    `https://commondatastorage.googleapis.com/perfetto-luci-artifacts/` +
    `${TRACE_PROCESSOR_VERSION}/${artifact.arch}/trace_processor_shell`
  )
}

export function cachedBinaryPath(
  artifact: TraceProcessorArtifact,
  home: string = perfTrackerHome(),
): string {
  return join(home, 'bin', `trace_processor_shell-${artifact.sha256.slice(0, 16)}`)
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureTraceProcessor(
  opts: {
    explicitPath?: string
    offline?: boolean
    home?: string
    platform?: NodeJS.Platform
    arch?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<string> {
  const env = opts.env ?? process.env

  const explicit = opts.explicitPath ?? env['PERFTRACKER_TRACE_PROCESSOR']
  if (explicit) {
    if (!isExecutable(explicit)) {
      throw new TraceProcessorError(`지정한 trace_processor 를 실행할 수 없습니다: ${explicit}`)
    }
    return explicit
  }

  const artifact = artifactFor(opts.platform ?? process.platform, opts.arch ?? process.arch)
  const cached = cachedBinaryPath(artifact, opts.home ?? perfTrackerHome())
  if (isExecutable(cached)) return cached

  if (opts.offline) {
    throw new TraceProcessorError(
      `trace_processor 가 없고 --offline 이라 받을 수 없습니다. 받으려면 --offline 없이 실행하세요.\n` +
        `또는 ${downloadUrl(artifact)} 를 직접 받아 ${cached} 에 두세요.`,
    )
  }

  const url = downloadUrl(artifact)
  const response = await fetch(url)
  if (!response.ok) {
    throw new TraceProcessorError(`trace_processor 다운로드 실패 (${response.status}): ${url}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== artifact.sizeBytes) {
    throw new TraceProcessorError(
      `trace_processor 크기가 맞지 않습니다 (${bytes.length} != ${artifact.sizeBytes} bytes). ` +
        `프록시가 중간에서 응답을 바꿨을 수 있습니다: ${url}`,
    )
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== artifact.sha256) {
    throw new TraceProcessorError(
      `trace_processor 체크섬이 맞지 않습니다.\n기대: ${artifact.sha256}\n실제: ${digest}`,
    )
  }

  // 임시 파일에 쓰고 chmod 한 뒤 rename 한다. 곧바로 최종 경로에 쓰면 chmod 전에 죽었을 때
  // 실행 권한 없는 파일이 남아 이후 실행이 계속 실패한다 (isExecutable 이 false 인 캐시).
  await mkdir(dirname(cached), { recursive: true })
  const temp = `${cached}.${process.pid}.tmp`
  try {
    await writeFile(temp, bytes)
    await chmod(temp, 0o755)
    await rename(temp, cached)
  } catch (e) {
    await rm(temp, { force: true })
    throw e
  }
  return cached
}

/** doctor 가 "받아야 하는지"를 알려주기 위해 캐시 존재만 확인한다. */
export function traceProcessorCacheState(
  home: string = perfTrackerHome(),
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { path: string; present: boolean } {
  const path = cachedBinaryPath(artifactFor(platform, arch), home)
  return { path, present: isExecutable(path) }
}
