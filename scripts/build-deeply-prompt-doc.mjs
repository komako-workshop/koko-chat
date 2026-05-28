#!/usr/bin/env node
/**
 * Render the *actual* Chinese prompts KokoChat injects for a Deeply research
 * course into a single self-contained HTML page, so we can eyeball exactly
 * what the model sees.
 *
 * Pulls the real builders straight from persona.ts (no external imports in
 * that file), so the page never drifts from the shipped prompt.
 *
 * Run with Node's TS type-stripping:
 *   node --experimental-strip-types scripts/build-deeply-prompt-doc.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const persona = await import(
  resolve(REPO, "miniapps/deeply/mobile/persona.ts")
);

const TOPIC = "2026 年一二级市场的投资大师们怎么看 AI";

const kickoff = persona.buildResearchKickoffPrompt({ topic: TOPIC, sections: 0 });

const sectionResearch = persona.buildResearchCourseSectionPrompt({
  kind: "research",
  courseTitle: "投资大师如何看 AI:泡沫、赢家与价格",
  introduction:
    "这门课把一二级市场顶级投资人对 AI 的判断拆成一套可学习的框架……(此处为 plan 阶段生成的课程介绍)",
  section: 2,
  sectionTitle: "价值投资者:能力圈与价格纪律",
  sectionSources: [],
  isFirstSection: false
});

const sections = [
  {
    id: "kickoff",
    label: "阶段 1 · 出课程目录(kickoff)",
    sub: "用户提交题目后,客户端注入这段给 deeply agent。它先联网搜现状,再设计「教什么 / 怎么拆」的课程目录(plan)。",
    prompt: kickoff
  },
  {
    id: "section",
    label: "阶段 2 · 逐节讲解(以第 2 节为例)",
    sub: "用户点「开始第 N 节」时注入。本节资料在这一刻才临场联网搜(下面 sources 为空 → prompt 引导现搜)。",
    prompt: sectionResearch
  }
];

const data = { topic: TOPIC, generatedAt: new Date().toISOString(), sections };

const outPath = resolve(REPO, "docs/dev/deeply-prompts.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderHtml(data), "utf8");
console.log(`wrote ${outPath}`);

function renderHtml(data) {
  const payload = JSON.stringify(data)
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--")
    .replace(/-->/g, "--\\>");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Deeply 深度调研课程 · 完整中文 Prompt</title>
<style>
  :root {
    --bg:#0e0d12; --panel:#17161e; --line:#2a2735; --text:#ece8d9;
    --dim:#a9a294; --orange:#ff8c2a; --orange-soft:rgba(255,140,42,.14);
    --mono: ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
    --sans: -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC",sans-serif;
  }
  html,body{background:var(--bg);color:var(--text);margin:0;font-family:var(--sans);line-height:1.6;}
  .wrap{max-width:980px;margin:0 auto;padding:48px 28px 96px;}
  .eyebrow{color:var(--orange);font-size:13px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 10px;font-weight:600;}
  h1{font-size:28px;margin:0 0 10px;font-weight:800;}
  .topic{color:var(--dim);margin:0 0 6px;font-size:15.5px;}
  .topic code{background:var(--panel);border:1px solid var(--line);padding:3px 9px;border-radius:6px;color:var(--text);font-family:var(--mono);font-size:13.5px;}
  .meta{color:var(--dim);font-size:12.5px;margin-top:6px;}
  nav{display:flex;gap:10px;flex-wrap:wrap;margin:26px 0 8px;}
  nav a{font-size:13.5px;color:var(--orange);text-decoration:none;border:1px solid var(--line);background:var(--panel);padding:7px 12px;border-radius:999px;}
  nav a:hover{border-color:var(--orange);}
  section{margin-top:36px;}
  .sec-head{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:16px;}
  .sec-title{font-size:20px;font-weight:700;margin:0 0 6px;}
  .sec-title .badge{background:var(--orange-soft);color:var(--orange);font-size:12px;padding:3px 10px;border-radius:999px;margin-right:10px;vertical-align:middle;font-weight:600;}
  .sec-sub{color:var(--dim);font-size:14px;margin:0;}
  .toolbar{display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;}
  .chars{color:var(--dim);font-size:12.5px;font-family:var(--mono);}
  .copy{cursor:pointer;background:var(--panel);border:1px solid var(--line);color:var(--text);font-size:12.5px;padding:6px 12px;border-radius:8px;}
  .copy:hover{border-color:var(--orange);color:var(--orange);}
  pre{background:#0a0910;border:1px solid var(--line);border-radius:12px;padding:20px;overflow-x:auto;
      font-family:var(--mono);font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word;margin:0;color:var(--text);}
  footer{color:var(--dim);font-size:12px;margin-top:48px;border-top:1px solid var(--line);padding-top:20px;}
  footer code{font-family:var(--mono);color:var(--text);}
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">Deeply · 深度调研课程</p>
  <h1>完整中文 Prompt</h1>
  <p class="topic">示例题目:<code id="topic"></code></p>
  <p class="meta" id="meta"></p>
  <nav id="nav"></nav>
  <div id="sections"></div>
  <footer>
    直接取自 <code>miniapps/deeply/mobile/persona.ts</code> 的真实 prompt builder。
    生成器:<code>scripts/build-deeply-prompt-doc.mjs</code>。
  </footer>
</div>
<script id="payload" type="application/json">${payload}</script>
<script>
  const data = JSON.parse(document.getElementById("payload").textContent);
  document.getElementById("topic").textContent = data.topic;
  document.getElementById("meta").textContent = "生成于 " + new Date(data.generatedAt).toLocaleString("zh-CN");

  const nav = document.getElementById("nav");
  const container = document.getElementById("sections");
  for (const s of data.sections) {
    const a = document.createElement("a");
    a.href = "#" + s.id; a.textContent = s.label;
    nav.appendChild(a);

    const sec = document.createElement("section");
    sec.id = s.id;
    const head = document.createElement("div"); head.className = "sec-head";
    const title = document.createElement("div"); title.className = "sec-title";
    title.innerHTML = '<span class="badge">' + s.id + '</span>' + escapeHtml(s.label);
    const sub = document.createElement("p"); sub.className = "sec-sub"; sub.textContent = s.sub;
    head.appendChild(title); head.appendChild(sub);

    const bar = document.createElement("div"); bar.className = "toolbar";
    const chars = document.createElement("span"); chars.className = "chars";
    chars.textContent = s.prompt.length + " 字符";
    const copy = document.createElement("button"); copy.className = "copy"; copy.textContent = "复制";
    copy.onclick = () => navigator.clipboard.writeText(s.prompt).then(() => { copy.textContent = "已复制"; setTimeout(() => copy.textContent = "复制", 1500); });
    bar.appendChild(chars); bar.appendChild(copy);

    const pre = document.createElement("pre"); pre.textContent = s.prompt;

    sec.appendChild(head); sec.appendChild(bar); sec.appendChild(pre);
    container.appendChild(sec);
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
</script>
</body>
</html>
`;
}
