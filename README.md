# 乡村文旅 AI 规划与资源申报平台

这是一个面向乡村文旅场景的双站点项目，包含主站和申报副站。

- `main-site`：乡村文旅 AI 规划主站，支持村镇库、路线生成、预算估算、资源匹配和申报数据同步。
- `submission-portal`：村镇资源申报副站，公开页用于填写申报，审核台用于本地审核后再同步到主站。

## 本地运行

主站：

```powershell
cd main-site
copy .env.example .env
npm start
```

访问：`http://127.0.0.1:5174/`

申报副站：

```powershell
cd submission-portal
copy .env.example .env
npm start
```

公开申报页：`http://127.0.0.1:5184/`

本地审核台：`http://127.0.0.1:5184/admin.html`

## 环境变量

请把真实密钥写入本地 `.env`，不要提交到 GitHub。

- `DEEPSEEK_API_KEY`：AI 生成路线与目的地画像。
- `AMAP_API_KEY`：高德 Web 服务，用于路线、距离和地图能力。
- `SUBMISSION_ADMIN_TOKEN` / `ADMIN_TOKEN`：申报副站审核口令。

## 数据说明

SQLite 数据库、运行日志和上传图片属于本地运行产物，已通过 `.gitignore` 排除。服务启动后会自动创建本地数据库。

## Vercel 部署

这个仓库是双站点结构，建议在 Vercel 中创建两个 Project，均从同一个 GitHub 仓库导入：

1. 主站 Project
   - Root Directory：`main-site`
   - Framework Preset：Other
   - Production Branch：`master`
   - 环境变量：`DEEPSEEK_API_KEY`、`AMAP_API_KEY`、`SUBMISSION_PORTAL_URL`、`SUBMISSION_ADMIN_TOKEN`

2. 申报副站 Project
   - Root Directory：`submission-portal`
   - Framework Preset：Other
   - Production Branch：`master`
   - 环境变量：`ADMIN_TOKEN`

Vercel 会识别每个目录根部的 `server.js` 作为 Node.js HTTP server。线上 SQLite 会使用临时目录，适合作品展示和功能演示；如果要长期收集真实申报数据，建议后续替换为 Vercel Postgres、Supabase 或其他云数据库。

## 主要功能

- 按出行天数、预算、人群、体验偏好生成乡村文旅路线。
- 支持用户在补充需求中输入未入库目的地，系统生成待核验村镇画像并沉淀到村镇库。
- 村镇库展示参考地址、交通节点、体验亮点、资源和点位。
- 申报副站形成“公开申报 -> 本地审核 -> 主站同步入库”的闭环。
- 审核接口需要本地口令，避免公开申报者自行审批。
