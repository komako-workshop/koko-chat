#!/usr/bin/env python3
"""
v3: 明确借 Party Parrot 神韵 + 牡丹鹦鹉配色锚点
20 张多方向探索
"""
import os, sys, json, time, base64, random, threading, re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out_v3"
OUT.mkdir(parents=True, exist_ok=True)
LOG_PATH = ROOT / "v3_generation.log.jsonl"

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-3.1-flash-image-preview"

m = re.search(r'OPENROUTER_API_KEY=([^\s\n]+)', open(Path.home()/".alice-secrets"/".env").read())
API_KEY = m.group(1).strip().strip('"').strip("'")

REFS_DIR = ROOT / "refs_user"
def b64(p):
    return base64.b64encode(open(p,"rb").read()).decode()
REF_PARROT = b64(REFS_DIR / "parrot.jpg")

# 通用引导：所有 prompt 都加这段
SOUL = """The visual SOUL we are after is the famous Party Parrot internet meme (派对鹦鹉) — that round, plump, big-eyed, head-bobbing rainbow parrot beloved by developer communities on Slack/Discord/GitHub. Channel its essence: the chubby teardrop-shaped body, the oversized expressive eye, the curved hooked beak, the playful confident attitude. But this is NOT a Party Parrot copy — we are designing the official logo/mascot for KokoChat (a chat-first AI mini-app container, with a developer community vibe). The mascot's name is Koko."""

ANCHOR = """The attached reference image shows the warm color palette and chibi cartoon proportions we love: red/coral cheek, sunny yellow body, hint of teal, big round black eyes — but the final image should NOT photocopy that watercolor style. Reinterpret these colors and proportions in the style described below."""

DONT = """Do NOT add any text, letters, numbers, watermarks. Do NOT draw multiple birds — only one parrot in frame. Do NOT depict a literal party hat, confetti, balloons, or party scene. Center the subject with generous padding (~15% margin) so it works as a 1024×1024 app icon. The image must be production-ready as an app icon and recognizable when scaled to 64×64."""

# 20 个具体方向 (variant_id, name, style_brief)
VARIANTS = [
    ("01_flat_logo_coral",
     "Modern flat vector logo, single coral-orange and cream color, side profile of the parrot's head with the curved hooked beak as the dominant graphic feature, big round black eye with a single white highlight. Clean geometric shapes, no outlines, no gradients. Style: like Linear or Notion's icon system."),

    ("02_chibi_3q_warm",
     "Cute chibi parrot, 3/4 view, full body sitting pose. Plump round body. Soft flat-color illustration with very subtle shading. Coral head, warm yellow body, tiny teal tail tip. Big sparkling round eyes, curved beak slightly open as if mid-conversation. Cream background. Style: like a tasteful sticker pack illustration."),

    ("03_emoji_round_face",
     "Round emoji-like parrot face, completely front-facing, perfectly circular silhouette. Two huge round black eyes, prominent curved orange beak, simple round colored body. Warm yellow + coral palette. Like a rich custom emoji that would live in a Slack workspace next to :partyparrot:."),

    ("04_lineart_minimal",
     "Single-weight black line art on cream background. Just lines, no fill. Round parrot body, big circular eye, curved beak — extremely minimal but unmistakably the same chubby parrot vibe. Like an editorial logo or a thoughtful tattoo design. Confident lines, no fussiness."),

    ("05_app_icon_squircle",
     "Designed as an iOS-style app icon: a round chibi parrot centered on a soft gradient squircle background (cream-to-peach gradient). The parrot itself is a flat illustration — coral head, yellow body, big eye, curved beak. Friendly and inviting like Duolingo's owl but as a parrot. The icon should look at home on an iPhone home screen."),

    ("06_geometric_shapes",
     "Modern geometric reinterpretation: the parrot's form built from a few simple geometric shapes — a round circle for the body, a smaller circle for the head, a triangle for the beak, a circle for the eye. Coral and yellow palette. Style: like the 2010s Airbnb-Bélo era or Mailchimp Freddie's first sketch — confident and minimal."),

    ("07_sticker_smug",
     "A confident slightly smug-looking chibi parrot sticker. Big eye looking sideways with a knowing expression, curved beak with a tiny smirk-curve. Plump body with thick die-cut white sticker outline. Coral + yellow + teal palette. Like the kind of sticker a developer would put on their MacBook."),

    ("08_thinking_pose",
     "A round chibi parrot in a thinking pose: head slightly tilted, one wing-tip touching the chin/beak area as if pondering. Conveys 'smart and thoughtful conversational AI'. Soft flat illustration, warm coral and yellow palette, big curious eye. Cream background."),

    ("09_silhouette_iconic",
     "Pure single-color silhouette of the iconic Party-Parrot-style chubby bird, in coral or warm orange tone, on a cream background. The silhouette must be instantly readable — round body, curved hooked beak in profile, single dark eye dot in negative space. Like a confident brand mark."),

    ("10_pixel_8bit",
     "A charming 8-bit / 16-bit pixel-art chibi parrot, round body, big square pixel eye, curved beak. Warm palette: coral, yellow, hint of teal. Limited palette (max 6 colors). Cream background. The kind of mascot a developer-tools brand would use as a fun secondary asset. Crisp pixels, no anti-aliasing."),

    ("11_blob_friendly",
     "An ultra-rounded blob-style parrot — almost no neck, body and head are one continuous round blob. Big eye, curved beak, tiny suggestion of wings. Soft pastel coral and yellow palette with NO outlines, just clean color shapes. Cream background. Maximum cute, minimum complexity."),

    ("12_dual_tone_modern",
     "Modern dual-tone logo: parrot head in profile, exactly two flat colors — coral on the head/cheek area, soft cream-yellow on the rest of the head and body. Sharp clean edges where colors meet. Big bold black eye, simple curved beak. Cream background. Like a refined craft-coffee brand logo."),

    ("13_face_only_zoom",
     "Extreme close-up of just the parrot's face: big round eye taking up significant portion of the frame, plus the curved hooked beak. Cropped tight. Chibi proportions exaggerated — the eye almost as big as the head. Coral and yellow palette. Cute but a bit derpy in a charming way."),

    ("14_holding_letter",
     "A chibi parrot holding a small folded paper note in its curved beak — suggesting messaging, chat, conversation. Full body 3/4 view, plump round body. Coral head, yellow body, big round eye. Soft flat illustration on cream background. The note is a simple white shape, no text on it."),

    ("15_perched_on_chat_bubble",
     "A chibi parrot perched on top of a simple chat speech bubble. The bubble is a clean rounded shape in soft cream/peach. The parrot is small and cute on top, head tilted slightly with an inquisitive look. Coral + yellow palette. This visually communicates 'parrot + chat'. Background is plain off-white."),

    ("16_low_poly",
     "Low-poly geometric parrot — body composed of simple flat triangular and trapezoid facets in coral/yellow/cream tones. Modern, slightly editorial, 3/4 view. Big simple eye, clear beak silhouette. Like a 2017-era Spotify-Wrapped illustration style but warmer."),

    ("17_japanese_kawaii",
     "Japanese kawaii-style chibi parrot: tiny mouth/beak, simple oval eyes (could be dot eyes or simple eye-shape with single highlight), round marshmallow body, soft pastel coral and butter-yellow palette, hint of pink cheeks. Sticker-ready cuteness, but tasteful and not saccharine. White background."),

    ("18_brutalist_thick",
     "Bold thick-lined illustration style — chunky black outlines, flat fill colors inside, slightly off-register printing feel. Round parrot, big eye, prominent curved beak. Warm coral + yellow + cream palette. Like the New Yorker or a confident editorial spot illustration. Brutalist but cute."),

    ("19_zoomed_eye_focus",
     "Composition focuses on the parrot's huge expressive round eye — the eye is the hero. Body and beak are simplified almost to silhouette around it. The eye has a single bright highlight that makes it look alive and curious. Coral and yellow palette around the eye. The logo says 'I'm watching, listening, learning.'"),

    ("20_pure_vector_app",
     "Polished vector app-icon design: a centered chibi parrot character, perfectly balanced composition. Three flat colors only: coral, warm yellow, cream. No outlines, no shading, no gradients. Geometrically constructed but with character — the kind of icon that wins design awards. The parrot has a small confident smile in its beak shape and a sparkling eye."),
]


def call_api(prompt, max_retries=3):
    body = json.dumps({
        "model": MODEL,
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "1:1"},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{REF_PARROT}"}},
        ]}],
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
                raise RuntimeError(f"no images returned")
            url = images[0].get("image_url", {}).get("url", "")
            png = base64.b64decode(url.split(",", 1)[1])
            cost = data.get("usage", {}).get("cost", 0)
            return png, cost
        except Exception as e:
            last_err = e
            time.sleep((2 ** attempt) + random.random())
    raise RuntimeError(f"failed: {last_err}")


log_lock = threading.Lock()
def log(rec):
    with log_lock:
        open(LOG_PATH, "a").write(json.dumps(rec, ensure_ascii=False) + "\n")


def gen_one(variant_id, name, brief):
    fname = f"v3_{name}.png"
    out_path = OUT / fname
    if out_path.exists() and out_path.stat().st_size > 5000:
        return {"id": variant_id, "status": "skipped", "file": fname}

    prompt = f"{SOUL}\n\n{ANCHOR}\n\nFor THIS specific image:\n{brief}\n\n{DONT}"
    t0 = time.time()
    try:
        png, cost = call_api(prompt)
        out_path.write_bytes(png)
        rec = {"id": variant_id, "status": "ok", "file": fname, "cost": cost,
               "ms": int((time.time()-t0)*1000), "prompt": prompt}
    except Exception as e:
        rec = {"id": variant_id, "status": "fail", "file": fname, "error": str(e)[:200]}
    log(rec)
    return rec


def main():
    concurrency = int(os.environ.get("KOKO_CONCURRENCY", "5"))
    print(f"jobs={len(VARIANTS)} concurrency={concurrency}", flush=True)
    total_cost = 0; ok = fail = 0
    with ThreadPoolExecutor(concurrency) as ex:
        futures = {ex.submit(gen_one, idx, name, brief): idx for idx, (name, brief) in enumerate(VARIANTS)}
        for fut in as_completed(futures):
            r = fut.result()
            if r["status"] == "ok":
                ok += 1; total_cost += r.get("cost", 0)
            elif r["status"] == "fail":
                fail += 1
            print(f"[{ok+fail}/{len(VARIANTS)}] {r['status']:7s} {r['file']:50s} cost=${total_cost:.3f}", flush=True)
    print(f"\nDONE ok={ok} fail={fail} cost=${total_cost:.3f}")


if __name__ == "__main__":
    main()
