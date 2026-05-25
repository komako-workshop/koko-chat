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

跟 `koko-relay` 共用一台阿里云 ECS,代码独立。
公网入口走 **Cloudflare Tunnel**(免配置域名 / 证书,cloudflared 给出
一个 `https://*.trycloudflare.com` 或 named tunnel 子域名)。

### 一次性部署

```bash
# 1. 服务器拉最新代码 + 安装依赖
ssh koko
cd /opt/koko-chat
git pull
cd apps/deeply-library-server
pnpm install --prod

# 2. 装 systemd unit 跑 server(监听 127.0.0.1 之外也允许,但 cloudflared
#    会从 127.0.0.1:8788 反代过去,所以理论上也可锁 127.0.0.1)
cp deploy/kokochat-library.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kokochat-library
systemctl status kokochat-library --no-pager
curl -s http://127.0.0.1:8788/healthz

# 3. 装 cloudflared + 起 tunnel(只需一次)
#    详见 deploy/cloudflared-setup.md
```

### 更新代码 / 数据

```bash
ssh koko
cd /opt/koko-chat
git pull
# 数据有变 -> 重启 service(in-memory load)
systemctl restart kokochat-library
# server.mjs 改了 -> 同上
```

### 系统 service 文件

* `deploy/kokochat-library.service` — server 本体
* `deploy/kokochat-library-tunnel.service` — cloudflared 出公网(named tunnel)
* `deploy/cloudflared-setup.md` — cloudflared 首次配置指引

### Env

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LIBRARY_PORT` | `8788` | 监听端口 |
| `LIBRARY_HOST` | `0.0.0.0` | 监听 host,内网或容器场景 0.0.0.0,严格 loopback 用 127.0.0.1 |
| `LIBRARY_POOL_PATH` | `../../miniapps/deeply/data/library-pool.json` | 数据文件绝对路径 |
