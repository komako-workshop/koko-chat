#!/usr/bin/env python3
"""
小批量测试：用用户提供的两张参考图生成 logo 草稿
"""
import os
import sys
import json
import time
import base64
import random
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out_v2"
OUT.mkdir(parents=True, exist_ok=True)
LOG_PATH = ROOT / "v2_generation.log.jsonl"

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-3.1-flash-image-preview"

# load key
import re
m = re.search(r'OPENROUTER_API_KEY=([^\s\n]+)', open(Path.home() / ".alice-secrets" / ".env").read())
API_KEY = m.group(1).strip().strip('"').strip("'")

# Reference images (base64)
REFS_DIR = ROOT / "refs_user"
def load_b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode()

REF_PARROT = load_b64(REFS_DIR / "parrot.jpg")
REF_STYLIZED = load_b64(REFS_DIR / "stylized.jpg")

# ------ 每张图的 prompt 配方 ------
# (config_name, use_refs, prompt)
CONFIGS = [
    # ----- 组 A: 只用牡丹鹦鹉作风格参考 -----
    ("A_chibi_friendly_yellow", ["parrot"],
     """Create a logo mascot inspired by the SOFT WATERCOLOR CARTOON STYLE of the reference image (a chubby lovebird parrot with red face, yellow body, teal tail tip, and big round eyes).
Design specs for THIS new image:
- Single chibi parrot, head-and-shoulders portrait, slightly 3/4 angle facing the viewer
- Big sparkly round black eyes with a single bright highlight
- Curved hooked beak, slightly open as if about to speak
- Plump round body, very round and friendly proportions
- SAME watercolor-like soft gradient style as the reference: red/coral on the head fading to warm yellow body
- Clean white background
- Centered with generous padding so it works as a 1024x1024 app icon
- The mood: intelligent, friendly, like a thoughtful conversational companion
- DO NOT add any text, do not draw multiple birds, do not draw a party hat or rainbow body
- This is for KokoChat, an AI chat app — the parrot should feel both smart and cute"""),

    ("A_logo_minimal_coral", ["parrot"],
     """Create a MINIMAL FLAT VECTOR LOGO inspired by the proportions and roundness of the reference parrot, but redrawn in clean modern flat design (NOT watercolor — flat solid colors with crisp edges).
Design specs:
- Single round chibi parrot, side profile or 3/4 view
- Solid color blocks, no gradients, no shading, no outlines
- Two-tone palette: warm coral-orange on head, soft yellow body, OR cream-white body with coral cheek
- Big simple round black eye, simple curved beak
- Clean and geometric — readable at 64x64 as an app icon
- White or cream background
- Generous negative space around the subject
- Mood: smart, modern, friendly, like Linear or Notion's logo aesthetic but with character
- This is for KokoChat, a chat app for AI mini-apps. NO text, NO watermark, single subject"""),

    ("A_lineart_simple", ["parrot"],
     """Create a SINGLE-LINE-WEIGHT LINE ART LOGO inspired by the silhouette and proportions of the reference lovebird parrot.
Design specs:
- Just clean black lines on cream/off-white background, very minimal
- Single round chibi parrot, 3/4 view
- One big round eye, curved beak, plump body, simple wing line
- Like an editorial logo or a high-end coffee shop logo — sophisticated minimalism
- Even line weight throughout, no shading, no fill, just lines
- Centered 1024x1024 composition with breathing room
- Mood: thoughtful, intelligent, calm
- For KokoChat, an AI chat app. NO text, single bird"""),

    # ----- 组 B: 牡丹鹦鹉 + 风格化剪影 双参考 -----
    ("B_silhouette_meets_chibi", ["parrot", "stylized"],
     """Combine the influences of the two reference images:
- Reference 1 (lovebird parrot): the chubby round body proportions, big eyes, curved beak, warm color palette
- Reference 2 (stylized minimal silhouette): the bold flat black graphic treatment, the confident simplicity
Create a NEW logo that fuses both: a parrot drawn with bold flat shapes, but keeping the cute round chibi body and big expressive eye.
Design specs:
- Single round parrot, 3/4 view or side
- Mostly bold flat shapes (less detail than ref 1, less abstract than ref 2)
- Color palette: warm coral and soft yellow, with a confident black accent
- Big single eye that gives it personality
- Cream or off-white background
- 1024x1024 centered, app-icon-ready
- For KokoChat — smart and cute, modern and approachable. NO text, single subject"""),

    ("B_modern_mascot", ["parrot", "stylized"],
     """Using the two reference images for inspiration (a chubby cartoon lovebird and a stylized minimal silhouette), create a MODERN MASCOT LOGO for an AI chat app.
Design specs:
- One little parrot character, full body, sitting or standing pose
- Plump round body, big head, tiny feet (chibi proportions)
- Flat illustration with very subtle shading (more graphic than the watercolor reference, but warmer than the silhouette reference)
- Color palette: coral/red head, yellow/cream body, hint of teal — but use SOLID flat colors not watercolor
- Big round black eye with single highlight, friendly smile in the curved beak
- Small graphic detail to suggest "smart" — could be slight head-tilt as if listening, or holding a tiny note in beak
- Clean light background, generous padding, square 1024x1024
- Mood: cute but not childish, smart but warm
- For KokoChat. NO text. Single bird character only."""),
]


def call_api(prompt, ref_keys, max_retries=3):
    refs_b64 = {"parrot": REF_PARROT, "stylized": REF_STYLIZED}
    content = [{"type": "text", "text": prompt}]
    for k in ref_keys:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{refs_b64[k]}"}
        })

    body = json.dumps({
        "model": MODEL,
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "1:1"},
        "messages": [{"role": "user", "content": content}],
    }).encode()
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

    last_err = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=240) as resp:
                data = json.loads(resp.read())
            if data.get("error"):
                raise RuntimeError(f"API: {data['error']}")
            choices = data.get("choices") or []
            msg = (choices[0] if choices else {}).get("message") or {}
            images = msg.get("images") or []
            if not images:
                raise RuntimeError(f"no images. msg keys: {list(msg.keys())}, content: {str(msg.get('content'))[:200]}")
            url = images[0].get("image_url", {}).get("url", "")
            b64 = url.split(",", 1)[1]
            png = base64.b64decode(b64)
            cost = data.get("usage", {}).get("cost", 0)
            return png, cost
        except Exception as e:
            last_err = e
            time.sleep((2 ** attempt) + random.random())
    raise RuntimeError(f"failed after retries: {last_err}")


log_lock = threading.Lock()
def log_append(rec):
    with log_lock:
        open(LOG_PATH, "a").write(json.dumps(rec, ensure_ascii=False) + "\n")


def gen_one(idx, total, config_name, ref_keys, prompt, variant):
    fname = f"v2_{idx:03d}_{config_name}_var{variant}.png"
    out_path = OUT / fname
    if out_path.exists() and out_path.stat().st_size > 5000:
        return {"idx": idx, "status": "skipped", "file": fname}

    full_prompt = prompt + f"\n\nVariation #{variant} — make this version subtly different from other variations of this same config: vary pose, eye expression, or detail."
    t0 = time.time()
    try:
        png, cost = call_api(full_prompt, ref_keys)
        out_path.write_bytes(png)
        rec = {"idx": idx, "status": "ok", "file": fname, "config": config_name, "refs": ref_keys, "variant": variant, "cost": cost, "ms": int((time.time()-t0)*1000)}
    except Exception as e:
        rec = {"idx": idx, "status": "fail", "file": fname, "config": config_name, "error": str(e)[:200], "ms": int((time.time()-t0)*1000)}
    log_append(rec)
    return rec


def main():
    variants_per_config = int(os.environ.get("KOKO_VARIANTS", "1"))
    concurrency = int(os.environ.get("KOKO_CONCURRENCY", "4"))

    jobs = []
    idx = 0
    for cfg_name, refs, prompt in CONFIGS:
        for v in range(variants_per_config):
            jobs.append((idx, len(CONFIGS)*variants_per_config, cfg_name, refs, prompt, v))
            idx += 1

    print(f"jobs={len(jobs)} concurrency={concurrency}", flush=True)
    total_cost = 0
    ok = fail = 0
    with ThreadPoolExecutor(concurrency) as ex:
        futures = {ex.submit(gen_one, *j): j for j in jobs}
        for fut in as_completed(futures):
            r = fut.result()
            if r["status"] == "ok": ok += 1; total_cost += r.get("cost", 0)
            elif r["status"] == "fail": fail += 1
            print(f"[{ok+fail}/{len(jobs)}] {r['status']:7s} {r['file']:60s} cost=${total_cost:.3f}", flush=True)
    print(f"DONE ok={ok} fail={fail} cost=${total_cost:.3f}")


if __name__ == "__main__":
    main()
