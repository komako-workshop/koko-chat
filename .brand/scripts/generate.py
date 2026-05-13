#!/usr/bin/env python3
"""
KokoChat 鹦鹉 logo / mascot 批量生成器
模型: google/gemini-3.1-flash-image-preview (Nano Banana 2) via OpenRouter
"""
import os
import sys
import json
import time
import base64
import random
import hashlib
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
import urllib.error

# ---------- 配置 ----------
ROOT = Path(__file__).resolve().parent.parent  # .brand/
OUT = ROOT / "out"
OUT.mkdir(parents=True, exist_ok=True)
LOG_PATH = ROOT / "generation.log.jsonl"
META_PATH = ROOT / "meta.json"

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-3.1-flash-image-preview"

# 读 key
SECRETS = Path.home() / ".alice-secrets" / ".env"
API_KEY = None
for line in SECRETS.read_text().splitlines():
    if line.startswith("OPENROUTER_API_KEY="):
        API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not API_KEY:
    sys.exit("OPENROUTER_API_KEY not found in ~/.alice-secrets/.env")

TARGET_COUNT = int(os.environ.get("KOKO_COUNT", "200"))
CONCURRENCY = int(os.environ.get("KOKO_CONCURRENCY", "5"))

# ---------- 维度 ----------
POSES = {
    "head-side": "a single parrot's head in pure side profile, the iconic curved hooked beak clearly visible, one large round eye",
    "head-front": "a parrot's head from the front, two large round symmetric eyes, beak pointing slightly down",
    "full-side": "a whole chibi parrot standing in side profile, oval plump body, tiny feet, short tail",
    "full-3q": "a whole chibi parrot in three-quarter view, oval plump body, head turned slightly toward viewer",
    "head-tilted": "a chibi parrot head tilted slightly, looking thoughtful and curious, big round eye",
    "holding-note": "a chibi round parrot holding a small folded paper note in its beak",
    "on-book": "a chibi round parrot sitting on top of a closed book, looking forward",
    "silhouette": "an extremely minimal silhouette of a parrot, single solid shape, flat icon style, the curve of the hooked beak is the dominant feature",
}

MOODS = {
    "smart": "intelligent, calm, restrained, clean geometry, generous negative space, gives a feeling of reliability",
    "friendly": "warm, soft, approachable, cute, gentle smile, inviting feeling",
    "playful": "lively, slightly mischievous, a tiny bit of meme energy, a developer-community sticker vibe, but still tasteful",
}

PALETTES = {
    "mono-black": "pure monochrome black on off-white background, no other colors, like a Linear or Notion icon",
    "coral": "single coral-orange color (#FF7A6B feel) on cream background, no gradients",
    "mint": "single soft mint-green color on cream background, no gradients",
    "sunset": "warm yellow-to-red gradient body suggestive of a parrot's classic plumage, on neutral background",
    "dual-teal-coral": "teal-blue body with coral-orange accent on the cheek and beak, two-tone flat colors on cream background",
    "rainbow-soft": "soft muted rainbow palette on the body, low saturation pastel rainbow as a respectful nod to internet parrot memes but clearly its own thing, on neutral background",
}

STYLES = {
    "flat": "flat vector illustration, solid color shapes, no outline, no shading, no gradient texture, perfectly clean SVG-like geometry",
    "line": "single-weight line art, minimal stroke, almost no fill, like a thoughtful editorial logo, very few details",
    "chibi": "chibi cute illustration, slightly rounded shapes, very subtle outline, a single soft highlight in the eye, still flat overall",
}

# 反例 / 负面引导（直接写进 prompt 末尾，nano banana 是文本模型不支持 negative prompt）
DONT = (
    "Do not add any text, letters, words, or watermarks. "
    "Do not depict a literal party hat, balloons, confetti, or a party scene. "
    "Do not generate photorealistic feathers or a photographic bird. "
    "Do not draw multiple birds — only one parrot in the frame. "
    "Do not use harsh black outlines unless the style explicitly is line art. "
    "Center the subject and leave clean negative space — this will be used as a logo."
)

LOGO_INTENT = (
    "This is being designed as the logo and mascot for a product called KokoChat — "
    "a chat-first mobile container for AI mini-apps and a developer community. "
    "The mascot is named Koko. "
    "The mascot should feel intelligent and trustworthy, but also cute and approachable — "
    "the parrot metaphor suggests a thoughtful conversational companion that learns and re-articulates ideas with you. "
    "Aim for a final image that would work as a square app icon at 1024x1024 and still read clearly when scaled down to 64x64."
)


def build_prompt(pose_key, mood_key, palette_key, style_key, idx):
    pose = POSES[pose_key]
    mood = MOODS[mood_key]
    palette = PALETTES[palette_key]
    style = STYLES[style_key]
    return (
        f"{LOGO_INTENT}\n\n"
        f"Subject: {pose}.\n"
        f"Mood: {mood}.\n"
        f"Color: {palette}.\n"
        f"Style: {style}.\n"
        f"Composition: 1:1 square, subject centered, generous padding around the subject (about 12-18% margin on each side).\n"
        f"{DONT}\n"
        f"Variation seed #{idx} — make this distinct from other variations of similar parameters: "
        f"vary the eye shape, the beak curve, the body posture, or the proportion subtly."
    )


def stratified_sample(n):
    """
    生成 n 个 (pose, mood, palette, style) 组合。
    保证每个维度的每个值都至少出现 n / |dim| 次（向下取整）。
    """
    dims = [
        list(POSES.keys()),
        list(MOODS.keys()),
        list(PALETTES.keys()),
        list(STYLES.keys()),
    ]
    rng = random.Random(42)
    combos = []

    # 先做拉丁方式覆盖：每个维度独立打乱后一对一拼，再额外随机补
    pools = [list(d) for d in dims]
    cycles = [iter([]) for _ in dims]

    def next_val(i):
        try:
            return next(cycles[i])
        except StopIteration:
            shuffled = pools[i][:]
            rng.shuffle(shuffled)
            cycles[i] = iter(shuffled)
            return next(cycles[i])

    seen = set()
    while len(combos) < n:
        c = (next_val(0), next_val(1), next_val(2), next_val(3))
        # 允许重复一点点也没关系，但优先避免完全相同
        if c not in seen or len(combos) > len(POSES) * len(MOODS) * len(PALETTES) * len(STYLES) // 2:
            combos.append(c)
            seen.add(c)
        if len(combos) >= n:
            break
    return combos


# ---------- API ----------
log_lock = threading.Lock()


def append_log(record):
    with log_lock:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def call_api(prompt, max_retries=3):
    body = json.dumps({
        "model": MODEL,
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "1:1"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    last_err = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read())
            if data.get("error"):
                raise RuntimeError(f"API error: {data['error']}")
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError(f"no choices: {data}")
            msg = choices[0].get("message") or {}
            images = msg.get("images") or []
            if not images:
                raise RuntimeError(f"no images returned. msg keys: {list(msg.keys())}")
            url = images[0].get("image_url", {}).get("url", "")
            if "," not in url:
                raise RuntimeError("malformed image url")
            b64 = url.split(",", 1)[1]
            png = base64.b64decode(b64)
            cost = data.get("usage", {}).get("cost", 0)
            return png, cost
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
            last_err = e
            sleep = (2 ** attempt) + random.random()
            time.sleep(sleep)
    raise RuntimeError(f"failed after {max_retries} retries: {last_err}")


# ---------- 主循环 ----------
def already_done():
    done = set()
    if not LOG_PATH.exists():
        return done
    for line in LOG_PATH.read_text().splitlines():
        try:
            r = json.loads(line)
            if r.get("status") == "ok":
                done.add(r["idx"])
        except Exception:
            pass
    return done


def generate_one(idx, combo):
    pose, mood, palette, style = combo
    fname = f"{idx:03d}_{pose}_{mood}_{palette}_{style}.png"
    out_path = OUT / fname
    if out_path.exists() and out_path.stat().st_size > 1000:
        return {"idx": idx, "status": "skipped", "file": fname}

    prompt = build_prompt(pose, mood, palette, style, idx)
    t0 = time.time()
    try:
        png, cost = call_api(prompt)
        out_path.write_bytes(png)
        rec = {
            "idx": idx,
            "status": "ok",
            "file": fname,
            "pose": pose,
            "mood": mood,
            "palette": palette,
            "style": style,
            "cost": cost,
            "ms": int((time.time() - t0) * 1000),
            "prompt": prompt,
        }
    except Exception as e:
        rec = {
            "idx": idx,
            "status": "fail",
            "file": fname,
            "pose": pose,
            "mood": mood,
            "palette": palette,
            "style": style,
            "error": str(e),
            "ms": int((time.time() - t0) * 1000),
        }
    append_log(rec)
    return rec


def main():
    combos = stratified_sample(TARGET_COUNT)
    META_PATH.write_text(json.dumps({
        "target": TARGET_COUNT,
        "combos": [{"idx": i, "pose": c[0], "mood": c[1], "palette": c[2], "style": c[3]} for i, c in enumerate(combos)],
    }, indent=2, ensure_ascii=False))

    done = already_done()
    pending = [(i, c) for i, c in enumerate(combos) if i not in done]
    print(f"target={TARGET_COUNT} done={len(done)} pending={len(pending)} concurrency={CONCURRENCY}", flush=True)

    total_cost = 0.0
    ok = 0
    fail = 0
    started = time.time()

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = {ex.submit(generate_one, i, c): i for i, c in pending}
        for fut in as_completed(futures):
            rec = fut.result()
            if rec["status"] == "ok":
                ok += 1
                total_cost += rec.get("cost", 0)
            elif rec["status"] == "fail":
                fail += 1
            elapsed = time.time() - started
            done_now = ok + fail + len(done)
            rate = (ok + fail) / max(elapsed, 0.1)
            eta = (len(pending) - (ok + fail)) / max(rate, 0.001)
            print(
                f"[{done_now}/{TARGET_COUNT}] {rec['status']:7s} {rec['file']:60s} "
                f"cost=${total_cost:.3f} rate={rate:.2f}/s eta={eta:.0f}s",
                flush=True,
            )

    print(f"\nDONE. ok={ok} fail={fail} skipped={len(done)} total_cost=${total_cost:.3f}")


if __name__ == "__main__":
    main()
