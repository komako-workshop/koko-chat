# KokoChat 下载站(`site/`)

KokoChat 公开下载页,一份纯静态 HTML,部署在
[https://kokochat.komako.me](https://kokochat.komako.me)。

零依赖:浏览器直接打开 `site/index.html` 就能预览;部署也只是把
`site/` 里的内容 rsync 到服务器静态目录。

## 目录

```
site/
├── index.html               单文件页面(主标语 + 两个下载按钮 + 小程序简介)
├── README.md                这份文档
└── assets/
    ├── app-icon.png         hero icon + favicon + OG image(从 apps/koko-chat/assets/icon.png 复制)
    └── sticker.png          备用品牌素材,目前 HTML 未引用
```

## 本地预览

```bash
cd site
python3 -m http.server 4321
open http://127.0.0.1:4321/
```

## 内容怎么改

直接编辑 `site/index.html`。常见调整位置:

- 主标语 / 中文 lede:`<h1>` 和 `<p class="lede">`
- 两个下载按钮的 URL:`<a class="btn ...">` 的 `href`
  - iOS:`https://testflight.apple.com/join/VpTW5U75`
  - Android:`https://docs.metacreate.cc/kokochat/android/latest.apk`
- mini-app 一行简介:`<div class="apps">`
- 配色 / 阴影 / 字号:`<style>` 里的 `:root` 变量
- OG / favicon:`<meta property="og:*">` 和 `<link rel="icon">`

如果要换 app icon,把新 PNG 覆盖到 `assets/app-icon.png` 即可,
HTML 里多处引用都指向这个文件。

## 部署

服务器:`ssh komako`(`ecs-user@47.236.166.37`,Ubuntu 22.04,nginx)。

### 更新内容

```bash
rsync -avz --delete \
  --exclude='/README.md' \
  --exclude='/downloads/' \
  site/ komako:/var/www/kokochat-site/
```

`--exclude='/README.md'` 是为了避免把这份开发文档推到公网目录。
`--exclude='/downloads/'` 是为了避免更新页面时误删服务器上的 APK。

### 更新 Android APK

Android 下载按钮指向 OSS 自定义域,更新包时覆盖 `kokochat/android/latest.apk`:

```bash
source ~/.aliyun-kokochat-oss.env
# 上传 artifacts/android/kokochat-android-v*.apk 到:
# https://docs.metacreate.cc/kokochat/android/latest.apk
```

无需 reload nginx——这是纯静态文件 + 短缓存(`index.html` 5 分钟,
`assets/` 30 天 immutable),改完几分钟内生效。如果想立刻看到 HTML 改动:

```bash
# 强制清掉 nginx fd cache(几乎不需要,只在改了 vhost 配置后才必要)
ssh komako 'sudo systemctl reload nginx'
```

### 服务器侧关键路径

| 用途 | 路径 |
| --- | --- |
| 站点根目录 | `/var/www/kokochat-site/` |
| nginx vhost | `/etc/nginx/sites-enabled/kokochat.komako.me` |
| HTTPS 证书 | `/etc/letsencrypt/live/kokochat.komako.me/` |
| 证书自动续期 | `systemctl list-timers` → `certbot.timer` |

证书:Let's Encrypt,89 天周期,certbot systemd timer 自动续,
无需手动维护。

### DNS

Cloudflare 上 A 记录 `kokochat.komako.me → 47.236.166.37`,
**proxy 状态必须保持 DNS only**(灰云),否则:

- Let's Encrypt HTTP-01 challenge 会被 Cloudflare 拦截,后续续期可能失败
- 直接走 Cloudflare 反代会引入额外缓存/回源延迟,目前没必要

### 首次部署历史(给后人参考)

第一次上线时的操作流水见 `tasks/kokochat-site-https.md`。当时:

1. 本地写好 `site/`(纯静态)
2. `rsync site/` 到 `komako:/var/www/kokochat-site/`
3. 写 `/etc/nginx/sites-enabled/kokochat.komako.me`(仅 80,root 指向上述目录)
4. 等 Cloudflare DNS 生效
5. `sudo certbot --nginx -d kokochat.komako.me ...` 自动签 cert + 改 vhost 加 443 + 80→443 重定向

再开一个子域名走同样流程即可。

## 常见排查

**本机 curl 打 kokochat.komako.me 返回 `198.18.18.215` / 拒绝连接**

本机走了 fake-ip 代理(ClashX / AdGuard / Surge 之类),不是源站问题。
临时验证源站:

```bash
curl -I --resolve kokochat.komako.me:443:47.236.166.37 https://kokochat.komako.me/
```

**改完 `site/` 推上去看不到变化**

强刷浏览器(Cmd+Shift+R)。`index.html` 自身 `max-age=300`,
最多 5 分钟内会拿到新版。`assets/` 是 immutable cache,换文件名
或者直接覆盖都行(浏览器按文件名缓存,覆盖也会重新拉)。
