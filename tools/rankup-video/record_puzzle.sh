#!/usr/bin/env bash
# Records one scheduled puzzle on a booted iOS simulator for the YouTube video.
#
#   tools/rankup-video/record_puzzle.sh <simulator-udid> <plan.json> <out.mov>
#
# The integration test has to compile inside the RankUp Chess Flutter project,
# so it is copied into $RANKUP_REPO/integration_test/ for the duration of the
# run and removed afterwards — the app repo carries no video tooling.
#
# Runs integration_test/puzzle_video_test.dart with `flutter drive` and
# captures the screen with `simctl io recordVideo`. The test prints REC_START
# once the home screen is up; we start the recorder, give it a moment to
# roll, then drop a `rec_go` marker into the app's Documents folder, which
# the test treats as t0 for its schedule.
set -euo pipefail
UDID="${1:?simulator udid}"
PLAN="${2:?plan.json}"
OUT="${3:?output .mov path}"
BUNDLE=com.stillware.rankupChess
FLUTTER="${FLUTTER:-$HOME/fvm/versions/3.41.4/bin/flutter}"
RANKUP="${RANKUP_REPO:-/Volumes/MacStorage/StillwareLtd/Projects/Rank_Up_Chess}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PLAN="$(cd "$(dirname "$PLAN")" && pwd)/$(basename "$PLAN")"
OUT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")"
TEST="$RANKUP/integration_test/puzzle_video_test.dart"
cp "$HERE/puzzle_video_test.dart" "$TEST"
trap 'rm -f "$TEST"' EXIT
cd "$RANKUP"

mkdir -p "$(dirname "$OUT")"
xcrun simctl bootstatus "$UDID" -b >/dev/null
PLAN_B64="$(base64 < "$PLAN" | tr -d '\n')"

# The recorder runs inside the simulator service and cannot write to every
# location this shell can (external volumes, for one): record to a temp file.
TMP="$(mktemp -d)/puzzle.mov"
DRIVE_LOG="$(dirname "$TMP")/drive.log"

"$FLUTTER" drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/puzzle_video_test.dart \
  --dart-define=PLAN_B64="$PLAN_B64" \
  -d "$UDID" >"$DRIVE_LOG" 2>&1 &
DRIVE=$!

REC=""
while kill -0 "$DRIVE" 2>/dev/null; do
  if grep -q "REC_START" "$DRIVE_LOG"; then
    nohup xcrun simctl io "$UDID" recordVideo --codec h264 --force "$TMP" \
      >"$TMP.log" 2>&1 &
    REC=$!
    sleep 2
    DOCS="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents"
    mkdir -p "$DOCS"
    touch "$DOCS/rec_go"
    break
  fi
  sleep 0.2
done

# flutter drive does not always exit after a failed test; give it 40 s
# past the failure marker, then pull the plug so a batch can move on.
while kill -0 "$DRIVE" 2>/dev/null; do
  if grep -qE "Some tests failed|\[E\]" "$DRIVE_LOG"; then
    sleep 40
    kill -0 "$DRIVE" 2>/dev/null && { echo "test failed; killing stuck driver" >&2; pkill -P "$DRIVE"; kill "$DRIVE"; }
    break
  fi
  sleep 1
done
set +e
wait "$DRIVE"; STATUS=$?
set -e
grep -E "flutter: (REC_|T0|GO_PUZZLE|MOVE)|All tests passed|Some tests failed|Exception" "$DRIVE_LOG" | tail -20

if [ -z "$REC" ]; then
  echo "test never reached REC_START; nothing recorded" >&2
elif kill -0 "$REC" 2>/dev/null; then
  kill -INT "$REC"
  wait "$REC" || true
else
  echo "recorder died during the run:" >&2; cat "$TMP.log" >&2
fi
cp "$DRIVE_LOG" "${OUT%.mov}.drive.log" 2>/dev/null || true
[ -f "$TMP" ] && mv "$TMP" "$OUT" && echo "recorded $OUT"
exit $STATUS
