#!/usr/bin/env python3
"""시안 표본 — 진단 블록 slice 표 32행 (합성).

이름은 research/atrace-youtube.md (SM-S901N · YouTube 21.29.366 · B1-r1) 의 실측 이름을 접은 꼴,
값은 그 표의 메인 스레드 수치 + 갈래(그 밖 스레드 · 비동기 트랙)를 지어 붙인 합성이다.
접은 자리 표기 `*` 와 필드 이름은 시안 자리표시 — diag-extract 가 README 에서 정한다.

  python3 labs/diagnostic-mode-design/v1/gen_sample.py   # → sample.json (같은 폴더)
"""
import json
import pathlib

# (이름, 메인 스레드, 그 밖 스레드, 비동기 트랙) — 칸 = [횟수, 합 ms, 최대 ms] 또는 None(그 갈래에 slice 없음)
ROWS = [
    ("<missing root>", None, [1500, 7574.2, 2011.3], None),
    ("<missing root>:BS.getBrowseData", None, [90, 277.4, 59.1], None),
    ("<missing root>:fut elements", None, [2017, 552.0, 76.4], None),
    ("<missing root>:initMediaInitializer", None, [33, 260.3, 167.0], None),
    ("ARVSLC#onScrolled", [490, 318.3, 31.0], [364, 41.9, 3.2], None),
    ("Choreographer#doFrame *", [550, 3035.0, 75.3], None, None),
    ("Choreographer#doFrame - resynced to * in *ms", [65, 753.6, 75.1], None, None),
    ("IPLC.attemptTransition:PLAYING", [198, 172.8, 65.7], [211, 1282.3, 331.0], None),
    ("Intenting into MainActivity", [9, 177.9, 97.9], None, None),
    ("Lifecycle.Started MainActivity", None, None, [7, 2056.4, 2009.1]),
    ("MountState.mount treeid=* rematerializationCount=*", [787, 233.2, 18.2], None, None),
    ("OpenDexFilesFromOat(/data/app/~~*==/com.google.android.youtube-*==/base.apk)", None, [1, 41.2, 41.2], None),
    ("RV Scroll", [364, 432.8, 21.6], None, None),
    ("Record View#draw()", [453, 153.3, 10.8], None, None),
    ("VRI[Shell$HomeActivity]@*", [64, 336.4, 39.9], None, None),
    ("View#onTouchEvent", [71, 257.5, 25.3], None, None),
    ("ViewPostImeInputStage id=*", [50, 317.8, 25.6], None, None),
    ("activityStart", [1, 175.0, 175.0], None, None),
    ("animation", [495, 830.2, 24.9], None, None),
    ("bindApplication", [1, 86.1, 86.1], None, None),
    ("clientTransactionExecuted", [5, 204.8, 203.8], None, None),
    ("deliverInputEvent src=* eventTimeNano=* id=*", [50, 361.7, 31.9], None, None),
    ("doSomeWork", None, [518, 836.0, 101.2], None),
    ("draw-VRI[Shell$HomeActivity]@*", [456, 1377.9, 45.3], None, None),
    ("first thumb complete", None, None, [125, 103.0, 17.0]),
    ("input", [64, 342.9, 40.0], None, None),
    ("onAccountReady", None, None, [62, 2099.0, 2007.0]),
    ("postAndWait", [453, 1170.8, 44.0], None, None),
    ("startActivity: Intent { act=android.intent.action.VIEW dat=vnd.youtube:* flg=* "
     "cmp=com.google.android.youtube/com.google.android.apps.youtube.app.watchwhile.WatchWhileActivity "
     "(has extras) }", [1, 12.4, 12.4], None, None),
    ("tk-trace-id: *", [312, 341.4, 98.0], [8506, 18232.6, 2011.0], None),
    ("traversal", [456, 1822.3, 61.1], None, None),
    ("traceFirstFrame", None, None, [1, 836.0, 836.0]),
]

BRANCHES = ["main", "other", "async"]


def code_unit_key(name: str) -> list[int]:
    # 이름의 UTF-16 코드 단위 순 — JS 의 `a < b` 와 같다 (호스트 로캘 무관 · 기능 문서 결정 7)
    b = name.encode("utf-16-be")
    return [int.from_bytes(b[i:i + 2], "big") for i in range(0, len(b), 2)]


def main() -> None:
    rows = [dict(name=n, **{k: v for k, v in zip(BRANCHES, cells)}) for n, *cells in ROWS]
    by_name = sorted(rows, key=lambda r: code_unit_key(r["name"]))
    # 정렬 뒤 표본: 메인 스레드 합 ms 내림 · 빈 칸(None)은 방향과 무관하게 끝 · 같은 값은 이름 순
    with_v = [r for r in by_name if r["main"] is not None]
    without = [r for r in by_name if r["main"] is None]
    by_main_sum = sorted(with_v, key=lambda r: -r["main"][1]) + without
    out = {
        "note": "합성 표본 — gen_sample.py 머리 주석",
        "table_rows_total": 1055,
        "rows_by_name": by_name,
        "rows_by_main_sum_desc": [r["name"] for r in by_main_sum],
    }
    dst = pathlib.Path(__file__).with_name("sample.json")
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(dst, len(rows), "rows")
    for r in by_name:
        print(" ", r["name"][:70])


if __name__ == "__main__":
    main()
