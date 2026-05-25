# 任务:补全 Deeply 课程库所有书的封面图

## 背景

`miniapps/deeply/data/library-pool.json` 是 Deeply 课程库的 source-of-truth,
15858 本书。客户端 UI(`BookCoverImage.tsx`)读 `book.img` 字段(完整 URL)
渲染封面;空字符串时 fallback 到分类色块 + 书名首字。

当前覆盖率:

| 来源 | id 前缀 | 本数 | 有 img 的 |
| --- | --- | --- | --- |
| Deeply 原 pool(`discover-pool.json`) | `kg_*` | 5569 | 5150 (92%) |
| LLM 后补(`enrich-library-kg-extras.mjs` 产物) | `kgx_*` | 10289 | 0 (0%) |
| **合计** | | **15858** | **5150 (32%)** |

`kgx_*` 那 10289 本是后补的(因为 deeply 主程序没收录这些书,但课程库
需要它们出现在知识谱系卡片里),LLM 当时只给了 `h/p/e`(hook/pitch/echo),
没给 img(LLM 编 URL 不可信)。

现在用户看到课程库里大量紫色色块,体验不好。目标:把这 10289 本(以及
原本应该补但失效的少量 `kg_*` 链接)的封面图全部补全,**下载到我们的
服务器**(不依赖第三方域名),走 `https://deeply.plus/covers/<id>.jpg`
对外提供。

## 数据位置

```
miniapps/deeply/data/
├── library-pool.json                       # source-of-truth (build 产物,~30MB)
└── library-extra-books.generated.json      # 上一轮 LLM enrich 产物(kgx_* 的 h/p/e)

scripts/
├── build-library-pool.mjs                  # merge pipeline,产出 library-pool.json
└── enrich-library-kg-extras.mjs            # LLM enrich pipeline(参考实现风格)
```

`library-pool.json` 里每本书的 schema(`server.mjs` 也读这个):

```json
{
  "id": "kg_7dc8969b32d5",         // 稳定 id,有 kg_ 或 kgx_ 前缀
  "t": "资本论",                    // title (中文为主)
  "a": "马克思",                    // author (中文为主)
  "c": "文明的逻辑",                // category 中文
  "d": "社会学与人类学",            // domain
  "s": 100,                        // score
  "pr": 632.37,                    // PageRank
  "img": "https://m.media-amazon.com/images/I/71hHaW6yh8L._AC_UF1000,1000_QL80_.jpg",
  "h": "改写人类历史进程的思想巨作",   // hook (副标题)
  // ... 详情字段(p/e/ue/de)详情 API 才返回
}
```

## 目标

1. **为所有 `book.img === ""` 的 entry 找到一张可靠的封面 JPEG/PNG**
2. **下载到我们自己的存储**(详见下方"存储方案")
3. **产出 `miniapps/deeply/data/library-covers.generated.json`** —
   后续 `build-library-pool.mjs` 合并时读它,把空 img 字段填上自己的
   托管 URL
4. **重跑 `build-library-pool.mjs`**,确认新 `library-pool.json` 里
   `img` 覆盖率显著提升,目标 ≥ 80%
5. **部署到 `deeply.plus` 服务器**:封面文件搬到 exchange:/var/www/library-covers/,
   Caddyfile 加一条 `/covers/*` 静态路由

## 数据来源策略(建议串行试)

### Tier 1 — Google Books API(主力,无需 key)

```
GET https://www.googleapis.com/books/v1/volumes?q=intitle:<title>+inauthor:<author>&maxResults=3&printType=books
```

* 中英文书覆盖较均衡
* 无 key 状态下 IP 维度限速约 60 req/min,**并发不要超过 5-10**
* 返回 `items[].volumeInfo.imageLinks.thumbnail`(http 链接,换成 https)
* 如果 imageLinks.thumbnail 没有,fallback 用 `smallThumbnail`
* `volumeInfo.industryIdentifiers` 里如果有 ISBN_13,记下来给 Tier 2 用

### Tier 2 — OpenLibrary Covers API(英文经典书补漏)

ISBN 路径(从 Tier 1 拿到):

```
https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg
```

直接 GET 这个 URL,200 + image 就是命中;返回 1x1 png 就是 miss。
判断方法:`HEAD` 请求看 `content-length`,>1KB 才视为有效。

OLID 路径(用 title+author 先 search):

```
GET https://openlibrary.org/search.json?title=<title>&author=<author>&limit=1
→ docs[0].cover_i  → https://covers.openlibrary.org/b/id/<cover_i>-L.jpg
```

### Tier 3 — 豆瓣读书(中文古典/学术书的最后兜底,可选)

豆瓣没开放 API,只能 scrape 搜索结果页 + 详情页。**实现成本高、易碎、
易触发 IP ban**。如果 Tier 1+2 命中率已经 > 80%,这层可以不做。

如果做,流程:

```
https://www.douban.com/search?cat=1001&q=<title>+<author>
  → 解析返回 HTML 找第一条 book.douban.com/subject/<id>/ 链接
  → GET 这个 URL,解析 <img class="cover"> src
  → 那个 src 就是 ~300x450 的 jpg
```

需要带常规浏览器 UA,2-3 req/s 节流。失败率高时立刻放弃,不要无限 retry。

### 共同准入条件

* **图必须 ≥ 5KB**(小于这个的多半是 1x1 占位 / "no cover" 灰图)
* **宽 ≥ 80px 且高 ≥ 100px**(用 sharp / image-size 库判)
* Aspect ratio 大致在 0.5~0.9 之间(书的合理比例,排除横幅 banner)
* 同一本书只用第一个命中的 tier,**不需要 best-of-multiple**

## 存储方案

### 本地 staging

```
miniapps/deeply/data/covers/
├── kg_7dc8969b32d5.jpg
├── kgx_032c56153211.jpg
└── ...
```

文件名:`<book.id>.<ext>`。ext 跟 source 走(jpg/png/webp 都行,但优先转 jpg)。

**这个目录 .gitignore 掉**(15k+ 文件 × 平均 80KB ≈ 1-2 GB,不应进 git)。
追加规则:

```gitignore
miniapps/deeply/data/covers/
```

### Mapping 文件(进 git)

```
miniapps/deeply/data/library-covers.generated.json
```

格式:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-25T08:00:00Z",
  "items": {
    "kgx_032c56153211": {
      "source": "google-books",       // google-books | openlibrary-isbn | openlibrary-search | douban | ...
      "originalUrl": "https://...",   // 抓的源 URL,留存档,后期可重抓
      "filename": "kgx_032c56153211.jpg",
      "bytes": 87234,
      "width": 320,
      "height": 480
    }
  }
}
```

**这个文件进 git**(几 MB 文本,代表"哪些书有图、来自哪")。
build pipeline 改成读这个 mapping 来填 img URL。

### 服务器部署

封面文件 rsync 到 `exchange:/var/www/library-covers/`:

```bash
rsync -avz --progress \
  miniapps/deeply/data/covers/ \
  exchange:/var/www/library-covers/
```

Caddyfile(`/etc/caddy/Caddyfile` on exchange)在 `deeply.plus` 块里
**vercel_pages 之后,godbti 之前**加一段:

```caddy
@library_covers path /covers/*
handle_path /covers/* {
  root * /var/www/library-covers
  file_server
  header Cache-Control "public, max-age=2592000, immutable"
}
```

`handle_path` 会 strip 前缀:`https://deeply.plus/covers/kg_xxx.jpg` →
读 `/var/www/library-covers/kg_xxx.jpg`。

reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 实现要求

### 脚本位置 + 风格

* 新增 `scripts/fetch-library-covers.mjs`(Node.js, 跟 monorepo 现有 mjs 脚本同风格)
* 参考 `scripts/enrich-library-kg-extras.mjs` 的并发 / retry / 进度日志模式
* 必备依赖优先用 Node 22 内置(undici 的 fetch, fs, crypto);
  确实需要新依赖时挑成熟的:`sharp`(图像 metadata)、`image-size`(轻量替代)
* **断点续跑必须支持**:已经存在 `covers/<id>.<ext>` 且 mapping 里有这条
  → 直接跳过。脚本可以反复跑同一遍

### 并发与限速

* Google Books: 并发 5-8,失败 backoff(指数 + jitter,最多重试 3 次)
* OpenLibrary: 并发 10-15
* 豆瓣(若做): 并发 2,QPS ≤ 3
* 整体进度按每 100 本一打印,显示来源分布

### CLI

```bash
node scripts/fetch-library-covers.mjs              # 全跑(默认增量)
node scripts/fetch-library-covers.mjs --only kgx_  # 只处理 kgx_*
node scripts/fetch-library-covers.mjs --force      # 已有也重跑(覆盖)
node scripts/fetch-library-covers.mjs --limit 100  # 只跑前 100 本,验证流程
node scripts/fetch-library-covers.mjs --skip-douban
```

### 修改 build-library-pool.mjs

`scripts/build-library-pool.mjs` 现在的合并顺序大致是
`base(deeply pool) + extra(LLM 后补)`。在最后再追加一步:

```js
const covers = JSON.parse(fs.readFileSync(COVERS_PATH, "utf8"));
const PUBLIC_BASE = process.env.LIBRARY_COVERS_PUBLIC_BASE
  ?? "https://deeply.plus/covers";

for (const book of allBooks) {
  if (book.img && book.img.length > 0) continue;  // 已有不动
  const meta = covers.items?.[book.id];
  if (meta?.filename) {
    book.img = `${PUBLIC_BASE}/${meta.filename}`;
  }
}
```

`LIBRARY_COVERS_PUBLIC_BASE` env 让 dev 期可以指本机 / 其它 host。

### Server 不需要改

`apps/deeply-library-server/server.mjs` 已经直接 echo `book.img`,
build 阶段填好 URL 后服务器零改动。

## 部署 / 上线步骤(等你跑完代码后)

```bash
# 1. 本地跑出 covers
node scripts/fetch-library-covers.mjs
node scripts/build-library-pool.mjs

# 2. rsync 到服务器
rsync -avz --delete miniapps/deeply/data/covers/ \
  exchange:/var/www/library-covers/

# 3. Caddyfile 加 /covers/* 路由(见上)
sudo systemctl reload caddy

# 4. 提交代码(library-covers.generated.json 进 git;covers/ 不进)
git add miniapps/deeply/data/library-covers.generated.json \
        miniapps/deeply/data/library-pool.json \
        .gitignore \
        scripts/fetch-library-covers.mjs \
        scripts/build-library-pool.mjs
git commit -m "Backfill library covers"
git push

# 5. 服务器拉新数据,重启 library service in-memory load
ssh exchange "cd /opt/koko-chat && git pull && sudo systemctl restart kokochat-library"
```

## 验收标准

我会按这些检查:

1. **覆盖率**:`library-pool.json` 里 `img` 非空率 ≥ 80%(理想 ≥ 90%)
2. **链路通**:随机抽 10 本封面在浏览器打开,`https://deeply.plus/covers/<id>.jpg`
   都能 200 返回正常 JPEG
3. **质量抽检**:从原本 `kgx_*` 0 封面里抽 20 本,**封面对应的书确实是
   那本书**(不能是张冠李戴)。错的比例 ≤ 5%
4. **客户端无回归**:打开 expo go 课程库,大部分卡片显示真封面而不是色块
5. **报告**:脚本结束输出汇总:
   ```
   total: 15858
   already-had: 5150
   newly-found: <N>  (google: <X>, openlibrary: <Y>, douban: <Z>)
   still-missing: <M>
   ```
6. **代码可重跑**:第二次跑 `fetch-library-covers.mjs` 几乎瞬间结束
   (全部命中 cache)
7. **README 更新**:`apps/deeply-library-server/README.md` 加一节
   "封面图维护",说明 covers/ 怎么补、怎么 rsync 上线

## 时间预估(给你参考)

* 写脚本:1-2 小时
* 跑 Google Books + OpenLibrary 两轮:30-60 分钟(IO bound)
* 跑豆瓣(若做):额外 1-2 小时(慢 + 容易被 ban)
* rsync + Caddy 改 + 验证:15 分钟

合计 3-5 小时。

## 已知风险

* Google Books 对中文古籍/小众学术书命中率可能低于 50%
* 部分书可能根本没有商业版封面图(如 `《残篇》(克里西波斯)`,
  古代哲人著作没有现代封面)。这类即便 0 命中也算正常,fallback 色块
  本来就是为这种情况设计的
* 抓回来的图可能侵权(出版社版权)。**短期内自用 dev/TestFlight 没问题**,
  但要不要在产品里使用需要法律侧再判断。这是已知风险,本任务不解决

## 文件清单(完成后应有的产物)

```
scripts/fetch-library-covers.mjs                   # 新增
scripts/build-library-pool.mjs                     # 修改:合并 covers
miniapps/deeply/data/library-covers.generated.json # 新增
miniapps/deeply/data/library-pool.json             # 重新生成
miniapps/deeply/data/covers/*.jpg                  # 大量文件,**不进 git**
.gitignore                                         # 追加 covers/ 规则
apps/deeply-library-server/README.md               # 加封面维护章节
```

服务器侧:

```
exchange:/var/www/library-covers/*.jpg             # rsync 上去
exchange:/etc/caddy/Caddyfile                      # 加 /covers/* 反代
```
