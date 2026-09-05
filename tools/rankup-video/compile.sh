#!/usr/bin/env bash
# Stitches the three landscape puzzle cuts into one 16:9 video: puzzle 1 in
# full (it carries the intro), puzzles 2 and 3 from their puzzle screen on,
# then an outro card with the outro narration over the music bed.
#
#   tool/video/compile.sh <youtube-dir>
set -euo pipefail
Y="${1:?youtube dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
F="$Y/final"; TMP="$(mktemp -d)"
LOGO="$HERE/../../public/RankUpChess_logo.png"
MUSIC="$(ls "$Y"/audio/music/* | head -1)"
OUTRO="$Y/audio/narration/04_outro.mp3"
OUTRO_LEN=$(python3 -c "import subprocess;print(float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1','$OUTRO']))+2.5)")

start_of() { python3 -c "import json;print(max(0,json.load(open('$Y/puzzles/p$1_timeline.json'))['goPuzzle']-0.4))"; }
ENC=(-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 60 -c:a aac -b:a 192k -ar 48000 -ac 2)

cp "$F/p1_landscape.mp4" "$TMP/seg1.mp4"
for n in 2 3; do
  ffmpeg -y -v error -ss "$(start_of $n)" -i "$F/p${n}_landscape.mp4" "${ENC[@]}" "$TMP/seg$n.mp4"
done

# Outro card: logo centred, title below, narration + faded music.
python3 - "$TMP/outro_text.png" "$HERE" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGBA", (1920, 300), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
big = ImageFont.truetype(sys.argv[2] + "/assets/fonts/Nunito-Bold.ttf", 84)
small = ImageFont.truetype(sys.argv[2] + "/assets/fonts/Nunito-Regular.ttf", 52)
for text, font, y, col in (("RankUp Chess", big, 20, (255, 255, 255, 255)),
                           ("www.stillwareltd.com/rankupchess", small, 150, (245, 197, 24, 255))):
    w = d.textlength(text, font=font); d.text(((1920 - w) / 2, y), text, font=font, fill=col)
img.save(sys.argv[1])
PY
ffmpeg -y -v error -f lavfi -i "color=c=0x1A1A2E:s=1920x1080:r=60:d=$OUTRO_LEN" \
  -loop 1 -t "$OUTRO_LEN" -i "$LOGO" -loop 1 -t "$OUTRO_LEN" -i "$TMP/outro_text.png" \
  -i "$OUTRO" -stream_loop -1 -i "$MUSIC" \
  -filter_complex "[1]scale=360:-1[logo];[0][logo]overlay=(W-w)/2:220[a];[a][2]overlay=0:640,fade=t=in:d=0.6,fade=t=out:st=$(python3 -c "print($OUTRO_LEN-1)"):d=1[v];[3]adelay=800|800[n];[4]volume=-14dB,atrim=0:$OUTRO_LEN,afade=t=out:st=$(python3 -c "print($OUTRO_LEN-3)"):d=3[m];[n][m]amix=inputs=2:normalize=0[aout]" \
  -map "[v]" -map "[aout]" -t "$OUTRO_LEN" "${ENC[@]}" "$TMP/seg4.mp4"

ffmpeg -y -v error -i "$TMP/seg1.mp4" -i "$TMP/seg2.mp4" -i "$TMP/seg3.mp4" -i "$TMP/seg4.mp4" \
  -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a][3:v][3:a]concat=n=4:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" "${ENC[@]}" -movflags +faststart "$F/rankup_three_puzzles_16x9.mp4"
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$F/rankup_three_puzzles_16x9.mp4"
