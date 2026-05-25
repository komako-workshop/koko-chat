# @koko/deeply-library-server

Deeply 课程库静态数据服务。把 ~15858 本课程的 metadata 从 RN bundle 里搬到
线上,客户端按需 fetch。

## 启动(dev)

```bash
pnpm --filter @koko/deeply-library-server install
pnpm --filter @koko/deeply-library-server dev
# 默认 http://127.0.0.1:8788
```

数据源默认是 `miniapps/deeply/data/library-pool.json`(由
`scripts/build-library-pool.mjs` 生成)。可以通过 `LIBRARY_POOL_PATH` 覆盖。

## API

| 路径 | 说明 |
| --- | --- |
| `GET /healthz` | 健康检查 |
| `GET /library/categories` | 9 个分类 + 数量,按数量降序 |
| `GET /library/books?cat=&page=&limit=&fields=list\|full` | 分页列表(默认按 pr 降序) |
| `GET /library/books/:id` | 单本全字段(含 `ue/de` 知识谱系) |
| `GET /library/search?q=&limit=` | title/author 子串搜索 |

`fields=list` 只返回 `id/t/a/c/d/s/pr/img/h`(给主页/分类页用);
`fields=full` 返回原始全字段(避免大量调用)。

## 部署

跟 `koko-relay` 共用一台阿里云 ECS,代码独立。

```bash
LIBRARY_HOST=0.0.0.0 LIBRARY_PORT=8788 pnpm --filter @koko/deeply-library-server start
# 推荐 pm2 守护:
pm2 start server.mjs --name deeply-library --update-env
```

记得把 `library-pool.json` 部署到一起,或者通过 `LIBRARY_POOL_PATH` 指向
某个共享卷。
