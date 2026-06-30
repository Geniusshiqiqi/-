# 乡村文旅资源入库申报副站

这是服务主站 `乡村文旅AI` 的独立副网站，用于让村镇、经营主体或调研对象提交乡村文旅资料。

## 本地运行

```powershell
cd D:\乡村文旅申报入口
npm start
```

访问：

```text
公开申报页：http://127.0.0.1:5184/
本地审核台：http://127.0.0.1:5184/admin.html
```

审核台需要本地口令，请在启动服务前设置 `ADMIN_TOKEN` 或 `SUBMISSION_ADMIN_TOKEN`。未设置时本地默认口令为 `local-review`，仅用于课程演示和本机开发。

## 数据位置

- 申报数据库：`D:\乡村文旅申报入口\data\submissions.sqlite`
- 上传图片：`D:\乡村文旅申报入口\uploads`
- 本地图标库：`D:\乡村文旅申报入口\vendor\lucide\lucide.min.js`

## 核心接口

- `POST /api/submissions`：提交申报表和图片
- `GET /api/stats`：公开统计，不返回联系人和申报详情
- `GET /api/submissions`：查看申报记录，需要 `x-admin-token`
- `POST /api/submissions/:id/status`：更新审核状态，需要 `x-admin-token`，支持 `pending`、`approved`、`rejected`、`imported`
- `GET /api/export/approved`：导出审核通过的数据，需要 `x-admin-token`，格式包含 `villages` 和 `resources`，可供主站导入

## 与主站形成闭环

1. 主站按钮 `村镇自荐入口` 跳转到公开申报页
2. 点击跳转到 `http://127.0.0.1:5184/`
3. 村镇提交资料，副站写入待审核库
4. 管理者进入 `http://127.0.0.1:5184/admin.html` 输入本地口令审核
5. 主站同步审核通过数据，将 `villages` 写入村镇库，将 `resources` 写入资源匹配库

公开展示前建议继续保留人工审核，避免虚假信息、联系方式泄露和图片授权问题。
