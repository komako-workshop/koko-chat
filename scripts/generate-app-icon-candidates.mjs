#!/usr/bin/env node
/**
 * 用 Nano Banana 2 (google/gemini-3.1-flash-image-preview) 批量生成 KokoChat
 * app icon 候选方案 —— 第三批: 围绕用户选定的"白鹭立姿"做 10 个差异化 iteration。
 *
 * 设计主线锁死:
 *   - 白鹭 (Little Egret) — 长 S 颈 / 长喙 / 细长黑腿 / 头后细长饰羽
 *   - 黑墨手绘线条,松弛草稿感,内部不填色
 *   - 红色作为唯一(或主要)accent
 *   - 大量白底留白
 *   - 小点眼 + 极淡粉色腮红
 *
 * 只在这些维度上做 10 个 variation:
 *   - 姿态 (回眸 / 正面 / 仰首 / 团子 / 行走 …)
 *   - 红 accent 形式 (颈丝带 / 衔红信 / 衔山茶 / 长围巾 / 朱印 …)
 *   - 表情 (点眼 / 闭眼微笑 …)
 *
 * 参考图:
 *   .brand/app-icon-candidates/_reference.png        mood 参考(白发狐耳少女速写)
 *   .brand/app-icon-candidates/_reference-bird.png   主角形态参考(用户选定的白鹭 = 原 s01)
 *
 * 输出:
 *   .brand/app-icon-candidates/<id>.png      实际 PNG
 *   .brand/app-icon-candidates/meta.json     prompt + cost
 *   .brand/app-icon-candidates/index.html    网页对比页(手写,见同目录)
 *
 * Env:
 *   OPENROUTER_API_KEY   必填
 *
 * Usage:
 *   node scripts/generate-app-icon-candidates.mjs           # 全跑
 *   node scripts/generate-app-icon-candidates.mjs --only look-back
 *   node scripts/generate-app-icon-candidates.mjs --force   # 已有也重跑
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(REPO_ROOT, ".brand/app-icon-candidates");
const REF_MOOD_PATH = path.join(OUT_DIR, "_reference.png");
const REF_BIRD_PATH = path.join(OUT_DIR, "_reference-bird.png");
const MODEL = "google/gemini-3.1-flash-image-preview";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("missing OPENROUTER_API_KEY");
  process.exit(1);
}
for (const p of [REF_MOOD_PATH, REF_BIRD_PATH]) {
  if (!fs.existsSync(p)) {
    console.error(`missing reference image: ${p}`);
    process.exit(1);
  }
}

const argv = new Set(process.argv.slice(2));
const force = argv.has("--force");
const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === "--only");

const REFERENCE_NOTE = `\
Two reference images are attached.

IMAGE 1 (mood reference): A pixiv-style anime sketch — white background, hand-drawn \
black ink outlines, selective red accents (red ribbon bow, red blushy cheeks, red \
handwritten text), deliberate negative space. Use this for the OVERALL MOOD and \
PALETTE — "red + white + black ink + restrained + high-taste sketchbook".

IMAGE 2 (bird form reference): A previously generated KokoChat app icon candidate \
showing the EXACT bird species and drawing style we have LOCKED IN — a slender \
LITTLE EGRET with a long S-curved neck, long pointed dark beak, long thin dark \
legs, 1-2 thin breeding plumes drifting off the back of the head, tiny round dot \
eyes, very soft pink blushy cheek smudges, drawn in loose confident black ink \
lines with NO interior shading, body left pure white, on a clean white \
background. THIS IS THE BIRD WE ARE DRAWING.

The new image MUST keep all of: species (little egret), linework feel (loose \
hand-drawn black ink, sketchbook energy, no shading), body interior (pure white, \
no fill), beak (long pointed dark), legs (long thin dark), head plumes (1-2 thin \
drifting backward), eyes (tiny dot or soft closed curve), cheeks (very small \
restrained pink blush), and overall negative-space-rich elegance.

Do NOT redesign the bird. Do NOT change species. Do NOT fill the body with color. \
Only change the POSE / ACCESSORY / EXPRESSION exactly as the variant brief \
specifies below.`;

const SHARED_NEGATIVE = `\
NO Pixar 3D, NO glossy gradients, NO chibi round-ball bird, NO airbrushed \
shading, NO photoreal, NO over-rendered, NO solid color fill on the bird's \
body, NO different bird species (must stay a little egret), NO text, NO \
letters, NO numbers, NO watermark, NO logo. The aesthetic must feel hand-drawn, \
editorial, restrained, like an indie Japanese illustrator's sketchbook page.`;

const BIRD_LOCK = `\
The protagonist is the SAME LITTLE EGRET as in IMAGE 2 — slender body, long \
S-curved neck, long pointed dark beak, long thin dark legs, 1-2 thin breeding \
plumes drifting backward off the head, tiny round dot eyes, very soft pink \
blushy round cheek smudges (small and restrained). Drawn in HAND-DRAWN BLACK \
INK OUTLINE with loose confident sketchbook strokes, body interior stays \
PURE WHITE (no shading, no fill). Background: pure clean white (#FFFFFF) \
with generous negative space.`;

const VARIANTS = [
  {
    id: "e01-look-back",
    label: "回眸",
    note: "白鹭站立 + 头扭回身后,'你来了?' 的瞬间。最适合 chat icon 的'等你说话'暗示。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands centered in the frame with its body facing 3/4 to the \
right, but its head and neck are TURNED BACK looking over its own shoulder \
toward the upper-left — a graceful "look back" pose, the long neck forming a \
deep elegant curve. The breeding plumes drift backward across the curve. The \
bird occupies about 70% of canvas height, centered with generous margins. \
The ONLY color in the image: a single VIVID red (#E63946) ribbon bow tied \
loosely high on the neck (same red as the mood reference). ${SHARED_NEGATIVE}`
  },
  {
    id: "e02-front-symmetric",
    label: "正面对称",
    note: "完全正面双脚站立,左右对称构图。最 brand mark 感,小尺寸最稳。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands FRONT-FACING directly toward the viewer (NOT a 3/4 \
view), head held straight forward, the long pointed beak pointing slightly \
down, both thin legs planted side by side and the overall silhouette is \
LEFT-RIGHT SYMMETRIC for a balanced brand-mark feeling. The breeding plumes \
drift symmetrically to both sides. The bird occupies about 75% of canvas \
height, perfectly centered with equal margins on all four sides. The ONLY \
color: a single VIVID red (#E63946) ribbon bow tied at the front of the long \
neck, symmetric. ${SHARED_NEGATIVE}`
  },
  {
    id: "e03-skyward",
    label: "仰首",
    note: "颈向上仰,喙指天,丝带尾巴垂下。最有'抬头 / 期待'感。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands in profile but lifts its long neck STRAIGHT UPWARD, \
beak pointing toward the upper sky, throat exposed in a long elegant vertical \
line. Both thin legs planted on the ground. The breeding plumes on the head \
drift softly backward. The bird occupies about 80% of canvas height (tall \
vertical silhouette), centered. The ONLY color: a single VIVID red (#E63946) \
ribbon bow tied midway down the long neck, with two thin ribbon tails hanging \
straight down gently from the bow. ${SHARED_NEGATIVE}`
  },
  {
    id: "e04-resting-curl",
    label: "团子休栖",
    note: "颈缩起来,身体像个白团子(但仍是涉禽不是 chibi)。安静温柔。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret is RESTING — its long neck is folded back and TUCKED DOWN \
into the shoulders, so the silhouette becomes a compact rounded teardrop \
shape, with only the head, the long pointed beak, and the breeding plumes \
peeking out above the puffed-up body. The two thin legs are still clearly \
visible standing close together below the body. The bird occupies about 65% \
of canvas, centered with generous margins. This is a quiet resting moment, \
but the bird MUST still clearly read as a LITTLE EGRET (long pointed beak, \
thin dark legs, breeding plumes) — NOT a chibi round chick. The ONLY color: \
a single VIVID red (#E63946) ribbon bow peeking out from the tucked-in neck \
area near the chest. ${SHARED_NEGATIVE}`
  },
  {
    id: "e05-walking",
    label: "漫步",
    note: "侧身走,抬一只长腿向前,丝带尾巴在风里飘。动态感最强。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret is WALKING in profile, body facing right — one long thin leg \
planted on the ground, the OTHER LEG LIFTED FORWARD mid-step (knee bent, foot \
hovering above the ground). The long neck holds an elegant S curve, beak \
pointed forward. The breeding plumes drift slightly backward suggesting \
forward motion. The bird occupies about 70% of canvas, centered horizontally \
with the lifted leg creating asymmetric energy. The ONLY color: a single VIVID \
red (#E63946) ribbon bow on the neck, with two thin ribbon tails fluttering \
backward in the motion. ${SHARED_NEGATIVE}`
  },
  {
    id: "e06-red-letter",
    label: "衔红信",
    note: "嘴里叼一封小红色信件 — 最直接的 chat app 隐喻。无颈部丝带,信件是唯一红。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands in 3/4 view, very similar to the bird reference image. \
KEY DIFFERENCES: (1) there is NO ribbon on the bird's neck; (2) the egret \
HOLDS A SMALL FOLDED LETTER / MINI ENVELOPE GENTLY IN THE TIP OF ITS LONG \
BEAK — a small flat rectangular shape in VIVID red (#E63946), drawn with the \
same loose hand-drawn ink linework, dangling slightly downward from the beak \
tip. The red letter is the ONLY color in the entire image. Composition \
emphasizes the elegant line from neck → beak → letter, like a delicate \
messenger bird delivering a love letter. The bird occupies about 70% of canvas \
height, centered. ${SHARED_NEGATIVE}`
  },
  {
    id: "e07-camellia-branch",
    label: "衔山茶枝",
    note: "嘴里叼一根短枝,顶端一朵红山茶。最东方花鸟画感,单色红。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands in 3/4 view, very similar to the bird reference image. \
KEY DIFFERENCES: (1) there is NO ribbon on the bird's neck; (2) the egret \
HOLDS A SHORT THIN DARK INK BRANCH GENTLY IN ITS LONG BEAK, and at the far \
tip of the branch blooms ONE SINGLE small stylized red CAMELLIA flower in \
deep crimson (#D2222D), with 1-2 tiny dark hand-drawn ink leaves at the base \
of the flower. The camellia is the ONLY saturated color in the image. \
Composition has the restrained energy of an Edo-period kachoga (bird-and- \
flower) print, but rendered with the same loose modern anime ink sketch \
linework. The bird occupies about 65% of canvas, centered. ${SHARED_NEGATIVE}`
  },
  {
    id: "e08-red-scarf-flow",
    label: "红围巾飘扬",
    note: "颈部丝带升级为长红围巾,在风里飘起一段。最帅气最动态,红色面积最大。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands tall, body in 3/4 view, head slightly turned forward. \
KEY DIFFERENCE: instead of a small ribbon bow, the egret wears a LONG VIVID \
RED (#E63946) SCARF wrapped once around the long neck, with one long flowing \
tail of the scarf BILLOWING SIDEWAYS BEHIND THE BIRD in the wind — a sweeping \
loose red ribbon shape that fills part of the negative space behind and \
beside the body, like a calligraphy stroke. The scarf is the only color. The \
bird occupies about 70% of canvas; the scarf trail extends roughly another \
15% of canvas width to one side. ${SHARED_NEGATIVE}`
  },
  {
    id: "e09-closed-smile",
    label: "闭眸微笑",
    note: "站姿同 reference,只把眼睛改成 '^' 闭眼弧。最温柔最满足。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands in 3/4 view, EXACTLY like the bird reference image. \
KEY DIFFERENCE: the eye is drawn as a SOFT CLOSED-EYE CURVE (a gentle "^" \
arc, like a happy / content / smiling expression in anime — eyelashes \
softly closed), not an open dot eye. The expression should read warm, calm, \
slightly smiling. The pink blushy cheek can be a touch more visible (still \
small and restrained) to support the soft contented mood. The ONLY color: a \
single VIVID red (#E63946) ribbon bow on the neck, same as the bird \
reference. The bird occupies about 70% of canvas, centered. ${SHARED_NEGATIVE}`
  },
  {
    id: "e10-foot-seal",
    label: "脚边朱印",
    note: "鸟站立 + 脚旁地上一个小红色无字 hanko 圆。无颈部丝带,只朱印一处红。",
    prompt: `Square 1024x1024 app icon. ${BIRD_LOCK} \
POSE: The egret stands in 3/4 view, very similar to the bird reference image. \
KEY DIFFERENCES: (1) there is NO ribbon on the bird's neck — the neck is \
completely bare; (2) just beside the bird's feet, in the lower-right area \
of the frame near the ground line, there is ONE SMALL HAND-STAMPED RED \
(#D2222D) SEAL — a small slightly-imperfect solid red circle about 14% of \
canvas width, like a Japanese hanko ink stamp pressed onto the white paper \
next to the bird. The seal is solid flat red with subtle uneven ink-bleed \
edges. NO characters / letters / numbers inside the seal — it stays as a \
pure abstract red disc (the artist's signature mark). The seal is the ONLY \
color in the image. The bird occupies about 65% of canvas, slightly left of \
center to leave breathing space for the seal in the lower-right. \
${SHARED_NEGATIVE}`
  }
];

const refMoodBuf = fs.readFileSync(REF_MOOD_PATH);
const refMoodDataUrl = `data:image/png;base64,${refMoodBuf.toString("base64")}`;
const refBirdBuf = fs.readFileSync(REF_BIRD_PATH);
const refBirdDataUrl = `data:image/png;base64,${refBirdBuf.toString("base64")}`;

const SYSTEM_INSTRUCTION = `You are a senior art director generating a CANDIDATE app icon image for a mobile app named KokoChat.
Strict rules:
- Output ONE single image per request.
- The image MUST be a PERFECT 1:1 SQUARE composition designed for use as an iOS / Android app icon.
- The subject must be centered with adequate margins on all sides so the icon survives Android adaptive-icon masking (the outermost ~12% of the canvas may be cropped to a circle).
- The image MUST CONTAIN NO TEXT, NO LETTERS, NO NUMBERS, NO WATERMARK, NO LOGO of any kind.
- Strictly follow the user's brief AND both attached reference images — image 1 sets the mood / palette, image 2 locks in the exact bird species, linework style, and character details. DO NOT redesign the bird; only the pose / accessory / expression changes per variant.`;

async function generateOne(variant) {
  const userContent = [
    { type: "text", text: `${REFERENCE_NOTE}\n\n--- VARIANT BRIEF (${variant.label}) ---\n${variant.prompt}` },
    { type: "image_url", image_url: { url: refMoodDataUrl } },
    { type: "image_url", image_url: { url: refBirdDataUrl } }
  ];
  const body = {
    model: MODEL,
    modalities: ["image", "text"],
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: userContent }
    ]
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kokochat.app",
      "X-Title": "KokoChat App Icon Candidates"
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
    throw new Error(`no image returned. content=${String(msg?.content ?? "")}`);
  }
  const commaIdx = url.indexOf(",");
  const base64 = url.slice(commaIdx + 1);
  const buf = Buffer.from(base64, "base64");
  return { buf, bytes: buf.length, cost: json.usage?.cost, usage: json.usage };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = onlyArg !== undefined
    ? VARIANTS.filter((v) => v.id === onlyArg || v.id.includes(onlyArg))
    : VARIANTS;
  if (targets.length === 0) {
    console.error(`no variant matches --only=${onlyArg}`);
    process.exit(1);
  }

  const meta = [];
  let totalCost = 0;
  let i = 0;
  const CONCURRENCY = 3;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= targets.length) return;
        const v = targets[idx];
        const filename = `${v.id}.png`;
        const outPath = path.join(OUT_DIR, filename);
        if (!force && fs.existsSync(outPath)) {
          console.log(`[skip] ${v.id} (exists, use --force to regen)`);
          meta.push({ ...v, status: "skipped", filename });
          continue;
        }
        const t0 = Date.now();
        try {
          console.log(`[gen ] ${v.id} (${v.label}) ...`);
          const r = await generateOne(v);
          fs.writeFileSync(outPath, r.buf);
          const dt = Date.now() - t0;
          totalCost += r.cost ?? 0;
          console.log(`[done] ${v.id} ${r.bytes}B  $${(r.cost ?? 0).toFixed(4)}  ${dt}ms`);
          meta.push({
            ...v,
            status: "ok",
            filename,
            bytes: r.bytes,
            cost: r.cost ?? 0,
            elapsedMs: dt
          });
        } catch (err) {
          console.error(`[fail] ${v.id}: ${err instanceof Error ? err.message : String(err)}`);
          meta.push({ ...v, status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      }
    })
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "meta.json"),
    JSON.stringify(
      {
        model: MODEL,
        generatedAt: new Date().toISOString(),
        totalCost,
        items: meta
      },
      null,
      2
    )
  );
  console.log(`\nbatch done. total cost: $${totalCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
