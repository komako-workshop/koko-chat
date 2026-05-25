#!/usr/bin/env python3
"""
Deeply avatar exploration.

Uses OpenRouter's Nano Banana 2 model from the current environment:
OPENROUTER_API_KEY must be injected by envbox or your shell.
"""

from __future__ import annotations

import base64
import concurrent.futures
import html
import json
import mimetypes
import os
import random
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
OUT.mkdir(parents=True, exist_ok=True)

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-3.1-flash-image-preview"

REFERENCE_IMAGE = Path(
    os.environ.get(
        "DEEPLY_REFERENCE_IMAGE",
        "/Users/lijianren/.cursor/projects/Users-lijianren-Desktop-workspace-koko-chat/assets/image-b6e2003b-ffad-4f3c-a7ba-617f0215a4d0.png",
    )
)

DONT = (
    "No text, no letters, no watermark, no UI chrome. "
    "Avoid horror, gore, photorealistic anatomy, medical diagrams, or creepy brain texture. "
    "Keep it friendly, clever, soft, and immediately readable at 64x64. "
    "Use a clean square app-icon composition with generous negative space."
)

SHARED_INTENT = (
    "Design an avatar/icon for 'Deeply', a KokoChat mini-app for deep learning, knowledge exploration, "
    "and course-like conversations with an AI that feels like a learned friend. "
    "Use the attached reference image only for the emotional idea: a cute brain character wrestling with "
    "a hard ancient book/fossil of knowledge. Do not copy the exact drawing. "
    "Keep the KokoChat brand feeling: warm, cute, rounded, cozy, off-white background, soft orange accents "
    "(#F5A742 / #FFE9C7), gentle shadows, and a premium clay/toy illustration finish."
)

VARIANTS = [
    {
        "id": "01-brain-bites-ancient-book",
        "title": "脑子啃古书",
        "note": "最接近参考图：把“深度学习很硬但很好吃”做成一个 meme 感头像。",
        "prompt": (
            "A cute pink brain mascot with tiny arms and legs, happily but effortfully biting into a huge "
            "ancient stone book. The book is beige stone with a spiral fossil relief on the cover and a few "
            "small crumbs falling. The brain has closed determined eyes, blush cheeks, and two tiny blue "
            "sweat drops. Hand-drawn charm mixed with soft 3D clay illustration, warm off-white background, "
            "small orange star accents."
        ),
    },
    {
        "id": "02-brain-hugs-heavy-book",
        "title": "抱住厚书",
        "note": "更温柔、更适合聊天列表：不是啃咬，是用力拥抱一块知识硬骨头。",
        "prompt": (
            "A cute rounded pink brain mascot hugging an oversized heavy ancient book made of warm beige "
            "stone. The brain looks curious and stubborn, cheeks blushing, tiny legs planted firmly, a few "
            "blue sweat drops showing effort. The book has a carved spiral shell fossil on it. Cozy KokoChat "
            "warm orange accents, soft clay/toy icon style."
        ),
    },
    {
        "id": "03-brain-excavates-knowledge",
        "title": "挖掘知识化石",
        "note": "更“探索感”：Deeply 像是在把书里的知识化石一点点挖出来。",
        "prompt": (
            "A cute pink brain explorer mascot wearing a tiny warm-orange scarf, using a small toy chisel "
            "or brush to excavate a spiral fossil from a thick stone book. The brain is delighted and focused. "
            "Small dust puffs, tiny pebbles, and warm star sparkles. Square friendly app icon, rounded soft "
            "3D clay style, off-white background."
        ),
    },
    {
        "id": "04-brain-chews-paper-book",
        "title": "啃纸质厚书",
        "note": "比石书更日常，适合偏“学习陪伴”和“课程”而非考古隐喻。",
        "prompt": (
            "A cute pink brain mascot nibbling the corner of a comically thick paper book with a warm beige "
            "cover. The brain looks determined and adorable, cheeks rosy, tiny arms holding the book, a few "
            "loose pages floating like crumbs. Warm orange KokoChat star accents, soft 3D clay illustration, "
            "clean off-white square background."
        ),
    },
    {
        "id": "05-brain-under-study-lamp",
        "title": "深夜啃书",
        "note": "最有“陪你深度学习”的氛围：脑子、书、暖灯组成安静学习场景。",
        "prompt": (
            "A cute pink brain mascot sitting beside an open book under a tiny warm-orange desk lamp, taking "
            "a playful bite from the edge of the book while studying late at night. Cozy warm glow from the "
            "pages, off-white background, small golden stars, soft rounded toy-like 3D icon style."
        ),
    },
    {
        "id": "06-brain-vs-knowledge-boulder",
        "title": "知识硬骨头",
        "note": "把“啃硬书”再抽象一点：脑子在推/咬一块刻着书页纹路的知识巨石。",
        "prompt": (
            "A cute pink brain mascot pushing and biting a rounded beige knowledge boulder shaped like a "
            "closed book, with carved page lines and a spiral fossil mark. The brain is sweating but cheerful, "
            "showing lovable effort. Warm orange highlights, soft off-white background, app icon composition, "
            "soft claymation finish."
        ),
    },
]


def image_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def request_image(prompt: str, reference: Path | None) -> tuple[bytes, float]:
    content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
    if reference and reference.exists():
        content.append({"type": "image_url", "image_url": {"url": image_data_url(reference)}})

    body = json.dumps(
        {
            "model": MODEL,
            "modalities": ["image", "text"],
            "image_config": {"aspect_ratio": "1:1"},
            "messages": [{"role": "user", "content": content}],
        }
    ).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kokochat.local/deeply-avatar-lab",
        "X-Title": "KokoChat Deeply Avatar Lab",
    }

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=240) as response:
                data = json.loads(response.read())
            if data.get("error"):
                raise RuntimeError(f"API error: {data['error']}")
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError(f"no choices returned: {data}")
            message = choices[0].get("message") or {}
            images = message.get("images") or []
            if not images:
                raise RuntimeError(f"no images returned, message keys: {list(message.keys())}")
            url = images[0].get("image_url", {}).get("url", "")
            if "," not in url:
                raise RuntimeError("malformed image url returned")
            return base64.b64decode(url.split(",", 1)[1]), float(data.get("usage", {}).get("cost", 0) or 0)
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as exc:
            last_error = exc
            time.sleep((2**attempt) + random.random())

    raise RuntimeError(f"failed after retries: {last_error}")


def api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("OPENROUTER_API_KEY is missing. Run this through envbox or export it first.")
    return key


def generate_one(variant: dict[str, str]) -> dict[str, object]:
    filename = f"{variant['id']}.png"
    out_path = OUT / filename
    if out_path.exists() and out_path.stat().st_size > 1000:
        return {**variant, "file": f"out/{filename}", "status": "skipped", "cost": 0}

    full_prompt = f"{SHARED_INTENT}\n\nVariant: {variant['prompt']}\n\n{DONT}"
    started = time.time()
    png, cost = request_image(full_prompt, REFERENCE_IMAGE)
    out_path.write_bytes(png)
    return {
        **variant,
        "file": f"out/{filename}",
        "status": "ok",
        "cost": cost,
        "ms": int((time.time() - started) * 1000),
        "prompt": full_prompt,
    }


def write_index(results: list[dict[str, object]]) -> None:
    copied_reference = ROOT / "reference.png"
    if REFERENCE_IMAGE.exists():
        shutil.copyfile(REFERENCE_IMAGE, copied_reference)

    cards = "\n".join(
        f"""
        <article class="card">
          <img src="{html.escape(str(item['file']))}" alt="{html.escape(str(item['title']))}">
          <div class="card-body">
            <div class="eyebrow">{html.escape(str(item['id']))}</div>
            <h2>{html.escape(str(item['title']))}</h2>
            <p>{html.escape(str(item['note']))}</p>
          </div>
        </article>
        """
        for item in results
    )

    data = json.dumps(results, ensure_ascii=False, indent=2)
    (ROOT / "index.html").write_text(
        f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deeply 头像实验</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #fffaf1;
      --paper: #ffffff;
      --ink: #2e1e10;
      --muted: #8f7658;
      --line: #eadfc8;
      --orange: #f5a742;
      --orange-soft: #fff1d4;
      --shadow: 0 20px 60px rgba(88, 55, 16, 0.13);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font-family: ui-rounded, "SF Pro Rounded", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 18% 8%, rgba(245, 167, 66, 0.2), transparent 28rem),
        radial-gradient(circle at 90% 12%, rgba(255, 233, 199, 0.9), transparent 22rem),
        var(--bg);
    }}
    main {{
      width: min(1180px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 42px 0 60px;
    }}
    .hero {{
      display: grid;
      grid-template-columns: 1fr minmax(220px, 320px);
      gap: 28px;
      align-items: end;
      margin-bottom: 28px;
    }}
    .badge {{
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }}
    h1 {{
      margin: 18px 0 12px;
      font-size: clamp(38px, 7vw, 76px);
      line-height: 0.95;
      letter-spacing: -0.05em;
    }}
    .intro {{
      max-width: 720px;
      margin: 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.7;
    }}
    .reference {{
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: rgba(255, 255, 255, 0.78);
      box-shadow: var(--shadow);
    }}
    .reference img {{
      width: 100%;
      display: block;
      border-radius: 18px;
    }}
    .reference p {{
      margin: 12px 4px 2px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px;
    }}
    .card {{
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 30px;
      background: rgba(255, 255, 255, 0.84);
      box-shadow: var(--shadow);
    }}
    .card img {{
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      display: block;
      background: var(--orange-soft);
      cursor: zoom-in;
    }}
    .card-body {{
      padding: 18px 18px 20px;
    }}
    .eyebrow {{
      color: var(--orange);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    h2 {{
      margin: 6px 0 8px;
      font-size: 22px;
      letter-spacing: -0.02em;
    }}
    .card p {{
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.65;
    }}
    details {{
      margin-top: 26px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.76);
      padding: 16px 18px;
    }}
    summary {{
      cursor: pointer;
      font-weight: 800;
    }}
    pre {{
      overflow: auto;
      font-size: 12px;
      line-height: 1.5;
      color: #634b2f;
    }}
    .lightbox {{
      position: fixed;
      inset: 0;
      display: none;
      place-items: center;
      padding: 32px;
      background: rgba(46, 30, 16, 0.72);
      z-index: 10;
    }}
    .lightbox.open {{ display: grid; }}
    .lightbox img {{
      max-width: min(90vw, 900px);
      max-height: 90vh;
      border-radius: 32px;
      box-shadow: 0 30px 100px rgba(0, 0, 0, 0.35);
    }}
    @media (max-width: 860px) {{
      .hero {{ grid-template-columns: 1fr; }}
      .reference {{ max-width: 360px; }}
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    }}
    @media (max-width: 560px) {{
      main {{ width: min(100vw - 24px, 1180px); padding-top: 24px; }}
      .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <div class="badge">Deeply avatar lab · Nano Banana 2</div>
        <h1>脑子啃书，越啃越深。</h1>
        <p class="intro">这组方向把你给的参考图转成 Deeply 的头像语言：可爱的脑子角色、厚重难啃的知识物、KokoChat 的暖橙和米白底。点击图片可以放大看。</p>
      </div>
      <aside class="reference">
        <img src="reference.png" alt="参考图">
        <p>参考图只取“脑子努力啃知识硬物”的感觉，不直接复制线稿。</p>
      </aside>
    </section>

    <section class="grid">
      {cards}
    </section>

    <details>
      <summary>生成记录 / prompts</summary>
      <pre>{html.escape(data)}</pre>
    </details>
  </main>
  <div class="lightbox" id="lightbox" aria-hidden="true">
    <img alt="">
  </div>
  <script>
    const lightbox = document.querySelector('#lightbox');
    const lightboxImage = lightbox.querySelector('img');
    document.querySelectorAll('.card img').forEach((img) => {{
      img.addEventListener('click', () => {{
        lightboxImage.src = img.src;
        lightboxImage.alt = img.alt;
        lightbox.classList.add('open');
        lightbox.setAttribute('aria-hidden', 'false');
      }});
    }});
    lightbox.addEventListener('click', () => {{
      lightbox.classList.remove('open');
      lightbox.setAttribute('aria-hidden', 'true');
      lightboxImage.src = '';
    }});
  </script>
</body>
</html>
""",
        encoding="utf-8",
    )


def main() -> None:
    api_key()
    print(f"model={MODEL}")
    print(f"reference={REFERENCE_IMAGE if REFERENCE_IMAGE.exists() else 'missing'}")

    results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_to_variant = {executor.submit(generate_one, variant): variant for variant in VARIANTS}
        for future in concurrent.futures.as_completed(future_to_variant):
            item = future.result()
            results.append(item)
            print(f"{item['status']:7s} {item['id']} cost=${float(item.get('cost', 0)):.4f}")

    by_id = {item["id"]: item for item in results}
    ordered = [by_id[variant["id"]] for variant in VARIANTS]
    write_index(ordered)
    total_cost = sum(float(item.get("cost", 0) or 0) for item in ordered)
    print(f"wrote {ROOT / 'index.html'}")
    print(f"total_cost=${total_cost:.4f}")


if __name__ == "__main__":
    main()
