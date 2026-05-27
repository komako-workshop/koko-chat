# 任务:给 kokochat.komako.me 装 HTTPS 并完成上线

## 背景

KokoChat 的官方下载页(`site/index.html`)已经上传到服务器 komako
(`ecs-user@47.236.166.37`),目前已经能通过 HTTP 提供服务。差最后一步:

1. 等域名 DNS 生效
2. 用 certbot 签 HTTPS 证书 + 改 nginx 自动加 443 + 80→443 重定向
3. 验收上线

本任务是这"最后一步"。你要 ssh 进 komako 操作 nginx + certbot,不需要
改本机仓库代码,不需要重新部署站点文件。

## 已经完成(请不要重复操作)

- 站点目录:`/var/www/kokochat-site/`,里面有 `index.html` + `assets/`
- nginx vhost:`/etc/nginx/sites-enabled/kokochat.komako.me`,**仅监听 80**,
  root 指向 `/var/www/kokochat-site/`
- `nginx -t` + `systemctl reload nginx` 已 OK
- HTTP 已可通过 Host header 验证:
  ```
  curl -I -H "Host: kokochat.komako.me" http://47.236.166.37/
  → 200 OK
  ```

## 服务器现状(再确认一次)

- 主机:`ssh komako` → `ecs-user@47.236.166.37`(Ubuntu 22.04)
- web server:nginx 1.18(已经在跑,80/443 被它占用,**不要换 caddy**)
- 已有 vhost:`oracle.komako.me`(完整 HTTPS,certbot 管理,可作模板)
- certbot:`/usr/bin/certbot` 1.21,已经能用,会自动 systemd timer 续期
- 已存证书目录:`/etc/letsencrypt/live/oracle.komako.me/`

## 前置条件(用户先确认)

DNS A 记录 `kokochat.komako.me → 47.236.166.37` **必须已经生效**。
你执行前先在 komako 上 verify:

```bash
ssh komako 'dig +short kokochat.komako.me @1.1.1.1'
# 期望输出: 47.236.166.37
```

如果不是 47.236.166.37,**停止操作**,告诉用户 DNS 还没生效让他先去配。
不要尝试用 `--manual` / DNS-01 等绕路方式签证书。

## 你要做的事

### 1. 跑 certbot 签证书并改 nginx

用户会给你一个邮箱,用作 Let's Encrypt 注册邮箱。如果用户没给,问他要,
不要随便填一个。

```bash
ssh komako 'sudo certbot --nginx \
  -d kokochat.komako.me \
  --non-interactive --agree-tos --redirect \
  -m <USER_EMAIL>'
```

预期 certbot 会自动:

- 跑 HTTP-01 challenge,签下证书,放到 `/etc/letsencrypt/live/kokochat.komako.me/`
- 把 `/etc/nginx/sites-enabled/kokochat.komako.me` 改成:
  - `listen 443 ssl` + `ssl_certificate` + `ssl_certificate_key`
  - include `/etc/letsencrypt/options-ssl-nginx.conf`
  - 加一个 80 服务器块做 301 重定向到 https
- reload nginx

参考已有 vhost `/etc/nginx/sites-enabled/oracle.komako.me` 的最终形态,
新 vhost 改完后结构应该跟它一致(差别是它有 reverse_proxy,我们是 file_server)。

### 2. 验收

按顺序验:

```bash
# HTTPS 正常 200,Server 是 nginx
curl -sS -I https://kokochat.komako.me/ | head -8

# HTML 渲染包含 KokoChat 品牌字
curl -sS https://kokochat.komako.me/ | grep -oE '<title>[^<]+</title>'
# 期望: <title>KokoChat — Turn your OpenClaw into your pocket AI agent hub</title>

# 80 被 301 重定向到 443
curl -sS -I http://kokochat.komako.me/ | head -3
# 期望: HTTP/1.1 301 Moved Permanently  +  Location: https://kokochat.komako.me/

# Assets 也走 https
curl -sS -I https://kokochat.komako.me/assets/app-icon.png | head -5
# 期望: 200 OK, image/png, Cache-Control: public, max-age=2592000, immutable

# 证书续期 timer 在
ssh komako 'systemctl list-timers --all | grep -i certbot'
# 期望: 有一条 certbot.timer (next run 时间)

# 证书有效期 (60-90 天)
ssh komako 'sudo certbot certificates -d kokochat.komako.me 2>/dev/null | grep -E "Expiry|Certificate Name"'
```

### 3. 报告

任务完成后给用户输出:

- HTTPS URL:`https://kokochat.komako.me/`
- 证书签发时间 + 过期时间
- 证书续期是 systemd timer(`certbot.timer`)自动管,无需手动维护
- nginx vhost 最终路径:`/etc/nginx/sites-enabled/kokochat.komako.me`

## 边界 / 注意事项

- **不要装 caddy。** 80/443 被 nginx 占着,有现成 vhost 在跑,不要换。
- **不要碰其它 vhost。** `oracle.komako.me` 不动,只是作为模板参考。
- **不要 sudo rm / overwrite 别人证书。** certbot 命令只针对 `kokochat.komako.me`。
- **不要改 `/var/www/kokochat-site/` 里的文件。** 那是站点内容,不是你的范围。
  下次更新站点是 `rsync` 流程,这次不做。
- **DNS 没生效前不要重试 certbot。** Let's Encrypt 限速 5 次/小时/域名,
  浪费完真要等。
- **如果 certbot 失败:** 把 stderr 完整贴出来。常见原因:
  - DNS 还没生效
  - 80 被 firewall 拦了(检查 `ufw status` / 阿里云安全组)
  - certbot 之前对这个域名失败过被速率限制(查 `/var/log/letsencrypt/letsencrypt.log`)

## 失败应急

如果 certbot 把 nginx vhost 改坏了导致 nginx reload 失败:

```bash
ssh komako 'sudo nginx -t'   # 看具体语法错
# certbot 的备份在 /etc/letsencrypt/configs/ 或 /var/lib/snapd/...
# 实际上 certbot --nginx 改之前会备份,可以 grep 找:
ssh komako 'ls -lt /etc/nginx/sites-available/ | head'
```

如果完全救不回来,把 vhost 内容恢复成最小 HTTP-only 版本:

```nginx
server {
    listen 80;
    server_name kokochat.komako.me;
    root /var/www/kokochat-site;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

然后 `sudo systemctl reload nginx`,先把 HTTP 救回来,再分析 certbot 失败原因。

## 一句话总结

DNS 生效 → ssh komako → 一行 certbot --nginx → 验四个 curl → 报告 URL。
