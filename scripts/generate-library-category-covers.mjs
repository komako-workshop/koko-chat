#!/usr/bin/env node
/**
 * 用 Nano Banana 2 (google/gemini-3.1-flash-image-preview) 给 Deeply 课程库
 * 9 个类目各生成一张 hero 封面图。
 *
 * 输出:
 *   .brand/library-category-covers/<id>.png       # 实际 PNG
 *   .brand/library-category-covers/index.html     # 拼一张 preview 页
 *   .brand/library-category-covers/meta.json      # 一次性 batch 的 prompt + cost
 *
 * 设计思路:
 *  - **不在图里画文字**:LLM 写中英文字常糊;UI 层叠类目名 + 副标题更可控
 *  - **暗色调**:跟 CATEGORY_STYLES 里的 colorStart 同色系,白底深字 UI
 *    叠上去对比强烈
 *  - **横版**:类目卡 hero 横向 banner,3:2 的比例
 *  - **去 AI 油画感**:cinematic、museum lighting、editorial 字样,避免那种
 *    fantasy 插画感
 *
 * Env:
 *   OPENROUTER_API_KEY   必填
 *
 * Usage:
 *   node scripts/generate-library-category-covers.mjs            # 全跑
 *   node scripts/generate-library-category-covers.mjs --only civ # 单类目
 *   node scripts/generate-library-category-covers.mjs --force    # 已有也重跑
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(REPO_ROOT, ".brand/library-category-covers");
const MODEL = "google/gemini-3.1-flash-image-preview";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("missing OPENROUTER_API_KEY");
  process.exit(1);
}

const argv = new Set(process.argv.slice(2));
const force = argv.has("--force");
const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === "--only");

// 9 个类目 + 各自的视觉 brief。
// brief 是中文写给自己看,prompt 是英文(模型对英文 prompt 更稳)。
const CATEGORIES = [
  {
    id: "history",
    name: "历史的镜像",
    desc: "古代 / 近现代 / 文明史",
    prompt: `Editorial-style cover art for a curated history bookshelf. \
A weathered marble bust of an ancient philosopher half-submerged in deep shadow, \
catching a single sliver of warm window light from the upper-left. \
Beside it, two heavy leather-bound antique tomes stacked with cracked gilt spines. \
Color palette: deep walnut, sepia, charcoal, with a faint dusty cream highlight. \
Cinematic museum lighting, shallow depth of field, fine grain like a Magnum photograph. \
Style: dramatic still life, like a Caravaggio painting reinterpreted for a modern book magazine. \
No text, no captions, no logos, no watermark. \
Composition leaves the lower-third of the frame in a dark, near-empty space for typography to be overlaid later. \
3:2 horizontal aspect.`
  },
  {
    id: "civ",
    name: "文明的逻辑",
    desc: "社会学 / 制度史 / 文化",
    prompt: `Editorial cover art for a "logic of civilization" bookshelf. \
An aerial cartography-style sketch of an imaginary ancient city's road grid \
fading into purple shadow, with faint architectural blueprint lines, faint river curve, \
and tiny gold dots representing settlements. \
Style: like an old hand-drawn atlas overlaid with elegant data-visualization, museum print quality. \
Color palette: deep aubergine, dusty violet, antique gold accents, deep ink-black. \
No text, no labels, no compass, no logos. \
Composition leaves the lower-third in dark near-empty space for typography overlay. \
3:2 horizontal aspect, soft warm grain.`
  },
  {
    id: "mind",
    name: "心智理论",
    desc: "心理学 / 认知科学 / 哲学",
    prompt: `Editorial cover art for a "theory of mind" bookshelf. \
A close-up of a single classical Greek-style sculpture head, profile, eyes closed in contemplation, \
inside the head a translucent overlay of faint neural pathways and softly glowing constellation-like nodes. \
Deep teal-and-charcoal palette with cool moonlit highlights and a single warm amber glow point near the temple. \
Style: half marble bust, half x-ray, museum quality, melancholic but precise. \
No text, no diagrams, no labels, no watermark. \
Composition leaves the lower-third dark and clean for typography overlay. \
3:2 horizontal aspect, fine photographic grain.`
  },
  {
    id: "wealth",
    name: "财富的逻辑",
    desc: "经济 / 投资 / 商业史",
    prompt: `Editorial cover art for a "logic of wealth" bookshelf. \
A still life of an aged hand-written accounting ledger open on a dark walnut desk, \
with a small stack of antique gold coins, a worn brass weighing scale, and a half-burnt candle casting warm side light. \
A faint stock-chart curve sketched in pencil along the page margin, almost invisible. \
Color palette: aged paper cream, brass / antique gold, deep coffee brown, ink black. \
Style: Dutch golden age still life crossed with a Wall Street Journal cover photo. \
No text, no numbers, no logos, no watermark. \
Composition leaves the lower-third near-empty and dark for typography overlay. \
3:2 horizontal aspect, soft natural grain.`
  },
  {
    id: "thought",
    name: "思想的深渊",
    desc: "哲学 / 政治思想 / 形而上学",
    prompt: `Editorial cover art for a "abyss of thought" philosophy bookshelf. \
A single dark spiral staircase descending into a deep navy-violet void, viewed from above, \
faint warm light from somewhere far below, with one or two dust motes floating in the light. \
On the top edge, a half-open ancient book lies on a stone floor, pages turned by an unseen wind. \
Color palette: indigo, deep slate-blue, ink violet, with a single warm candle-amber spot deep down. \
Style: Piranesi etching crossed with a Tarkovsky film still, contemplative and bottomless. \
No text, no symbols, no logos, no watermark. \
Composition leaves the lower-third in dark near-empty space for typography overlay. \
3:2 horizontal aspect, faint film grain.`
  },
  {
    id: "create",
    name: "创造与表达",
    desc: "文学 / 艺术 / 写作",
    prompt: `Editorial cover art for a "creation and expression" bookshelf. \
A half-finished oil painting on a wooden easel in a dim artist's studio, \
beside it an open hand-bound notebook with ink calligraphy strokes, a vintage fountain pen, \
and dried wildflowers in a small ceramic vase. Warm afternoon side light through a single tall window. \
Color palette: oxblood, dusty rose, warm cream, antique brass, ink black. \
Style: like a Vanity Fair feature spread on contemporary artists. \
Tactile, intimate, slightly imperfect. \
No text, no signature, no logos, no watermark. \
Composition leaves the lower-third clean and dark for typography overlay. \
3:2 horizontal aspect, fine grain.`
  },
  {
    id: "classic",
    name: "重读经典",
    desc: "传统典籍 / 史学原典 / 长青之作",
    prompt: `Editorial cover art for a "re-reading the classics" bookshelf. \
A small stack of three or four ancient hand-bound books with worn fabric covers and gilded edges, \
photographed from a low angle on a deep walnut library table. \
A single warm reading lamp lights the top book's spine; the rest fades into deep shadow. \
Faint outline of a globe and one quill pen in the dark corner. \
Color palette: rust-red leather, oxblood, deep mahogany, warm gold leaf, ink black. \
Style: like a Vogue Living library feature shot, intimate and reverent. \
No text on the spines, no logos, no watermark. \
Composition leaves the lower-third in dark near-empty space for typography overlay. \
3:2 horizontal aspect, fine warm grain.`
  },
  {
    id: "science",
    name: "科学的边界",
    desc: "数理 / 自然 / 跨学科",
    prompt: `Editorial cover art for a "frontier of science" bookshelf. \
A laboratory still life: an ornate brass antique astrolabe and a glass beaker holding a cluster \
of small dried botanical specimens, plus a single open notebook with faint pencil-drawn equations \
fading into the margins. Soft northern daylight from a high window, casting long quiet shadows. \
Color palette: deep moss green, olive, antique brass, soft eggshell, ink black. \
Style: like the Wellcome Collection's archive photography, scientific yet poetic. \
No legible text, no obvious formulas, no logos, no watermark. \
Composition leaves the lower-third in dark near-empty space for typography overlay. \
3:2 horizontal aspect, fine grain.`
  },
  {
    id: "stars",
    name: "人类群星",
    desc: "思想家 / 实业家 / 艺术家",
    prompt: `Editorial cover art for a "human constellations" bookshelf about great figures. \
A dark navy-warm-brown night sky filled with faint pinpoint stars, in the lower foreground a row of \
silhouette profile cameos of nameless figures (philosopher, scientist, artist) in classical relief style, \
unified by a faint constellation-line connecting them like a sky chart. \
Color palette: deep midnight navy, warm sepia, antique brass starlight, ink black. \
Style: a serious Smithsonian or New Yorker editorial illustration, contemplative not whimsical. \
No text, no names, no labels, no logos, no watermark. \
Composition leaves the lower-third in dark near-empty space for typography overlay. \
3:2 horizontal aspect, fine warm grain.`
  }
];

const SYSTEM_INSTRUCTION = `You are a senior editorial art director generating cover images for a curated book library.
Produce ONE image per request. Strictly follow the user's brief.
Key non-negotiables:
- NO TEXT, NO LETTERS, NO NUMBERS anywhere in the image.
- NO logos, no watermarks, no captions.
- Photographic / museum still-life realism preferred over fantasy illustration.
- Reserve the lower-third of the frame as dark, near-empty space (typography will be overlaid by the UI).
- 3:2 horizontal aspect.`;

async function generateOne(cat) {
  const body = {
    model: MODEL,
    modalities: ["image", "text"],
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: cat.prompt }
    ]
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://deeply.plus",
      "X-Title": "Deeply Library Category Covers"
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`);
  }
  const msg = json.choices?.[0]?.message;
  const url = msg?.images?.[0]?.image_url?.url;
  if (typeof url !== "string" || !url.startsWith("data:image/")) {
    throw new Error(`no image returned. content=${msg?.content ?? ""}`);
  }
  const commaIdx = url.indexOf(",");
  const base64 = url.slice(commaIdx + 1);
  const mimeMatch = url.slice(5, commaIdx).match(/^image\/([a-z]+)/i);
  const ext = (mimeMatch?.[1] ?? "png").toLowerCase();
  const buf = Buffer.from(base64, "base64");
  return {
    bytes: buf.length,
    ext,
    buf,
    cost: json.usage?.cost,
    usage: json.usage
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = onlyArg !== undefined
    ? CATEGORIES.filter((c) => c.id === onlyArg)
    : CATEGORIES;
  if (targets.length === 0) {
    console.error(`no category matches --only=${onlyArg}`);
    process.exit(1);
  }

  const meta = [];
  let totalCost = 0;
  let i = 0;
  // 并发 3,避免触发 openrouter / google 上游限速。
  const CONCURRENCY = 3;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= targets.length) return;
        const cat = targets[idx];
        const filename = `${cat.id}.png`;
        const outPath = path.join(OUT_DIR, filename);
        if (!force && fs.existsSync(outPath)) {
          console.log(`[skip]  ${cat.id} (already exists, use --force to regen)`);
          meta.push({ id: cat.id, name: cat.name, status: "skipped", filename });
          continue;
        }
        const t0 = Date.now();
        try {
          console.log(`[gen ] ${cat.id} (${cat.name}) ...`);
          const r = await generateOne(cat);
          fs.writeFileSync(outPath, r.buf);
          const dt = Date.now() - t0;
          totalCost += r.cost ?? 0;
          console.log(`[done] ${cat.id} ${r.bytes} bytes, $${(r.cost ?? 0).toFixed(4)}, ${dt}ms`);
          meta.push({
            id: cat.id,
            name: cat.name,
            desc: cat.desc,
            status: "ok",
            filename,
            bytes: r.bytes,
            cost: r.cost ?? 0,
            elapsedMs: dt,
            prompt: cat.prompt
          });
        } catch (err) {
          console.error(`[fail] ${cat.id}: ${err instanceof Error ? err.message : String(err)}`);
          meta.push({
            id: cat.id,
            name: cat.name,
            status: "failed",
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    })
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "meta.json"),
    JSON.stringify({ model: MODEL, totalCost, items: meta }, null, 2)
  );
  console.log(`\nbatch done. total cost: $${totalCost.toFixed(4)}`);

  // 拼 preview HTML
  const allCats = CATEGORIES;
  const cards = allCats
    .map((cat) => {
      const m = meta.find((x) => x.id === cat.id);
      const ok = m?.status === "ok" || (m?.status === "skipped" && fs.existsSync(path.join(OUT_DIR, `${cat.id}.png`)));
      const img = ok ? `<img src="${cat.id}.png?t=${Date.now()}" alt="${cat.name}" />` : `<div class="missing">尚未生成 / 失败</div>`;
      return `
  <article class="card">
    <div class="cover">${img}
      <div class="overlay">
        <h2>${cat.name}</h2>
        <p>${cat.desc}</p>
      </div>
    </div>
    <details class="prompt">
      <summary>prompt</summary>
      <pre>${cat.prompt.replace(/</g, "&lt;")}</pre>
    </details>
  </article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>Deeply Library — Category Cover Preview</title>
<style>
  :root { --bg: #F9F9F7; --ink: #1E293B; --ink2: #475569; --ink3: #94A3B8; --line: #E8E6E0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px 80px; background: var(--bg); color: var(--ink);
         font-family: -apple-system, "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
         line-height: 1.5; }
  header { max-width: 1200px; margin: 0 auto 32px; padding: 0 8px; }
  header h1 { margin: 0 0 8px; font-size: 28px; font-weight: 700; }
  header p { margin: 0; color: var(--ink2); font-size: 14px; }
  .grid { max-width: 1200px; margin: 0 auto; display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
          box-shadow: 0 4px 12px rgba(100,116,139,0.06); }
  .cover { position: relative; aspect-ratio: 3 / 2; background: #2C2A26; overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover .missing { display:flex; align-items:center; justify-content:center; height:100%; color:#aaa; font-size:14px; }
  .overlay { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 20px 18px;
             color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5);
             background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0)); }
  .overlay h2 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  .overlay p { margin: 0; font-size: 13px; opacity: 0.85; }
  .prompt { padding: 12px 16px 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink2); }
  .prompt summary { cursor: pointer; user-select: none; }
  .prompt pre { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 11px; line-height: 1.4; margin: 8px 0 0; color: var(--ink2); }
</style>
</head>
<body>
<header>
  <h1>Deeply Library — Category Cover Preview</h1>
  <p>9 个类目封面初版 (Nano Banana 2 / google/gemini-3.1-flash-image-preview)。展示叠加文字后的实际观感。点 prompt 折叠看每张图的提示词。</p>
</header>
<div class="grid">
${cards}
</div>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  console.log(`preview: file://${path.join(OUT_DIR, "index.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
