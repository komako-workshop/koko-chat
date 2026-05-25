# @koko/deeply-library-server

Deeply 课程库 metadata 静态服务。把 ~15858 本课程的 metadata 从 RN bundle
里搬到线上,客户端按需 fetch。

## 启动(dev)

```bash
pnpm --filter @koko/deeply-library-server install
pnpm --filter @koko/deeply-library-server dev
# 默认 http://0.0.0.0:8788(LAN / 真机 / loopback 都可访问)
```

数据源默认是 `miniapps/deeply/data/library-pool.json`(由
`scripts/build-library-pool.mjs` 生成)。可以通过 `LIBRARY_POOL_PATH` 覆盖。

## API

| 路径 | 说明 |
| --- | --- |
| `GET /healthz` | 健康检查 |
| `GET /library/home?top=N` | 9 个分类摘要(name + count + topBooks),客户端首屏一发拉全 |
| `GET /library/categories` | 9 个分类 + 数量,按数量降序 |
| `GET /library/books?cat=&page=&limit=&fields=list\|full` | 分页列表(默认按 pr 降序) |
| `GET /library/books/:id` | 单本全字段(含 `ue/de` 知识谱系) |
| `GET /library/search?q=&limit=` | title/author 子串搜索 |

`fields=list` 只返回 `id/t/a/c/d/s/pr/img/h`(给主页/分类页用);
`fields=full` 返回原始全字段(避免大量调用)。

## 生产部署

跑在 Komako exchange 服务器(deeply.plus host),Caddy 接 :443 反代到本地
`127.0.0.1:8788`。客户端 API base 为 `https://deeply.plus`。

### 一次性部署

```bash
ssh exchange
sudo mkdir -p /opt/koko-chat && sudo chown ecs-user:ecs-user /opt/koko-chat
cd /opt && git clone https://github.com/komako-workshop/koko-chat.git
cd /opt/koko-chat/apps/deeply-library-server
npm install --omit=dev --no-audit --no-fund

# 装 systemd unit
sudo cp deploy/kokochat-library.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kokochat-library
sudo systemctl status kokochat-library --no-pager
curl -s http://127.0.0.1:8788/healthz   # {"ok":true,...}

# Caddyfile:在 deeply.plus 块里 vercel_pages 之后、godbti 之前加
#   @library path /library/* /healthz
#   handle @library {
#     reverse_proxy 127.0.0.1:8788
#   }
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -s https://deeply.plus/healthz     # 公网验证
```

### 更新代码 / 数据

```bash
ssh exchange
cd /opt/koko-chat
git pull
# 数据有变 -> 重启 service(in-memory load)
sudo systemctl restart kokochat-library
```

### 封面图维护

封面源数据由 `scripts/fetch-library-covers.mjs` 维护。脚本读取
`miniapps/deeply/data/library-pool.json`，把缺失封面的图片下载到本地
`miniapps/deeply/data/covers/`，并生成会进 git 的
`miniapps/deeply/data/library-covers.generated.json`。本地图片目录很大，
已经被 `.gitignore` 忽略。

常用命令：

```bash
node scripts/fetch-library-covers.mjs --only kgx_
node scripts/fetch-library-covers.mjs --limit 100 --skip-douban
node scripts/build-library-pool.mjs
```

上线图片时同步本地 covers 目录到 exchange，然后让 Caddy 的 `/covers/*`
静态路由读取 `/var/www/library-covers/`：

```bash
rsync -avz --delete miniapps/deeply/data/covers/ \
  exchange:/var/www/library-covers/
```

`library-pool.json` 中的空 `img` 会在 build 阶段按
`library-covers.generated.json` 填成 `https://deeply.plus/covers/<id>.<ext>`。
需要临时指向别的 host 时，可设置 `LIBRARY_COVERS_PUBLIC_BASE` 后再跑
`scripts/build-library-pool.mjs`。

### Env

| 变量 | prod 值 | 说明 |
| --- | --- | --- |
| `LIBRARY_HOST` | `127.0.0.1` | 监听 host。loopback 因为 Caddy 反代,不直接暴露公网 |
| `LIBRARY_PORT` | `8788` | 监听端口 |
| `LIBRARY_POOL_PATH` | `/opt/koko-chat/miniapps/deeply/data/library-pool.json` | 数据文件绝对路径 |
