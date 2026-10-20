# 华中科技大学户外广场企业布展预约系统

第一版前后端实现：React 界面、Node.js 24 API、SQLite 数据库。账号、申请、设计图、审核、公告、场地安排和操作日志全部保存在服务端。不再使用身份切换、本机模拟申请或预置企业数据。

## Docker 启动

需要已启动的 Docker Desktop（Linux containers）或 Docker Engine + Compose。

1. 将 `.env.example` 复制为 `.env`：Windows 执行 `Copy-Item .env.example .env`，Linux/macOS 执行 `cp .env.example .env`。
2. 编辑 `.env`，设置管理员 `ADMIN_EMAIL` 和独立的 `ADMIN_PASSWORD`。密码需为 10–128 位并包含英文字母和数字。程序拒绝示例密码占位符。不要提交 `.env`。
3. 执行：

   ```powershell
   docker compose up --build -d
   ```

4. 访问 **http://localhost:8080**。管理员使用配置的邮箱和密码登录；企业在“登录 / 注册”中创建账号。

数据库和图片保存在 `app-data` 持久卷。重建镜像或 `docker compose down` 不清除数据。请勿使用删除卷的选项，除非已备份且确定要清空业务数据。在 `.env` 设置 `APP_PORT` 可更换访问端口。

```powershell
docker compose ps
docker compose logs --tail=100 app
```

公网运行请配置 HTTPS 反向代理，并设置 `COOKIE_SECURE=true`。默认 HTTP 配置供本机运行。正式服务推荐通过同一域名提供页面与 API。

## 账号与业务

- 企业：注册、登录、退出、资料维护、修改密码；修改密码后全部设备会话失效。
- 管理员：服务端配置创建；普通注册无法取得管理员权限。支持查看账号、启停企业账号和重置密码。临时密码只显示一次，登录后强制修改。
- 恢复密码：由管理员核验身份后重置。本版不发送验证邮件，也没有无验证的自助重置入口。
- 申报：最长 3 天（含起止日期）、29 个桁架位、3 MB 以内 JPG/PNG/WebP 设计图；待审核申请可撤回，未通过后可重新申报。
- 审核：查看完整申请与原图，通过/退回，退回原因必填；事务确保冲突时段不能重复通过。
- 隔离：企业只可查看自己的申请和图片；游客只看到公共场地信息与公告。
- 场地：日期查询、分布图/列表、区域筛选、暂停/恢复开放；已有预约的时段不能关闭。
- 公告：发布、编辑、置顶、删除，公开阅读。
- 日志：记录账号与业务操作，管理端查看最近 100 次记录。

邮箱是登录名，**本版不验证邮箱所有权**。手机号用于人工联系，尚未接入短信、QQ/微信授权或自动电话通知。审核结果以系统申请记录为准。场地布局为参考 PDF 绘制的示意图，具体位置以现场为准。

## 本地开发

Node.js **24 或更高版本**，数据库使用内置 `node:sqlite`。先配置 `.env`，然后：

```powershell
npm ci
npm run dev
```

前端：http://127.0.0.1:5173 ，API：http://127.0.0.1:3001 。开发时 Vite 代理 `/api`。如果端口被旧服务占用，请先停止旧进程。

编译并运行完整服务：

```powershell
npm run build
npm start
```

访问 http://localhost:3001 。`npm run preview` 仅预览静态页面，不提供账号 API。

## 管理员恢复与备份

管理员在首次启动时创建，后续更改环境变量不会自动覆盖已设置的密码。忘记管理员密码时，先修改 `.env` 的管理员配置，再显式执行：

```powershell
docker compose run --rm app node server/admin.mjs
```

该操作更新管理员密码并撤销其全部会话，不会把已注册企业提升为管理员。非 Docker 环境执行 `npm run admin:recover`。

在线一致性备份：

```powershell
docker compose exec app node server/backup.mjs /app/data/backups/manual.sqlite
docker compose cp app:/app/data/backups/manual.sqlite ./backup.sqlite
```

备份使用 SQLite `VACUUM INTO`，包含账号、申请和图片。目标文件必须尚不存在，每次备份请更换文件名。不要仅复制运行中的 SQLite 主文件，WAL 中可能仍有未合并数据。

恢复前先停止应用并备份原卷。由运维人员通过临时容器替换卷内数据库，并处理相应 WAL/SHM 文件后再启动。不要将任何业务数据库提交到仓库。

## GitHub Pages

https://crystalclear9.github.io/OutdoorsWeb/ 保留为静态前端入口。**Pages 不能运行 Node.js API 或数据库，无法独立提供真实账号服务。** 未连接后端时，页面明确提示、禁用申请提交，不显示模拟占用数据。账号及业务操作请使用 Docker 完整服务地址。

`npm run build` 生成 `dist/`，并将编译后的 `index.html` 和 `assets/` 同步至仓库根目录，适配目前 `main / (root)` 的 Pages 发布设置。源入口为 `src/index.html`，静态资源使用相对路径，兼容 `/OutdoorsWeb/`。

`VITE_API_BASE_URL` 可在编译时指定 API 地址，但推荐 Docker 同域运行。会话 Cookie 使用 SameSite=Lax，不能把跨站 Pages + API 直接视为正式同域服务。

## 验证

```powershell
npm run build
npm test
```

接口测试覆盖注册、登录、角色限制、密码哈希、CSRF、会话撤销、临时密码、数据隔离、上传与日期校验、并发审核、公告、场地安排、频率限制和持久化。浏览器测试覆盖真实跨账号申报审批、账号资料与密码、管理功能、手机端和 Pages 的未连接状态。

浏览器测试使用独立临时数据库，不写入正式数据库。默认使用本机 Edge。其他系统可设置 `PLAYWRIGHT_CHANNEL=chromium` 并先执行 `npx playwright install chromium`。

## 项目结构

- `src/`：React 界面，Radix Dialog 提供焦点和键盘交互。
- `server/`：HTTP API、SQLite、密码与会话、备份和管理员恢复。
- `server/tests/`：接口与权限测试。
- `tests/`：浏览器和静态发布测试。
- `Dockerfile`、`compose.yaml`：非 root 容器、健康检查、持久卷。

密码使用随机盐 scrypt 哈希；HttpOnly Cookie 会话令牌在数据库中仅保存摘要。认证写入检查来源与 CSRF。登录和注册设有频率限制，图片检查大小、类型和文件头。实际使用时请根据校方要求完成域名、HTTPS、备份、隐私告知与运维配置。
