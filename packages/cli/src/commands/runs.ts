import {
  clearRuns,
  deleteRun,
  formatElapsed,
  listRunDirs,
  listRuns,
  renameRun,
  type RunSummary,
  SessionStateError,
} from '@perftracker/core'

/**
 * 기록 관리. **기기에 접촉하지 않는다** — 기록은 이미 호스트에 있는 파일이고,
 * 그것을 보거나 지우려고 기기를 깨울 이유가 없다. `createContext` 를 부르지 않는 것이 그 증거다.
 *
 * 왜 이 명령이 생겼는가: 한동안 목록·이름변경·삭제가 **GUI 에만** 있었다. 그 상태를 두면
 * GUI 가 조금씩 자기만의 로직을 갖게 되고, "GUI 로는 되는데 CLI 로는 안 되는 일" 이 늘어난다.
 * 판정과 파일 조작은 core 에 있고 CLI 와 GUI 는 나란히 그것을 부른다.
 */

/** `MM/DD HH:MM`. 기록 목록은 여러 줄이 세로로 붙으므로 연도까지 적으면 눈이 밀린다. */
function formatWhen(iso: string): string {
  const [date, time] = iso.split('T')
  if (!date || !time) return iso
  const [, month, day] = date.split('-')
  return month && day ? `${month}/${day} ${time.slice(0, 5)}` : iso
}

/**
 * 터미널에서 **두 칸**을 차지하는 글자. 한글·한자·가나·전각 기호가 여기 든다.
 * `String.prototype.padEnd` 는 글자 수로 세기 때문에 이것을 모르면 한글 이름이 섞인 목록의
 * 열이 전부 밀린다 (실측: "클린업 검증" 과 "동시-A11" 이 다른 칸에서 끝났다).
 */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/

export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1
  return width
}

/** 표시 폭 기준으로 오른쪽을 채운다. 이미 넘치면 그대로 둔다 — 잘라서 이름을 망가뜨리지 않는다. */
export function padDisplay(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

function formatRow(run: RunSummary): string {
  const tail = [`경고 ${run.warningCount}`]
  if (run.unsupportedCount > 0) tail.push(`미지원 ${run.unsupportedCount}`)
  if (run.markCount > 0) tail.push(`마킹 ${run.markCount}`)

  return (
    `${run.id}  ${padDisplay(run.name, 20)}  ${padDisplay(run.model ?? '모델 미상', 12)}  ` +
    `${formatWhen(run.startedAt)}  ${formatElapsed(run.durationMs)}  ${tail.join(' · ')}`
  )
}

export async function runRunsList(opts: { out: string }): Promise<string> {
  const runs = await listRuns(opts.out)
  if (runs.length === 0) {
    // 0 건은 오류가 아니다. 아직 한 번도 재지 않았을 뿐이다.
    return `${opts.out} 에 기록이 없습니다. perftracker start 로 측정을 시작하세요.`
  }
  return [...runs.map(formatRow), '', `${runs.length}건 · ${opts.out}`].join('\n')
}

export async function runRunsRename(id: string, name: string, opts: { out: string }): Promise<string> {
  const run = await renameRun(opts.out, id, name)
  if (run === null) throw new SessionStateError(`기록 ${id} 을(를) ${opts.out} 에서 찾지 못했습니다.`)
  // 디렉토리 이름은 바뀌지 않는다 — 이미 그 경로를 적어 둔 메모와 로그가 죽지 않게.
  return `이름을 바꿨습니다: ${run.name}\n→ ${run.runDir}`
}

/**
 * 삭제. **run 디렉토리를 통째로 지우고 되돌릴 수 없다.**
 *
 * id 를 직접 적은 것은 그 자체가 의사 표시이므로 묻지 않는다. 반면 `--all` 은 한 번의 오타로
 * 전부 잃는 명령이라 `--yes` 를 요구한다. 되묻지 않고 **거부**하는 이유는 CI 때문이다 —
 * 입력을 기다리면 빌드가 타임아웃까지 매달린다.
 */
export async function runRunsRemove(
  id: string | undefined,
  opts: { out: string; all: boolean; yes: boolean },
): Promise<string> {
  if (opts.all) {
    const entries = await listRunDirs(opts.out)
    const removable = entries.filter((e) => !e.active)
    const active = entries.length - removable.length
    const records = removable.filter((e) => e.summary !== null).length
    const incomplete = removable.length - records

    if (removable.length === 0) {
      return active > 0
        ? `${opts.out} 에는 측정 중인 세션 ${active}건뿐입니다. 지우려면 먼저 perftracker stop 하세요.`
        : `${opts.out} 에 지울 것이 없습니다.`
    }

    if (!opts.yes) {
      throw new SessionStateError(
        `${describeTargets(records, incomplete)}을 지우려 합니다. 되돌릴 수 없습니다.\n` +
          (active > 0 ? `(측정 중인 세션 ${active}건은 지우지 않습니다)\n` : '') +
          `정말이라면 --yes 를 함께 주세요:\n` +
          `  perftracker runs rm --all --yes -o ${opts.out}`,
      )
    }

    const r = await clearRuns(opts.out)
    return (
      `${describeTargets(r.records, r.incomplete)}을 지웠습니다.` +
      (r.skippedActive > 0 ? `\n측정 중인 세션 ${r.skippedActive}건은 남겼습니다.` : '')
    )
  }

  if (id === undefined) {
    throw new SessionStateError(
      '지울 기록의 id 를 주거나 --all 을 쓰세요.\n  perftracker runs   로 id 를 확인할 수 있습니다.',
    )
  }

  const result = await deleteRun(opts.out, id)
  if (!result.deleted) {
    // 측정 중인 폴더를 "못 찾았다" 고 하면 사람이 엉뚱한 곳을 뒤진다. 이유를 갈라서 말한다.
    throw new SessionStateError(
      result.reason === 'active'
        ? `${id} 은(는) 지금 측정 중인 세션입니다. 먼저 perftracker stop 을 실행하세요.`
        : `${id} 을(를) ${opts.out} 에서 찾지 못했습니다.\n` +
          `  기록은 perftracker runs 로, 그 밖의 폴더는 디렉토리 이름으로 지정할 수 있습니다.`,
    )
  }
  return `지웠습니다: ${result.runDir}`
}

/**
 * "기록 2건" 과 "기록 2건 + 미완성 3건" 을 가려 말한다.
 * 미완성은 `start` 가 죽었거나 `--force` 로 밀린 폴더다 — 목록에는 없지만 디스크는 차지한다.
 */
function describeTargets(records: number, incomplete: number): string {
  const parts: string[] = []
  if (records > 0) parts.push(`기록 ${records}건`)
  if (incomplete > 0) parts.push(`미완성 ${incomplete}건`)
  return parts.join(' + ')
}
