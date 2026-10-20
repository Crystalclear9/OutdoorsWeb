# 开发与测试

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

## 验证

```powershell
npm run build
npm test
npm run test:load
npm run test:visual
```

接口测试覆盖验证码过期/错误/跨浏览器使用/并发重放、代理来源识别、注册登录与权限、跨账号隔离、独立进程竞争审批、取消释放位置、通知隔离、日志分页、备份恢复、清理边界、维护失败和健康检查等。备份测试会将生成的备份复制为独立数据库，检查账号、申请和图片恢复。浏览器测试覆盖真实跨账号申报审批、验证码交互、取消预约、通知、维护界面、日志导出、手机端和 Pages 的未连接状态。

浏览器测试使用独立临时数据库，不写入正式数据库。默认使用本机 Edge。其他系统可设置 `PLAYWRIGHT_CHANNEL=chromium` 并先执行 `npx playwright install chromium`。

PowerShell 使用 `$env:PLAYWRIGHT_CHANNEL="chromium"` 设置环境变量；Linux/macOS 可执行 `PLAYWRIGHT_CHANNEL=chromium npm run test:e2e`。无系统依赖的 Linux 主机可先执行 `npx playwright install --with-deps chromium`。

最近一轮为 57 项后端测试、25 项浏览器测试。新增回归覆盖畸形请求后服务继续运行、密码计算排队上限、跨进程验证次数、注册过期及旧响应覆盖新登录等情况。测试数量会随代码增加，以实际输出为准。

## 常用命令

| 命令                                                   | 用途                                     |
| ------------------------------------------------------ | ---------------------------------------- |
| `npm run dev`                                          | 同时启动监听源码的后端和 Vite            |
| `npm run dev:web`                                      | 仅启动 Vite，API 需另行运行              |
| `npm run build`                                        | 生成 `dist/` 并同步根目录 Pages 发布文件 |
| `npm start`                                            | 运行完整服务，需先构建前端               |
| `npm run preview`                                      | 仅预览静态构建                           |
| `npm run test:api`                                     | 仅运行后端测试                           |
| `npm run test:e2e`                                     | 仅运行浏览器测试                         |
| `npm test`                                             | 按顺序运行后端及浏览器测试               |
| `npm run test:load`                                    | 运行隔离压测并生成临时报告               |
| `npm run test:visual`                                  | 比较桌面和手机视觉基线                   |
| `npm run backup -- <新目标路径>`                       | 生成一致性备份及密钥副本                 |
| `npm run compact -- --offline`                         | 停服务后离线回收空间                     |
| `npm run restore:encrypted -- <加密备份> <新目标路径>` | 恢复加密异机备份                         |
| `npm run admin:recover`                                | 按 `.env` 显式恢复管理员                 |
| `npm run monitor`                                      | 运行独立健康监控，须配置告警接收方       |

维护命令会修改数据或生成敏感文件，参数和前置条件见[运行维护](operations.md)及[外部接入](integrations.md)。

CI 的 `Verify application` 在 Ubuntu 上执行依赖安装、构建、后端测试、压测、Chromium 浏览器测试、Docker 镜像构建，并在固定 Playwright 容器中执行 Linux 视觉回归。失败诊断保留 7 天。

## 压测与视觉回归

`npm run test:load` 创建独立临时数据库，32 并发执行 1000 次公共读取和 32 条同位竞争审批，检查无查询错误且仅一条批准；报告写到忽略目录 `tmp/load-report.json`。默认读取 P95 上限 2000 ms，可用 `LOAD_MAX_P95_MS` 调整。结果以本次报告为准，不代表线上机器的容量承诺；上线前用目标机器和真实数据量复测。

`npm run test:visual` 对桌面与手机的登录、现场登记、审批台进行固定截图比对。Windows Edge 与固定镜像 `mcr.microsoft.com/playwright:v1.64.1-noble` 的 Linux Chromium 分别存放基线；固定时钟和独立种子数据，遮盖随机验证码图片。CI 在同一个固定 Linux 镜像中运行，差异截图保留为失败诊断。确认有意的界面修改后才执行 `npm run test:visual -- --update-snapshots` 更新基线，不能用更新基线掩盖布局错误。

## GitHub Pages

https://crystalclear9.github.io/OutdoorsWeb/ 保留为静态前端入口。**Pages 不能运行 Node.js API 或数据库，无法独立提供真实账号服务。** 未连接后端时，页面明确提示、禁用申请提交，不显示模拟占用数据。账号及业务操作请使用 Docker 完整服务地址。

`npm run build` 生成 `dist/`，并将编译后的 `index.html` 和 `assets/` 同步至仓库根目录，适配目前 `main / (root)` 的 Pages 发布设置。源入口为 `src/index.html`，静态资源使用相对路径，兼容 `/OutdoorsWeb/`。

`VITE_API_BASE_URL` 可在编译时指定 API 地址，但推荐 Docker 同域运行。会话 Cookie 使用 SameSite=Lax，不能把跨站 Pages + API 直接视为正式同域服务。

[返回项目首页](../README.md) · [文档目录](README.md)
