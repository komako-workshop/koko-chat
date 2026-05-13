#!/usr/bin/env python3
"""
扫描 .brand/out 下所有 PNG，生成一个浏览器挑图页面。
- 每张图按 pose / mood / palette / style 打标签
- 支持点击放大、收藏、过滤
- 收藏存 localStorage，导出 JSON
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "out"
INDEX_PATH = ROOT / "index.html"
META_PATH = ROOT / "meta.json"

POSES = ["head-side", "head-front", "full-side", "full-3q", "head-tilted",
         "holding-note", "on-book", "silhouette"]
MOODS = ["smart", "friendly", "playful"]
PALETTES = ["mono-black", "coral", "mint", "sunset", "dual-teal-coral", "rainbow-soft"]
STYLES = ["flat", "line", "chibi"]


def parse(filename):
    """000_pose_mood_palette_style.png"""
    m = re.match(r"(\d+)_([^_]+(?:-[^_]+)*)_([^_]+)_([^_]+(?:-[^_]+)*)_([^.]+)\.png$", filename)
    if not m:
        return None
    idx, pose, mood, palette, style = m.groups()
    return {
        "idx": int(idx),
        "pose": pose,
        "mood": mood,
        "palette": palette,
        "style": style,
        "file": filename,
    }


def main():
    files = sorted(os.listdir(OUT_DIR))
    items = [parse(f) for f in files if f.endswith(".png")]
    items = [i for i in items if i]
    items.sort(key=lambda x: x["idx"])

    data_json = json.dumps(items, ensure_ascii=False)
    poses_json = json.dumps(POSES)
    moods_json = json.dumps(MOODS)
    palettes_json = json.dumps(PALETTES)
    styles_json = json.dumps(STYLES)

    html = """<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>KokoChat — 鹦鹉 logo 草稿挑图</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif;
    background: #f5f3ee;
    color: #1f1f1f;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: rgba(245,243,238,0.95);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid #e0ddd5;
    padding: 14px 20px;
  }
  h1 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
  .subtitle { font-size: 12px; color: #777; margin-bottom: 12px; }
  .filters { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
  .filter-group { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .filter-group .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }
  .chip {
    font-size: 12px;
    padding: 4px 10px;
    border: 1px solid #d4d0c4;
    border-radius: 999px;
    background: white;
    cursor: pointer;
    user-select: none;
    transition: all 0.15s;
  }
  .chip:hover { border-color: #888; }
  .chip.active { background: #1f1f1f; color: white; border-color: #1f1f1f; }
  .toolbar { display: flex; gap: 8px; margin-left: auto; align-items: center; }
  button.btn {
    font-size: 12px;
    padding: 6px 12px;
    border: 1px solid #d4d0c4;
    background: white;
    border-radius: 6px;
    cursor: pointer;
  }
  button.btn:hover { background: #faf8f3; }
  .stats { font-size: 12px; color: #555; }
  main {
    padding: 20px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .card {
    background: white;
    border: 1px solid #e0ddd5;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.15s;
    position: relative;
  }
  .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-2px); }
  .card.fav { box-shadow: 0 0 0 3px #ff7a6b; }
  .card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; display: block; background: #fafafa; }
  .meta {
    padding: 8px 10px;
    font-size: 10px;
    color: #666;
    display: flex; flex-wrap: wrap; gap: 4px;
    border-top: 1px solid #f0ede5;
  }
  .meta .tag { background: #f5f3ee; padding: 2px 6px; border-radius: 4px; }
  .meta .tag.pose { color: #5b6cb0; }
  .meta .tag.mood { color: #c8784a; }
  .meta .tag.palette { color: #5e8c5b; }
  .meta .tag.style { color: #888; }
  .idx { position: absolute; top: 6px; left: 8px; font-size: 10px; color: rgba(0,0,0,0.4); font-family: ui-monospace, monospace; }
  .fav-btn {
    position: absolute;
    top: 6px; right: 6px;
    width: 26px; height: 26px;
    border-radius: 50%;
    background: rgba(255,255,255,0.92);
    border: 1px solid #e0ddd5;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
    cursor: pointer;
  }
  .fav-btn.on { background: #ff7a6b; color: white; border-color: #ff7a6b; }

  /* lightbox */
  .lightbox {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.85);
    display: none;
    align-items: center; justify-content: center;
    z-index: 100;
    padding: 40px;
  }
  .lightbox.show { display: flex; }
  .lightbox img { max-width: 90%; max-height: 90%; }
  .lightbox .close { position: absolute; top: 20px; right: 24px; color: white; font-size: 32px; cursor: pointer; }
  .lightbox .info { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: white; font-family: ui-monospace, monospace; font-size: 12px; }

  .empty { padding: 40px; text-align: center; color: #888; grid-column: 1 / -1; }
</style>
</head>
<body>

<header>
  <h1>KokoChat — 鹦鹉 logo / mascot 草稿</h1>
  <div class="subtitle">点缩略图放大；点右上角心形收藏；用上方筛选过滤维度。</div>
  <div class="filters">
    <div class="filter-group" data-dim="pose">
      <span class="label">姿态</span>
    </div>
    <div class="filter-group" data-dim="mood">
      <span class="label">气质</span>
    </div>
    <div class="filter-group" data-dim="palette">
      <span class="label">配色</span>
    </div>
    <div class="filter-group" data-dim="style">
      <span class="label">风格</span>
    </div>
    <div class="filter-group">
      <span class="label">收藏</span>
      <span class="chip" data-fav="all">全部</span>
      <span class="chip" data-fav="only">仅看收藏</span>
    </div>
    <div class="toolbar">
      <span class="stats" id="stats"></span>
      <button class="btn" id="exportBtn">导出收藏</button>
      <button class="btn" id="clearBtn">清空收藏</button>
    </div>
  </div>
</header>

<main id="grid"></main>

<div class="lightbox" id="lightbox">
  <span class="close" id="lbClose">&times;</span>
  <img id="lbImg">
  <div class="info" id="lbInfo"></div>
</div>

<script>
const ITEMS = __DATA__;
const POSES = __POSES__;
const MOODS = __MOODS__;
const PALETTES = __PALETTES__;
const STYLES = __STYLES__;

const FAV_KEY = 'kokochat_brand_favs_v1';
let favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));

const filters = { pose: null, mood: null, palette: null, style: null, fav: 'all' };

function buildChips() {
  const dims = { pose: POSES, mood: MOODS, palette: PALETTES, style: STYLES };
  for (const [dim, vals] of Object.entries(dims)) {
    const grp = document.querySelector(`.filter-group[data-dim="${dim}"]`);
    const all = mkChip('全部', () => { filters[dim] = null; refresh(); });
    all.dataset.value = '';
    grp.appendChild(all);
    for (const v of vals) {
      const c = mkChip(v, () => { filters[dim] = v; refresh(); });
      c.dataset.value = v;
      grp.appendChild(c);
    }
  }
  document.querySelectorAll('[data-fav]').forEach(el => {
    el.addEventListener('click', () => { filters.fav = el.dataset.fav; refresh(); });
  });
}
function mkChip(label, onClick) {
  const c = document.createElement('span');
  c.className = 'chip';
  c.textContent = label;
  c.addEventListener('click', onClick);
  return c;
}

function syncChipStates() {
  document.querySelectorAll('.filter-group').forEach(grp => {
    const dim = grp.dataset.dim;
    if (!dim) return;
    grp.querySelectorAll('.chip').forEach(c => {
      const v = c.dataset.value;
      const active = (v === '' && !filters[dim]) || (v && v === filters[dim]);
      c.classList.toggle('active', !!active);
    });
  });
  document.querySelectorAll('[data-fav]').forEach(el => {
    el.classList.toggle('active', el.dataset.fav === filters.fav);
  });
}

function refresh() {
  syncChipStates();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  let n = 0;
  for (const it of ITEMS) {
    if (filters.pose && it.pose !== filters.pose) continue;
    if (filters.mood && it.mood !== filters.mood) continue;
    if (filters.palette && it.palette !== filters.palette) continue;
    if (filters.style && it.style !== filters.style) continue;
    if (filters.fav === 'only' && !favs.has(it.idx)) continue;
    grid.appendChild(makeCard(it));
    n++;
  }
  if (n === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '没有匹配的图片。';
    grid.appendChild(e);
  }
  document.getElementById('stats').textContent = `${n} / ${ITEMS.length} 张  ·  收藏 ${favs.size}`;
}

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card' + (favs.has(it.idx) ? ' fav' : '');
  card.innerHTML = `
    <span class="idx">#${String(it.idx).padStart(3,'0')}</span>
    <span class="fav-btn ${favs.has(it.idx) ? 'on' : ''}" title="收藏">${favs.has(it.idx) ? '♥' : '♡'}</span>
    <img loading="lazy" src="out/${it.file}" alt="">
    <div class="meta">
      <span class="tag pose">${it.pose}</span>
      <span class="tag mood">${it.mood}</span>
      <span class="tag palette">${it.palette}</span>
      <span class="tag style">${it.style}</span>
    </div>`;
  card.addEventListener('click', e => {
    if (e.target.classList.contains('fav-btn')) {
      e.stopPropagation();
      toggleFav(it.idx);
      return;
    }
    openLightbox(it);
  });
  return card;
}

function toggleFav(idx) {
  if (favs.has(idx)) favs.delete(idx); else favs.add(idx);
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  refresh();
}

function openLightbox(it) {
  document.getElementById('lbImg').src = `out/${it.file}`;
  document.getElementById('lbInfo').textContent =
    `#${String(it.idx).padStart(3,'0')} · ${it.pose} · ${it.mood} · ${it.palette} · ${it.style}`;
  document.getElementById('lightbox').classList.add('show');
}
document.getElementById('lbClose').addEventListener('click', () => {
  document.getElementById('lightbox').classList.remove('show');
});
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target.id === 'lightbox') e.currentTarget.classList.remove('show');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const picked = ITEMS.filter(it => favs.has(it.idx));
  const text = JSON.stringify(picked, null, 2);
  navigator.clipboard.writeText(text).then(() => alert(`已复制 ${picked.length} 张收藏的元数据到剪贴板`));
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('清空所有收藏？')) {
    favs.clear();
    localStorage.removeItem(FAV_KEY);
    refresh();
  }
});

buildChips();
refresh();
</script>
</body>
</html>
"""
    html = (
        html
        .replace("__DATA__", data_json)
        .replace("__POSES__", poses_json)
        .replace("__MOODS__", moods_json)
        .replace("__PALETTES__", palettes_json)
        .replace("__STYLES__", styles_json)
    )
    INDEX_PATH.write_text(html, encoding="utf-8")
    print(f"wrote {INDEX_PATH}  ({len(items)} items)")


if __name__ == "__main__":
    main()
