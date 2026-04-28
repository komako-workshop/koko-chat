# @koko/relay

KokoChat 的 WebSocket 中继服务器。

职责：
- 维护房间（room），一个房间 = 1 APP ↔ 1 CLI
- E2E 加密消息纯中转（relay 看不到明文）
- pairing 流程：CLI 登记临时公钥 → APP 扫 QR → APP 返回加密 bundle
- 离线消息短期缓存（内存 LRU，24h / 1000 条）
- 推送网关（APNs / FCM）[MVP 后]

部署：Komako 的服务器（Ubuntu 22.04, nginx + letsencrypt TLS 反代）。

详见 `tasks/` 下各模块的任务书。
