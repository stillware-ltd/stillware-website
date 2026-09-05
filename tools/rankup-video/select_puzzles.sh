#!/usr/bin/env bash
# Runs select_puzzles.dart inside the RankUp Chess project so `package:dartchess`
# and assets/database/puzzles.json resolve. Same arguments as the Dart script.
set -euo pipefail
RANKUP="${RANKUP_REPO:-/Volumes/MacStorage/StillwareLtd/Projects/Rank_Up_Chess}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DART="${DART:-$HOME/fvm/versions/3.41.4/bin/dart}"
mkdir -p "$RANKUP/.dart_tool/rankup_video"
cp "$HERE/select_puzzles.dart" "$RANKUP/.dart_tool/rankup_video/select_puzzles.dart"
cd "$RANKUP" && "$DART" run .dart_tool/rankup_video/select_puzzles.dart "$@"
