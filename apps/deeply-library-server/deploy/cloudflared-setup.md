# Cloudflared 公网入口配置

把 library server(本地 127.0.0.1:8788)通过 Cloudflare Tunnel 反代出公网
HTTPS。需要一个 Cloudflare 账户(免费)。两种路径:

| 路径 | 适用 | 域名 |
| --- | --- | --- |
| **Quick tunnel**(下方 A) | 临时验证,5 分钟搭好 | `https://random.trycloudflare.com`(每次重启会变) |
| **Named tunnel**(下方 B) | 生产 / TestFlight 用 | `https://<your-subdomain>` 固定,需要绑一个 Cloudflare 上托管的域名 |

----

## A. Quick tunnel(快速试)

```bash
# 安装 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version

# 起一个 quick tunnel(前台跑,出 URL 立刻可访问)
cloudflared tunnel --url http://127.0.0.1:8788
# stdout 里会出现一行:
#   Your quick Tunnel has been created! Visit it at:
#   https://abc-def-xyz.trycloudflare.com
```

把那条 `trycloudflare.com` 的 URL 临时填进 `app.config.js` 的
`deeplyLibraryApiBase`(或者 export `KOKO_DEEPLY_LIBRARY_API_BASE` 给 expo
build),客户端就能拉到课程库。注意 Quick tunnel 重启换 URL,**只适合
开发期验证 ATS/HTTPS 链路**。

----

## B. Named tunnel(生产)

前置:你在 Cloudflare 名下有一个域名,比如 `komako.ai`(或者任何 cf 托管的)。

```bash
# 1. 装 cloudflared(同上)

# 2. 登录(打开浏览器交互授权)
cloudflared tunnel login
# → 在浏览器选你的域名,cloudflared 会把 cert.pem 存到 ~/.cloudflared/

# 3. 创建一个 named tunnel
cloudflared tunnel create deeply-library
# → 输出一行:
#   Created tunnel deeply-library with id <UUID>
#   credentials file at /root/.cloudflared/<UUID>.json

# 4. 把 UUID 跟域名绑起来(子域名自取,这里举例 deeply-library.komako.ai)
cloudflared tunnel route dns deeply-library deeply-library.komako.ai

# 5. 写 /etc/cloudflared/config.yml
mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<'YAML'
tunnel: deeply-library
credentials-file: /root/.cloudflared/<UUID>.json   # 用上一步输出的 UUID

ingress:
  - hostname: deeply-library.komako.ai
    service: http://127.0.0.1:8788
  - service: http_status:404
YAML

# 6. 跑起来(前台先试一次)
cloudflared tunnel --config /etc/cloudflared/config.yml run
# → 应该看到 Registered tunnel connection 之类的日志
# 浏览器访问 https://deeply-library.komako.ai/healthz 应该返回 {ok:true}

# 7. 装 systemd unit 守护
cp /opt/koko-chat/apps/deeply-library-server/deploy/kokochat-library-tunnel.service \
   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kokochat-library-tunnel
systemctl status kokochat-library-tunnel --no-pager
```

跑完之后把 `deeply-library.komako.ai` 写进 `app.config.js` 作为
`deeplyLibraryApiBase` 的 prod 默认值。

----

## 排错

* `curl https://deeply-library.komako.ai/healthz` 502 → 后端没起,
  `systemctl status kokochat-library`
* 403 / connection refused → tunnel 没起,
  `systemctl status kokochat-library-tunnel`,看 `journalctl -u kokochat-library-tunnel -n 50`
* expo go 真机 fetch 失败 → 确认 URL 是 `https://`(iOS ATS 拒绝 plain http),
  抓 Console.app 日志(Mac 连 iPhone)能看到具体错误
