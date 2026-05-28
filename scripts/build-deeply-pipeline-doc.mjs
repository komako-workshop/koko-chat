#!/usr/bin/env node
/**
 * Build a self-contained HTML viewer that walks through Deeply's two-phase
 * research pipeline (Phase A research → Phase B outline) using the prompts
 * and real outputs from the most recent regression run.
 *
 * Usage:
 *   node scripts/build-deeply-pipeline-doc.mjs \
 *     [--prefix artifacts/deeply-research-test-2026-05-28T13-10-54-550Z] \
 *     [--out docs/dev/deeply-research-pipeline.html]
 *
 * Defaults pick up the regression run from this conversation.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PREFIX =
  "artifacts/deeply-research-test-2026-05-28T13-10-54-550Z";
const DEFAULT_OUT = "docs/dev/deeply-research-pipeline.html";

const args = parseArgs(process.argv.slice(2));
const prefix = resolve(process.cwd(), args.prefix ?? DEFAULT_PREFIX);
const outPath = resolve(process.cwd(), args.out ?? DEFAULT_OUT);

const phaseAPrompt = readFileSync(`${prefix}.phase-a.prompt.txt`, "utf8");
const phaseANotesText = readFileSync(`${prefix}.phase-a.notes.json`, "utf8");
const phaseANotes = JSON.parse(phaseANotesText);
const phaseARaw = readFileSync(`${prefix}.phase-a.raw.txt`, "utf8");
const phaseBPrompt = readFileSync(`${prefix}.phase-b.prompt.txt`, "utf8");
const phaseBRaw = readFileSync(`${prefix}.phase-b.raw.txt`, "utf8");

const outlineMatch = phaseBRaw.match(
  /```koko\.deeply\.research\.outline\s*([\s\S]+?)```/
);
if (!outlineMatch) {
  throw new Error("Phase B outline fenced block missing from raw text");
}
const phaseBOutline = JSON.parse(outlineMatch[1].trim());

const data = {
  topic: phaseANotes.topic,
  promptA: phaseAPrompt,
  promptB: phaseBPrompt,
  notes: phaseANotes,
  rawA: phaseARaw,
  outline: phaseBOutline,
  rawB: phaseBRaw,
  stats: {
    sourcesCount: phaseANotes.sources.length,
    synthesisChars: phaseANotes.synthesis.length,
    sectionsCount: phaseBOutline.sections.length,
    // 5-28 跑出来的真实耗时,直接 hardcode 在脚本里
    phaseASeconds: 75,
    phaseBSeconds: 60
  }
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderHtml(data), "utf8");
console.log(`wrote ${outPath} (${(JSON.stringify(data).length / 1024).toFixed(1)} KB payload)`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--prefix") out.prefix = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
  }
  return out;
}

function renderHtml(data) {
  // Embed every text/json artifact via JSON.stringify so we don't have to
  // hand-escape angle brackets, backticks, or curly braces.
  const payload = JSON.stringify(data);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Deeply 调研课程 · 两阶段推理流程</title>
<style>
  :root {
    --bg: #0e0d12;
    --panel: #18171f;
    --panel-2: #1f1d28;
    --line: #2a2735;
    --text: #ece8d9;
    --text-dim: #aaa294;
    --orange: #ff8c2a;
    --orange-soft: rgba(255,140,42,0.16);
    --green: #67e0a3;
    --red: #ff7a7a;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  }
  html, body { background: var(--bg); color: var(--text); font-family: var(--sans); }
  body { margin: 0; line-height: 1.65; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 56px 32px 96px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 32px; margin-bottom: 40px; }
  .eyebrow { color: var(--orange); font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 12px; font-weight: 600; }
  h1 { font-size: 32px; margin: 0 0 14px; line-height: 1.25; font-weight: 800; }
  .topic { color: var(--text-dim); font-size: 17px; margin: 0; }
  .topic code { background: var(--panel); padding: 4px 10px; border-radius: 6px; color: var(--text); font-family: var(--mono); font-size: 14.5px; }

  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 28px 0 0; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .stat-label { font-size: 11.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px; }
  .stat-value { font-size: 22px; font-weight: 700; color: var(--orange); font-family: var(--mono); }
  .stat-unit { font-size: 13px; color: var(--text-dim); margin-left: 4px; font-weight: 500; font-family: var(--sans); }

  .pipeline { display: flex; flex-direction: column; gap: 16px; margin: 40px 0 56px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px 22px; display: flex; gap: 16px; align-items: center; }
  .step-num { width: 30px; height: 30px; border-radius: 999px; background: var(--orange-soft); color: var(--orange); display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-family: var(--mono); }
  .step-text { font-size: 15px; }
  .step-text strong { color: var(--orange); }
  .step-arrow { color: var(--text-dim); text-align: center; font-size: 14px; margin: -8px 0; padding-left: 46px; }

  .phase { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; margin-bottom: 32px; overflow: hidden; }
  .phase-head { padding: 22px 26px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; }
  .phase-title { font-size: 20px; font-weight: 700; margin: 0; }
  .phase-title .badge { background: var(--orange-soft); color: var(--orange); font-size: 12px; padding: 3px 10px; border-radius: 999px; font-weight: 600; margin-right: 10px; vertical-align: middle; letter-spacing: 0.05em; }
  .phase-meta { color: var(--text-dim); font-size: 13.5px; font-family: var(--mono); }
  .phase-meta strong { color: var(--text); }

  .sub { padding: 22px 26px; border-bottom: 1px solid var(--line); }
  .sub:last-child { border-bottom: none; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); margin: 0 0 14px; font-weight: 700; }

  pre {
    background: #0a0910; border: 1px solid var(--line); border-radius: 10px;
    padding: 18px 20px; overflow-x: auto; font-family: var(--mono); font-size: 13px;
    line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word;
    margin: 0;
  }
  details > summary { cursor: pointer; padding: 10px 0; color: var(--text-dim); font-size: 13.5px; user-select: none; }
  details > summary:hover { color: var(--orange); }
  details[open] > summary { color: var(--orange); margin-bottom: 12px; }

  .synthesis { background: var(--panel-2); border-left: 3px solid var(--orange); padding: 16px 20px; border-radius: 0 8px 8px 0; font-size: 14.5px; color: var(--text); }

  table.sources { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  table.sources th, table.sources td { padding: 10px 12px; vertical-align: top; border-bottom: 1px solid var(--line); text-align: left; }
  table.sources th { font-weight: 600; color: var(--text-dim); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em; }
  table.sources tr:last-child td { border-bottom: none; }
  table.sources td:first-child { color: var(--text-dim); font-family: var(--mono); width: 30px; }
  .stance { font-family: var(--mono); font-size: 11.5px; padding: 2px 8px; border-radius: 4px; display: inline-block; }
  .stance.primary { background: rgba(103,224,163,0.14); color: var(--green); }
  .stance.counterpoint { background: rgba(255,122,122,0.16); color: var(--red); }
  .stance.background { background: rgba(170,162,148,0.16); color: var(--text-dim); }
  .src-title { color: var(--text); font-weight: 500; }
  .src-url { color: var(--text-dim); font-size: 12px; font-family: var(--mono); word-break: break-all; }
  .src-url a { color: var(--text-dim); text-decoration: none; border-bottom: 1px dashed transparent; }
  .src-url a:hover { color: var(--orange); border-bottom-color: var(--orange); }
  .src-note { color: var(--text-dim); font-size: 13px; margin-top: 4px; line-height: 1.55; }

  .outline-section { background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; }
  .outline-section h4 { font-size: 16px; margin: 0 0 10px; color: var(--orange); }
  .outline-section h4 .idx { color: var(--text-dim); font-family: var(--mono); margin-right: 8px; font-size: 14px; }
  .outline-section ul { margin: 0; padding-left: 18px; }
  .outline-section li { font-size: 13.5px; color: var(--text-dim); margin-bottom: 4px; }
  .outline-section li .stance { margin-right: 8px; }

  .intro { font-size: 15px; padding: 18px 22px; background: var(--panel-2); border-radius: 10px; border-left: 3px solid var(--orange); color: var(--text); }

  .callout { background: var(--orange-soft); border: 1px solid rgba(255,140,42,0.3); border-radius: 10px; padding: 16px 20px; margin: 16px 0; font-size: 14px; }
  .callout strong { color: var(--orange); }

  footer { color: var(--text-dim); font-size: 12.5px; margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); text-align: center; }
  footer code { font-family: var(--mono); color: var(--text); }

  @media (max-width: 720px) {
    .wrap { padding: 36px 18px 72px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    h1 { font-size: 24px; }
    .phase-head { padding: 18px 18px; }
    .sub { padding: 18px 18px; }
  }
</style>
</head>
<body>
<div class="wrap">

<header>
  <p class="eyebrow">Deeply · 深度调研课程</p>
  <h1>两阶段推理流程</h1>
  <p class="topic">本次跑题:<code id="topic"></code></p>
  <div class="stats" id="stats"></div>
</header>

<section>
  <h3>整体管线</h3>
  <div class="pipeline">
    <div class="step"><div class="step-num">1</div><div class="step-text">客户端把用户的可见输入(<code>请围绕「...」做一份深度调研课程</code>)包成 <strong>Phase A kickoff prompt</strong>(下面 §A)→ <code>chat.send</code> 给 deeply agent。</div></div>
    <div class="step-arrow">↓</div>
    <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Phase A · Deeply agent 一次 run</strong>:agent 在同一 turn 内多次 <code>web_search</code> / <code>web_fetch</code>,边搜边输出中文 prose(<code>〔KP〕</code> 分段),最后 emit 一个 <code>koko.deeply.research.notes</code> fenced block(扁平 sources + synthesis)。</div></div>
    <div class="step-arrow">↓ 客户端 transformer 检测到 notes block,剪掉 raw JSON,显示过桥消息,触发 Phase B</div>
    <div class="step"><div class="step-num">3</div><div class="step-text"><strong>Phase B · 单次 <code>inferOnce</code></strong>(同一 deeply agent,新 oneshot session,无 web 工具):用 Phase A 的 synthesis + sources 拼一个新 prompt(下面 §B),让模型只做"拆 section + 分配 sources + 写 introduction"。输出 <code>koko.deeply.research.outline</code> JSON。</div></div>
    <div class="step-arrow">↓</div>
    <div class="step"><div class="step-num">4</div><div class="step-text">客户端解析 outline JSON → 写入 course 存储 → bootstrap 切 <code>ready</code> → 用户进入课程页。</div></div>
  </div>
  <div class="callout">
    <strong>为什么拆两阶段:</strong>之前是"一气呵成"的 prompt:同一 turn 既要调工具、又要写 prose、又要按严格 schema 拆 section + 每节 sources。
    回归测试里出现过 <code>toolCallCount=0</code> 但 sources 数组仍然塞满模型从训练数据猜的 URL —— 经典 attention split 失败。
    拆开后 Phase A 只关心"真的搜到了什么",Phase B 只关心"拆 schema",两个目标各自不再争抢 token 预算。
  </div>
</section>

<section class="phase">
  <div class="phase-head">
    <h2 class="phase-title"><span class="badge">§A</span>Phase A · Agent 调研轮</h2>
    <div class="phase-meta">用时 <strong id="meta-a-time"></strong>s · <code>chat.send</code> 至 <code>deeply</code> agent,allowlist 含 web_search / web_fetch</div>
  </div>

  <div class="sub">
    <h3>完整 Prompt(host 注入)</h3>
    <pre id="prompt-a"></pre>
  </div>

  <div class="sub">
    <h3>实际输出 · synthesis(<span id="synth-chars"></span> 字)</h3>
    <div class="synthesis" id="synth"></div>
  </div>

  <div class="sub">
    <h3>实际输出 · sources(<span id="srcs-count"></span> 条)</h3>
    <table class="sources" id="srcs"><thead><tr><th>#</th><th>标题 / URL</th><th>stance</th></tr></thead><tbody></tbody></table>
  </div>

  <div class="sub">
    <details>
      <summary>查看完整 raw agent 回复(<span id="raw-a-chars"></span> chars · 含 prose + fenced block)</summary>
      <pre id="raw-a"></pre>
    </details>
  </div>
</section>

<section class="phase">
  <div class="phase-head">
    <h2 class="phase-title"><span class="badge">§B</span>Phase B · 单次 inferOnce</h2>
    <div class="phase-meta">用时 <strong id="meta-b-time"></strong>s · 同 agent,新 oneshot session,无 web 工具</div>
  </div>

  <div class="sub">
    <h3>完整 Prompt(客户端拼装,inline Phase A 产物)</h3>
    <pre id="prompt-b"></pre>
  </div>

  <div class="sub">
    <h3>实际输出 · 课程介绍 + 目录(<span id="sec-count"></span> 节)</h3>
    <h4 id="course-title" style="font-size:18px;margin:0 0 12px;color:var(--orange);"></h4>
    <div class="intro" id="intro"></div>
    <div id="outline-sections" style="margin-top:18px;"></div>
  </div>

  <div class="sub">
    <details>
      <summary>查看完整 outline JSON</summary>
      <pre id="outline-json"></pre>
    </details>
    <details>
      <summary>查看完整 raw inferOnce 回复</summary>
      <pre id="raw-b"></pre>
    </details>
  </div>
</section>

<section>
  <h3>客户端代码路径速查</h3>
  <pre>miniapps/deeply/mobile/
├── persona.ts
│   ├── buildResearchKickoffPrompt(...)            ← Phase A prompt
│   └── buildResearchOutlineFromNotesPrompt(...)   ← Phase B prompt
├── parseResearchNotes.ts                          ← 解析 Phase A notes block
├── parseResearchOutline.ts                        ← 解析 Phase B outline block
├── inferResearchOutlineFromNotes.ts               ← Phase B inferOnce 封装
├── courseSession.ts
│   ├── applyResearchNotesAndRunPhaseB(...)        ← 缓存 notes + fire Phase B
│   ├── runResearchPhaseBOutline(...)              ← Phase B 后台 runner
│   └── applyResearchOutlineToCourse(...)          ← 写 outline + sources storage + ready
└── index.ts
    └── transformDeeplyCourseAgentResponse(...)    ← 识别 notes block,触发 Phase B</pre>
</section>

<footer>
  artifacts prefix · <code id="prefix"></code><br />
  生成于 <span id="now"></span> · 数据来自 <code>scripts/regression-deeply-research.mjs</code> 实跑产物
</footer>

</div>

<script id="payload" type="application/json">${escapeJsonForScriptTag(payload)}</script>
<script>
  const data = JSON.parse(document.getElementById("payload").textContent);

  document.getElementById("topic").textContent = data.topic;

  const stats = [
    { label: "Phase A 用时", value: data.stats.phaseASeconds, unit: "s" },
    { label: "Phase A · sources", value: data.stats.sourcesCount, unit: "" },
    { label: "Phase A · synthesis", value: data.stats.synthesisChars, unit: "字" },
    { label: "Phase B 用时", value: data.stats.phaseBSeconds, unit: "s" },
    { label: "Phase B · sections", value: data.stats.sectionsCount, unit: "节" }
  ];
  document.getElementById("stats").innerHTML = stats
    .map((s) => '<div class="stat"><div class="stat-label">' + s.label + '</div><div class="stat-value">' + s.value + '<span class="stat-unit">' + s.unit + '</span></div></div>')
    .join("");
  document.getElementById("meta-a-time").textContent = data.stats.phaseASeconds;
  document.getElementById("meta-b-time").textContent = data.stats.phaseBSeconds;

  document.getElementById("prompt-a").textContent = data.promptA;
  document.getElementById("prompt-b").textContent = data.promptB;

  document.getElementById("synth").textContent = data.notes.synthesis;
  document.getElementById("synth-chars").textContent = data.notes.synthesis.length;

  document.getElementById("srcs-count").textContent = data.notes.sources.length;
  const srcsBody = document.querySelector("#srcs tbody");
  data.notes.sources.forEach((s, i) => {
    const tr = document.createElement("tr");
    const idx = document.createElement("td"); idx.textContent = (i + 1).toString();
    const main = document.createElement("td");
    const t = document.createElement("div"); t.className = "src-title"; t.textContent = s.title;
    const u = document.createElement("div"); u.className = "src-url";
    const a = document.createElement("a"); a.href = s.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.url;
    u.appendChild(a);
    main.appendChild(t); main.appendChild(u);
    if (s.note || s.snippet) {
      const note = document.createElement("div"); note.className = "src-note"; note.textContent = s.note || s.snippet;
      main.appendChild(note);
    }
    const stance = document.createElement("td");
    const span = document.createElement("span"); span.className = "stance " + s.stance; span.textContent = s.stance;
    stance.appendChild(span);
    tr.appendChild(idx); tr.appendChild(main); tr.appendChild(stance);
    srcsBody.appendChild(tr);
  });

  document.getElementById("raw-a").textContent = data.rawA;
  document.getElementById("raw-a-chars").textContent = data.rawA.length;

  document.getElementById("course-title").textContent = data.outline.courseTitle;
  document.getElementById("intro").textContent = data.outline.introduction;
  document.getElementById("sec-count").textContent = data.outline.sections.length;

  const secContainer = document.getElementById("outline-sections");
  data.outline.sections.forEach((sec) => {
    const block = document.createElement("div"); block.className = "outline-section";
    const h = document.createElement("h4");
    h.innerHTML = '<span class="idx">第' + sec.index + '节</span>' + escapeHtml(sec.title);
    block.appendChild(h);
    const ul = document.createElement("ul");
    (sec.sources || []).forEach((src) => {
      const li = document.createElement("li");
      const stance = document.createElement("span"); stance.className = "stance " + src.stance; stance.textContent = src.stance;
      li.appendChild(stance);
      const a = document.createElement("a"); a.href = src.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = src.title;
      a.style.color = "var(--text)"; a.style.textDecoration = "none";
      li.appendChild(a);
      if (src.snippet) {
        const note = document.createElement("div"); note.style.color = "var(--text-dim)"; note.style.fontSize = "12.5px"; note.style.marginTop = "2px"; note.style.marginLeft = "0"; note.textContent = src.snippet;
        li.appendChild(note);
      }
      ul.appendChild(li);
    });
    block.appendChild(ul);
    secContainer.appendChild(block);
  });

  document.getElementById("outline-json").textContent = JSON.stringify(data.outline, null, 2);
  document.getElementById("raw-b").textContent = data.rawB;

  document.getElementById("prefix").textContent = ${JSON.stringify(prefix)};
  document.getElementById("now").textContent = new Date().toLocaleString("zh-CN");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
</script>

</body>
</html>
`;
}

/**
 * Escape a JSON string so it can sit safely inside a <script type="application/json"> tag.
 * The only sequence the HTML parser ever pulls out of such a tag is "</script", and on
 * old browsers also "<!--" / "-->", so we just neutralise those.
 */
function escapeJsonForScriptTag(s) {
  return s
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--")
    .replace(/-->/g, "--\\>");
}
