#!/usr/bin/env python3
"""Splits one long narration clip into per-line clips named by script tag.

    python3 tool/video/split_narration.py <clip.mp3> <script.txt> <out-dir>

The clip is generated from the whole script with `<break time="1.5s" />`
between lines, so every gap of ≥ 1.0 s of silence marks a line boundary. The
number of segments must match the number of tagged lines, or the script
aborts and prints what it found. Single-line scripts (intro/outro) are copied
as `<stem>.mp3`.
"""
import re
import subprocess
import sys
from pathlib import Path

NOISE = "-38dB"
MIN_GAP = 0.9
PAD = 0.15  # keep a little air on each side


def main():
    clip, script, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    tags = [m.group(1) for line in script.read_text().splitlines()
            if (m := re.match(r"\[(\w+)\]", line.strip()))]
    if not tags:
        dest = out / f"{script.stem}.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-c:a", "libmp3lame",
                        "-q:a", "2", str(dest)], check=True)
        print("copied", dest.name)
        return

    log = subprocess.run(
        ["ffmpeg", "-i", str(clip), "-af", f"silencedetect=noise={NOISE}:d={MIN_GAP}",
         "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    total = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "default=nw=1:nk=1", str(clip)], capture_output=True, text=True).stdout)
    # Drop leading/trailing silence from the gap list.
    gaps = [(s, e) for s, e in zip(starts, ends) if s > 0.3 and e < total - 0.3]
    if len(gaps) != len(tags) - 1:
        sys.exit(f"expected {len(tags) - 1} gaps for {len(tags)} lines, found {len(gaps)}: {gaps}")

    bounds = [0.0] + [(s + e) / 2 for s, e in gaps] + [total]
    for i, tag in enumerate(tags):
        a, b = bounds[i], bounds[i + 1]
        # Trim the shared silence back to a short pad around the speech.
        if i > 0:
            a = gaps[i - 1][1] - PAD
        if i < len(tags) - 1:
            b = gaps[i][0] + PAD
        dest = out / f"{tag}.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-to", f"{b:.3f}",
                        "-i", str(clip), "-c:a", "libmp3lame", "-q:a", "2", str(dest)], check=True)
        print(f"{tag:12s} {a:7.2f} → {b:7.2f}  ({b - a:5.2f}s)")


if __name__ == "__main__":
    main()
