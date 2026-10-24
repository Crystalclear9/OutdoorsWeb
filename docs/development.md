# 开发与测试

## 本地开发

需要 Node.js 24 或更高版本，SQLite 使用内置 `node:sqlite`。复制 `.env.example` 为 `.env` 并配置管理员，然后运行：

```sh
npm ci
npm run dev
```

前端 http://127.0.0.1:5173 ，API http://127.0.0.1:3001 ，Vite 代理 `/api`。构建后运行完整服务：

```sh
npm run build
npm start
```

访问 http://localhost:3001 。`npm run preview` 只预览静态构建，不提供账号 API。变量见[配置说明](configuration.md)。

## 验证

```sh
npm run build
npm run test:api
npm run test:e2e
npm run test:load
npm run test:visual
npm audit --omit=dev
```

构建与浏览器测试按顺序执行，避免重建 `dist/` 时访问缺失资源。后端测试覆盖权限、凭据、事务、并发、备份与清理；浏览器以真实 API 完成跨账号业务，用隔离响应模拟慢网和故障。范围见[质量说明](quality.md)，数量和结果以当前输出为准。

浏览器默认使用 Edge。Linux/macOS 可执行 `PLAYWRIGHT_CHANNEL=chromium npm run test:e2e`；PowerShell 先设置 `$env:PLAYWRIGHT_CHANNEL="chromium"`。首次使用 Chromium 执行 `npx playwright install chromium`，Linux 缺系统依赖时执行 `npx playwright install --with-deps chromium`。

测试使用独立临时数据库，不连接正式 `.env` 或业务卷。固定验证码和第三方模拟响应仅用于隔离入口。`tests/browser-fixtures.js` 为上下文分配测试来源，只有 `tests/start-server.mjs` 信任该本机代理；正式来源校验与限流不变。

不要同时启动多个使用同一 `test-results/` 的 Playwright 进程。单步断言默认 5 秒、普通场景总预算 30 秒；完整三角色费用闭环使用 60 秒，包含额外上下文的关闭，无自动重试。接口测试会重新分配被 Fetch 禁止的随机端口，绑定失败仍报错。

CI 在 Ubuntu 执行构建、后端、并发和 Chromium 浏览器回归，再验证 Docker 业务与持久化、固定环境视觉；失败诊断保留 7 天。目标提交见 [Verify application](https://github.com/Crystalclear9/OutdoorsWeb/actions/workflows/verify.yml)。依赖审计是当时结果，需要定期执行。

## Docker 验证

需要运行中的 Linux Docker engine：

```sh
docker build -t outdoorsweb:verify .
npm run test:docker
```

`scripts/docker-smoke.mjs` 创建 UUID 容器和卷，检查非 root、健康、管理员 MFA、企业申报审批及容器替换后的会话、图片和密钥。只清理本次创建的资源，不挂载正式数据目录。

固定 Linux 视觉环境：

```sh
docker run --rm -v "$PWD:/workspace" -v /workspace/node_modules -w /workspace -e PLAYWRIGHT_CHANNEL=chromium mcr.microsoft.com/playwright:v1.64.1-noble sh -c 'npm ci && npm run test:visual'
```

## 压测与视觉基线

`npm run test:load` 在临时 SQLite WAL 数据库执行 32 客户端、1000 次公开读取及 32 条同位竞争审批，要求无读取错误且仅一次批准。报告为 `tmp/load-report.json`；默认读取 P95 上限 2000 ms，可用 `LOAD_MAX_P95_MS` 调整。上线前使用目标机器和实际数据量复测。

视觉测试比较登录、现场登记和审批台的桌面/手机截图，固定时钟与种子数据，遮盖随机验证码。Windows Edge 与 Playwright 1.64.1 Noble Linux Chromium 基线分别在 `tests/visual/snapshots/`；任一截图差异均导致失败，软断言仅用于收集完整诊断。

只有有意修改界面并逐张核对后才执行 `npm run test:visual -- --update-snapshots`。不要用更新基线或扩大容差掩盖布局问题。

## GitHub Pages 与字体

[Pages 入口](https://crystalclear9.github.io/OutdoorsWeb/)只提供静态页面；账号与预约需要 Node API 和 SQLite。`VITE_API_BASE_URL` 可在编译时指定 API，正式服务推荐 Docker 同域；跨站 Cookie 不能视为默认可用。

源码入口为 `src/index.html`。构建生成 `dist/`，同步根目录 `index.html`、`assets/`，Pages 使用 `main / (root)`。同步跳过字节相同的文件，避免 Windows 已加载字体重复覆盖，清理旧哈希脚本和样式。不要手工修改哈希产物。

界面字体 Campus Sans 来源于思源黑体 CN 2.005R，许可在 `src/assets/fonts/source-han/LICENSE.txt`。常规构建无需下载字体；安装 `fonttools`、`brotli` 后用 `python scripts/prepare-ui-font.py <原字体路径>` 重建分包。`src/fonts.css` 是生成文件，`src/typography.css` 管理排版，完整字形通过 `unicode-range` 按需加载。

## 清理本地中间文件

先核对内容和绝对路径，再删除可重建文件。不要执行 `git clean -fdx` 或整目录清除忽略文件。

| 路径                                              | 内容与恢复方式                                     |
| ------------------------------------------------- | -------------------------------------------------- |
| `dist/`                                           | 构建产物，`npm run build` 重建；运行服务前需要存在 |
| `test-results/`、`playwright-report/`             | 测试诊断，下次测试生成                             |
| `node_modules/.vite/`、`node_modules/.vite-temp/` | Vite 缓存，下次开发或构建生成                      |
| `tmp/` 中已确认的截图、日志、报告                 | 可重建诊断；逐项确认，可能同时包含参考材料         |
| Docker 测试镜像、测试依赖卷及构建缓存             | 可重新构建或拉取，先确认无引用且不含业务数据       |

保留 `data/`、`backups/`、`.env`、数据库、`.mfa-key`、正式 Docker 数据卷、源码字体及视觉基线。不要删除 Docker 数据盘或其他项目资源。Docker 存储盘不一定随镜像删除立即缩小，见[运行维护](operations.md#docker-存储清理)。

## 常用命令

| 命令                                                   | 用途                        |
| ------------------------------------------------------ | --------------------------- |
| `npm run dev` / `npm run dev:web`                      | 完整开发环境 / 仅前端       |
| `npm run build` / `npm start`                          | 构建并同步 Pages / 完整服务 |
| `npm test`                                             | 顺序执行后端与浏览器测试    |
| `npm run test:api` / `npm run test:e2e`                | 后端 / 浏览器回归           |
| `npm run test:visual` / `npm run test:load`            | 视觉 / 隔离并发检查         |
| `npm run test:docker`                                  | Docker 业务与持久化检查     |
| `npm run backup -- <新目标路径>`                       | 一致性备份和配套密钥        |
| `npm run compact -- --offline`                         | 停服务后离线回收数据库空间  |
| `npm run restore:encrypted -- <加密备份> <新目标路径>` | 恢复异机备份                |
| `npm run admin:recover` / `npm run monitor`            | 管理员恢复 / 独立监控       |

维护命令的前置条件见[运行维护](operations.md)及[外部接入](integrations.md)。

[文档目录](README.md)
