#!/usr/bin/env python3
"""Builds the recording schedule and audio timeline for one puzzle video.

    python3 tool/video/make_plan.py <youtube-dir> <puzzle-index 1..3> [--estimate]

Reads  <dir>/puzzles/selection.json and <dir>/scripts/0N_*.txt (lines tagged
[pN_xxx]) plus the narration clips <dir>/audio/narration/<tag>.mp3. Writes
<dir>/puzzles/pN_plan.json (for integration_test/puzzle_video_test.dart) and
<dir>/puzzles/pN_timeline.json (for the ffmpeg mix). With --estimate, missing
clips are timed from their word count so the harness can be dry-run before
the voice is generated.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

WORDS_PER_SEC = 2.6
GAP = 0.6              # breath between narration lines
MOVE_LEAD = 1.1        # narrator names the move, then the piece moves
FINAL_MOVE_GAP = 0.3   # final move starts after its sentence has finished
DRAG = 0.45            # drag duration in the harness
REPLY_DELAY = 0.5      # opponentReplyDelay in PuzzleNotifier
ANIM = 0.3             # board glide
SETUP_DELAY = 0.7      # setupMoveDelay in PuzzleNotifier
ASK_HOLD = 5.0         # on-screen countdown after the narrator asks the question
SOLVED_PAUSE = 2.0     # narration silence after the final move so the app's solved sound plays alone
LOAD = 0.8             # route + puzzle load before the board is on screen


def duration(path: Path, text: str, estimate: bool) -> float:
    if path.exists():
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, check=True).stdout.strip()
        return float(out)
    if not estimate:
        sys.exit(f"missing narration clip {path} (use --estimate to dry-run)")
    return len(text.split()) / WORDS_PER_SEC + 0.4


def sfx_for(san: str) -> str:
    if san.endswith("#"):
        return "checkmate"
    if san.endswith("+"):
        return "check"
    if "x" in san:
        return "capture"
    return "move"


def main() -> None:
    root = Path(sys.argv[1])
    n = int(sys.argv[2])
    estimate = "--estimate" in sys.argv
    sel = json.loads((root / "puzzles/selection.json").read_text())[n - 1]
    script = next((root / "scripts").glob(f"0{n}_*.txt"))
    narr = root / "audio/narration"

    lines = []
    for raw in script.read_text().splitlines():
        m = re.match(r"\[(\w+)\]\s*(.*)", raw.strip())
        if m:
            lines.append((m.group(1), m.group(2)))

    intro_text = (root / "scripts/00_intro.txt").read_text().strip()
    intro_dur = duration(narr / "00_intro.mp3", intro_text, estimate)

    timeline = []   # narration + sfx events, seconds from t0
    moves = []      # solver drags for the harness
    # Home screen under the intro, then jump to the puzzle.
    t = 0.8
    timeline.append({"type": "narration", "tag": "00_intro", "at": t})
    go_puzzle = t + intro_dur + 1.0
    t = go_puzzle + LOAD + SETUP_DELAY + ANIM  # setup move has landed
    timeline.append({"type": "sfx", "name": sfx_for(sel["san"][0]),
                     "at": go_puzzle + LOAD + SETUP_DELAY})
    t += 0.4

    san = sel["san"]
    ply = 1  # index into san: solver moves at odd indices
    for tag, text in lines:
        dur = duration(narr / f"{tag}.mp3", text, estimate)
        timeline.append({"type": "narration", "tag": tag, "at": round(t, 2),
                         "duration": round(dur, 2)})
        if tag.endswith("_ask"):
            # Give the viewer a visible 5 s to think; the countdown overlay is
            # rendered by mix.py from this event.
            timer_at = t + dur + 0.3
            timeline.append({"type": "timer", "at": round(timer_at, 2), "duration": ASK_HOLD})
            t = timer_at + ASK_HOLD + 0.4
            continue
        if re.fullmatch(r"p\d_m\d", tag):
            uci = sel["uci"][ply]
            is_final = ply == len(san) - 1
            # Mid-line moves land while the narrator is still explaining; the
            # final move waits for its sentence to end so the solved chime
            # never overlaps the voice.
            drag_at = (t + dur + FINAL_MOVE_GAP) if is_final else (t + MOVE_LEAD)
            moves.append({"uci": uci, "at": round(drag_at, 2), "san": san[ply]})
            landed = drag_at + DRAG
            timeline.append({"type": "sfx", "name": sfx_for(san[ply]),
                             "at": round(landed, 2)})
            ply += 1
            if ply < len(san):
                reply_at = landed + REPLY_DELAY + ANIM
                timeline.append({"type": "sfx", "name": sfx_for(san[ply]),
                                 "at": round(reply_at, 2), "reply": san[ply]})
                ply += 1
                t = max(t + dur, reply_at) + GAP
                continue
            solved_at = landed + 0.6
            timeline.append({"type": "sfx", "name": "puzzle_correct", "at": round(solved_at, 2)})
            # The solved chime and the "Puzzle Solved" screen land here; let the
            # sentence that named the move finish, then hold before the lesson.
            t = max(t + dur, solved_at + 1.0) + SOLVED_PAUSE
            continue
        t += dur + GAP

    outro_hold = t - moves[-1]["at"] + 1.0
    plan = {
        "puzzleId": sel["dbId"],
        "flipped": sel["solver"] == "black",
        "introHold": round(go_puzzle, 2),
        "moves": moves,
        "outroHold": round(outro_hold, 2),
    }
    (root / f"puzzles/p{n}_plan.json").write_text(json.dumps(plan, indent=2))
    (root / f"puzzles/p{n}_timeline.json").write_text(
        json.dumps({"lichessId": sel["lichessId"], "goPuzzle": round(go_puzzle, 2),
                    "end": round(t, 2), "events": timeline}, indent=2))
    print(json.dumps(plan, indent=2))
    print(f"total ≈ {t:.1f}s, {'ESTIMATED' if estimate else 'measured'} durations")


if __name__ == "__main__":
    main()
