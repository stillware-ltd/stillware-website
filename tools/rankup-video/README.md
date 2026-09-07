# RankUp Chess video pipeline

Produces the RankUp Chess YouTube puzzle videos — three Shorts and one
long compilation per batch — from captures of the real app on the iOS
simulator. The app repository carries none of this; the scripts drive it
from here (`RANKUP_REPO`, default `/Volumes/MacStorage/StillwareLtd/Projects/Rank_Up_Chess`).
Marketing assets (scripts, narration, music, raw captures, finals) live in
`/Volumes/MacStorage/StillwareLtd/Marketing/RankUp_Chess/Youtube`.

| Script | Role |
|---|---|
| `select_puzzles.sh` | Lists candidate puzzles with SAN and spoken moves (runs `select_puzzles.dart` inside the app project so dartchess resolves) |
| `make_plan.py <youtube-dir> <n> [--estimate]` | Narration-first schedule: 5 s countdown after each question, final move after its sentence, 2 s hold on the solved chime |
| `record_puzzle.sh <udid> <plan.json> <out.mov>` | Copies `puzzle_video_test.dart` into the app project for the run, drives it with `flutter drive`, records with `simctl io recordVideo`, removes the test afterwards |
| `split_narration.py <clip> <script> <out-dir>` | Splits one ElevenLabs clip (lines separated by `<break time="1.5s" />`) into per-tag files on silence |
| `mix.py <youtube-dir> <n> <raw.mov>` | Short (own intro, countdown, rendered final-position end card) and landscape cut (captions, final-position card in place of the phone) |
| `compile.sh <youtube-dir>` | Stitches the landscape cuts with the outro card into the long video |

Requirements: fvm Flutter 3.41.4, ffmpeg (Homebrew), Python 3 with Pillow,
a booted iPhone 17 Pro simulator. Fonts are bundled (Nunito, OFL); the
outro card uses `public/RankUpChess_logo.png`.

```bash
Y=/Volumes/MacStorage/StillwareLtd/Marketing/RankUp_Chess/Youtube
UDID=CC161F16-1F60-4FC5-91EE-943FABC09E1B
for n in 1 2 3; do
  python3 tools/rankup-video/make_plan.py "$Y" $n
  tools/rankup-video/record_puzzle.sh "$UDID" "$Y/puzzles/p${n}_plan.json" "$Y/raw/p$n.mov"
  python3 tools/rankup-video/mix.py "$Y" $n "$Y/raw/p$n.mov"
done
tools/rankup-video/compile.sh "$Y"
```

Editorial rules and platform guidance are in the `chess-youtube` Claude
skill; the folder README in the Youtube directory is the per-batch runbook.
