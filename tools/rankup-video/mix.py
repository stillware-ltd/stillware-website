#!/usr/bin/env python3
"""Mixes one recorded puzzle clip with narration, sound effects and music.

    python3 tool/video/mix.py <youtube-dir> <puzzle-index> <raw.mov> [--offset S]

Two cuts from one capture:

* **Short** (1080×1920): the fixed Shorts intro (`00_intro_short.mp3`) and the
  one-line puzzle intro (`pN_intro_short.mp3`) replace the long-form lines, the
  head of the capture is trimmed so the puzzle still lands right after the
  intro, a 5-4-3-2-1 countdown follows every question, and from the moment the
  puzzle is solved the frame is replaced by a rendered final position (the
  app's "Puzzle Solved" screen says nothing to a viewer who wants to see the
  mate) with the pattern name under it.
* **Landscape** (1920×1080): phone on the left, the long-form narration with
  captions on the right, countdown badges, the app's solved screen kept.

Both stop before the harness quits the app so the simulator home screen never
appears. The recorder starts a little before the harness's t0; --offset is
that gap, otherwise it is measured from the home→puzzle scene cut.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = str(HERE / "assets/fonts/Nunito-Bold.ttf")
FONT_REG = str(HERE / "assets/fonts/Nunito-Regular.ttf")
PIECE_FONT = "/System/Library/Fonts/Apple Symbols.ttf"
BG = "0x1A1A2E"
MUSIC_DB = -14  # bed mean ≈ -24 dB, narration ≈ -21 dB → ~16 dB under the voice
SFX_DB = -8
LIGHT, DARK, LAST = (0xEE, 0xEE, 0xD2), (0x76, 0x96, 0x56), (0xF6, 0xF6, 0x69, 128)


def run(cmd):
    print(" ".join(str(c) for c in cmd)[:300])
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode:
        sys.exit(f"ffmpeg failed:\n{res.stderr[-3000:]}")


def duration(path: Path) -> float:
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "default=nw=1:nk=1", str(path)]))


def detect_offset(raw: Path, go_puzzle: float) -> float:
    out = subprocess.run(["ffmpeg", "-v", "info", "-i", str(raw), "-vf", "select='gt(scene,0.25)',showinfo",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    cuts = [float(m) for m in re.findall(r"pts_time:([\d.]+)", out) if float(m) > 3.0]
    if not cuts:
        sys.exit("no scene cut found; pass --offset")
    print(f"first cut at {cuts[0]:.2f}s, goPuzzle {go_puzzle:.2f}s → offset {cuts[0] - go_puzzle:.2f}s")
    return cuts[0] - go_puzzle


def wrap(text: str, width: int = 34) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur); cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def render_caption(text, out, width=1000, font_size=46):
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(FONT, font_size)
    lines = wrap(text, 38).split("\n"); line_h = int(font_size * 1.35)
    img = Image.new("RGBA", (width, line_h * len(lines) + 20), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((0, 10 + i * line_h), line, font=font, fill=(255, 255, 255, 255))
    img.save(out)


def render_timer(n, out, size=170):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse((4, 4, size - 4, size - 4), fill=(26, 26, 46, 210), outline=(245, 197, 24, 255), width=8)
    font = ImageFont.truetype(FONT, int(size * 0.55)); txt = str(n); w = d.textlength(txt, font=font)
    d.text(((size - w) / 2, size * 0.14), txt, font=font, fill=(255, 255, 255, 255)); img.save(out)


def render_final_board(fen, last_uci, flipped, out, size=1000):
    """The final position drawn the way the app draws it: green/cream squares,
    last-move tint, Unicode glyph pieces (white with a dark shadow, black solid)."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    sq = size // 8
    img = Image.new("RGBA", (sq * 8, sq * 8), (0, 0, 0, 255)); d = ImageDraw.Draw(img)
    def cell(square):
        f, r = ord(square[0]) - 97, int(square[1]) - 1
        col = 7 - f if flipped else f; row = r if flipped else 7 - r
        return col * sq, row * sq
    for f in range(8):
        for r in range(8):
            x, y = cell(f"{chr(97 + f)}{r + 1}")
            d.rectangle((x, y, x + sq, y + sq), fill=LIGHT if (f + r) % 2 else DARK)
    tint = Image.new("RGBA", img.size, (0, 0, 0, 0)); td = ImageDraw.Draw(tint)
    for s in (last_uci[:2], last_uci[2:4]):
        x, y = cell(s); td.rectangle((x, y, x + sq, y + sq), fill=LAST)
    img = Image.alpha_composite(img, tint)
    font = ImageFont.truetype(PIECE_FONT, int(sq * 0.78))
    white = {"K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": "♙"}
    black = {"k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♙"}
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rows = fen.split()[0].split("/")
    for ri, rank in enumerate(rows):
        f = 0
        for ch in rank:
            if ch.isdigit():
                f += int(ch); continue
            square = f"{chr(97 + f)}{8 - ri}"; x, y = cell(square)
            glyph = white.get(ch) or black.get(ch)
            gl = Image.new("RGBA", (sq, sq), (0, 0, 0, 0)); gd = ImageDraw.Draw(gl)
            bbox = gd.textbbox((0, 0), glyph, font=font)
            gx = (sq - (bbox[2] - bbox[0])) / 2 - bbox[0]; gy = (sq - (bbox[3] - bbox[1])) / 2 - bbox[1]
            if ch.isupper():
                shadow = Image.new("RGBA", (sq, sq), (0, 0, 0, 0)); sd = ImageDraw.Draw(shadow)
                for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (1, 1), (-1, -1), (2, 2)):
                    sd.text((gx + dx, gy + dy), glyph, font=font, fill=(0x22, 0x22, 0x22, 255))
                shadow = shadow.filter(ImageFilter.GaussianBlur(1.2))
                gl = Image.alpha_composite(gl, shadow); gd = ImageDraw.Draw(gl)
                gd.text((gx, gy), glyph, font=font, fill=(255, 255, 255, 255))
            else:
                gd.text((gx + 1, gy + 1), glyph, font=font, fill=(0, 0, 0, 64))
                gd.text((gx, gy), glyph, font=font, fill=(0x1A, 0x1A, 0x1A, 255))
            layer.paste(gl, (x, y), gl); f += 1
    img = Image.alpha_composite(img, layer); img.save(out)


def render_end_card(sel, out, board_png, size=(1080, 1920), board_top=330):
    """Card the size of the frame (Short) or of the phone capture (landscape):
    the final board where the app's board sits, pattern name below."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = size
    img = Image.new("RGBA", (W, H), (0x1A, 0x1A, 0x2E, 255)); d = ImageDraw.Draw(img)
    bw = W - 80
    board = Image.open(board_png).convert("RGBA").resize((bw, bw)); img.paste(board, (40, board_top))
    scale = W / 1080
    t1 = ImageFont.truetype(FONT, int(66 * scale)); t2 = ImageFont.truetype(FONT_REG, int(44 * scale))
    move = sel["san"][-1]; pattern = sel.get("pattern", "")
    y = board_top + bw + int(40 * scale)
    w = d.textlength(pattern, font=t1); d.text(((W - w) / 2, y), pattern, font=t1, fill=(245, 197, 24, 255))
    sub = f"{move} · {sel['tier']} · rated {sel['rating']}"
    w = d.textlength(sub, font=t2); d.text(((W - w) / 2, y + int(90 * scale)), sub, font=t2, fill=(255, 255, 255, 220))
    img.save(out)


def timer_overlays(events, first_input_idx, in_label, out_label, x, y):
    timers = [e for e in events if e["type"] == "timer"]
    chain, prev = [], in_label
    if not timers:
        return chain, in_label
    for i, ev in enumerate(timers):
        n = int(round(ev["duration"]))
        for k in range(n):
            digit = n - k; start, stop = ev["at"] + k, ev["at"] + k + 1
            last = i == len(timers) - 1 and k == n - 1
            out = out_label if last else f"[t{i}_{k}]"
            chain.append(f"{prev}[{first_input_idx + (n - digit)}]overlay={x}:{y}:enable='between(t,{start:.2f},{stop:.2f})'{out}")
            prev = out
    return chain, out_label


def build_audio(root, events, shift, variants, start_idx, end):
    """Inputs + filters for narration/SFX/music. `variants` maps tag → clip path."""
    inputs, filters, labels, captions, idx = [], [], [], [], start_idx
    for ev in events:
        if ev["type"] == "timer":
            continue
        at = ev["at"] - shift
        if ev["type"] == "narration":
            path, gain = variants.get(ev["tag"], root / "audio/narration" / f"{ev['tag']}.mp3"), "0dB"
            if not path.exists():
                print(f"  skip missing {path.name}"); continue
            dur = duration(path)
            if ev.get("align_end"):  # short variant: keep the original end time
                at = ev["at"] + ev.get("duration", dur) - shift - dur
            captions.append((at, at + dur, ev["tag"]))
        else:
            path, gain = root / "audio/sfx" / f"{ev['name']}.mp3", f"{SFX_DB}dB"
            if not path.exists():
                continue
        inputs += ["-i", str(path)]; ms = max(0, int(at * 1000))
        filters.append(f"[{idx}]volume={gain},adelay={ms}|{ms}[a{idx}]"); labels.append(f"[a{idx}]"); idx += 1
    music = sorted((root / "audio/music").glob("*.wav")) + sorted((root / "audio/music").glob("*.mp3"))
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music[0])]
        filters.append(f"[{idx}]volume={MUSIC_DB}dB,afade=t=in:d=2,atrim=0:{end:.2f},afade=t=out:st={end - 3:.2f}:d=3[a{idx}]")
        labels.append(f"[a{idx}]"); idx += 1
    filters.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]")
    return inputs, filters, captions, idx


ENC = ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "60",
       "-c:a", "aac", "-b:a", "192k", "-shortest"]


def main():
    root, n, raw = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    offset = float(sys.argv[sys.argv.index("--offset") + 1]) if "--offset" in sys.argv else None
    tl = json.loads((root / f"puzzles/p{n}_timeline.json").read_text())
    sel = json.loads((root / "puzzles/selection.json").read_text())[n - 1]
    if offset is None:
        offset = detect_offset(raw, tl["goPuzzle"])
    end = tl["end"] + 0.7  # before REC_END quits the app
    events = tl["events"]
    final = root / "final"; final.mkdir(exist_ok=True)
    work = final / f"p{n}_assets"; work.mkdir(exist_ok=True)

    texts = {}
    for f in (root / "scripts").glob("*.txt"):
        for line in f.read_text().splitlines():
            m = re.match(r"\[(\w+)\]\s*(.*)", line.strip())
            if m:
                texts[m.group(1)] = m.group(2)
    texts["00_intro"] = (root / "scripts/00_intro.txt").read_text().strip()

    timer_inputs = []
    for d in (5, 4, 3, 2, 1):
        png = work / f"timer{d}.png"; render_timer(d, png); timer_inputs += ["-loop", "1", "-i", str(png)]
    solved = next((e["at"] for e in events if e["type"] == "sfx" and e["name"] == "puzzle_correct"), None)

    # ---------- Short ----------
    long_intro = root / "audio/narration/00_intro.mp3"
    short_intro = root / "audio/narration/00_intro_short.mp3"
    shift = duration(long_intro) - duration(short_intro) if short_intro.exists() else 0.0
    variants = {"00_intro": short_intro} if short_intro.exists() else {}
    short_events = []
    for ev in events:
        ev = dict(ev)
        if ev["type"] == "narration" and (root / "audio/narration" / f"{ev['tag']}_short.mp3").exists():
            variants[ev["tag"]] = root / "audio/narration" / f"{ev['tag']}_short.mp3"; ev["align_end"] = True
        short_events.append(ev)
    s_end = end - shift
    a_in, a_f, _, idx = build_audio(root, short_events, shift, variants, 1, s_end)
    board_png = work / "final_board.png"; card_png = work / "end_card.png"
    render_final_board(sel["fens"][-1], sel["uci"][-1], sel["solver"] == "black", board_png)
    render_end_card(sel, card_png, board_png)
    v_chain = [f"[0:v]scale=1080:-2,crop=1080:1920:0:(ih-1920)/2,setsar=1[vb]"]
    card_idx = idx; idx += 1
    v_chain.append(f"[vb][{card_idx}]overlay=0:0:enable='gte(t,{solved - shift:.2f})'[vc]")
    shifted = [dict(e, at=e["at"] - shift) for e in short_events]
    t_chain, _ = timer_overlays(shifted, idx, "[vc]", "[vout]", 60, 150)
    if not t_chain:
        v_chain[-1] = v_chain[-1].replace("[vc]", "[vout]")
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{offset + shift:.3f}", "-t", f"{s_end:.2f}", "-i", str(raw), *a_in,
         "-loop", "1", "-i", str(card_png), *timer_inputs, "-filter_complex", ";".join(a_f + v_chain + t_chain),
         "-map", "[vout]", "-map", "[aout]", *ENC, str(final / f"p{n}_vertical.mp4")])

    # ---------- Landscape ----------
    a_in, a_f, captions, idx = build_audio(root, events, 0.0, {}, 1, end)
    # The phone capture is 1206×2622; a card of the same size replaces it from
    # the solved moment so the explanation runs over the final position.
    phone_card = work / "end_card_phone.png"
    render_end_card(sel, phone_card, board_png, size=(1206, 2622), board_top=640)
    card_idx = idx; idx += 1
    l_chain = [f"color=c={BG}:s=1920x1080:r=60[bg];[0:v]scale=-2:1000[ph];[bg][ph]overlay=120:40[b0];"
               f"[{card_idx}]scale=-2:1000[pc];[b0][pc]overlay=120:40:enable='gte(t,{solved:.2f})'[base]"]
    cap_inputs, prev = [], "[base]"
    t_first = idx; idx += 5
    for k, (start, stop, tag) in enumerate(captions):
        if tag not in texts:
            continue
        png = work / f"cap_{tag}.png"; render_caption(texts[tag], png); cap_inputs += ["-loop", "1", "-i", str(png)]
        out = f"[c{k}]"; l_chain.append(f"{prev}[{idx}]overlay=760:(H-h)/2:enable='between(t,{start:.2f},{stop:.2f})'{out}")
        prev = out; idx += 1
    t_chain, last = timer_overlays(events, t_first, prev, "[vout]", 760, 200)
    if not t_chain:
        l_chain[-1] = l_chain[-1].replace(prev, "[vout]")
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{offset:.3f}", "-t", f"{end:.2f}", "-i", str(raw), *a_in,
         "-loop", "1", "-i", str(phone_card), *timer_inputs, *cap_inputs, "-filter_complex", ";".join(a_f + l_chain + t_chain),
         "-map", "[vout]", "-map", "[aout]", *ENC, str(final / f"p{n}_landscape.mp4")])
    print("wrote", final / f"p{n}_vertical.mp4", "and", final / f"p{n}_landscape.mp4")


if __name__ == "__main__":
    main()
