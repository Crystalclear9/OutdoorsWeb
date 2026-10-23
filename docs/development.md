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

`tests/browser-fixtures.js` 为默认测试浏览器上下文分配独立来源标识；仅隔离入口 `tests/start-server.mjs` 信任本机测试代理，避免整套回归共同耗尽单个来源的验证码额度。正式服务的限流和可信代理设置不变，接口测试仍检查限流与伪造转发头边界。不要并行启动多个使用同一 `test-results/` 的 Playwright 进程；需要分批时等待前一批完整退出。

PowerShell 使用 `$env:PLAYWRIGHT_CHANNEL="chromium"` 设置环境变量；Linux/macOS 可执行 `PLAYWRIGHT_CHANNEL=chromium npm run test:e2e`。无系统依赖的 Linux 主机可先执行 `npx playwright install --with-deps chromium`。

2026-10-22 全量需求验收补齐遗漏后，本地 103 项后端、47 项浏览器测试，以及 2 项桌面/手机视觉回归均通过；构建通过，隔离压测 1000 次读取无错误，32 条同位竞争审批只有一次成功。前端只扩展申请历史筛选，默认审批台及正式视觉基线未改。本轮新增完整 Docker 运行验收，实际容器结果以对应 CI 为准，本机 Linux Docker engine 未启动，不宣称在本机已验收。此前 `57a56c5` 的[远程工作流](https://github.com/Crystalclear9/OutdoorsWeb/actions/runs/39593055304)保留作历史证据。此前依赖审计记录不能作为持续有效的漏洞承诺。

新增回归覆盖游客现场状态及隐私、入口二维码、设计图异步读取竞争、非法换图清除旧图，以及现场登记冲突后重读失败的输入保留。另覆盖工作日历、电话跟进、独立财务权限、并发核款、取消退款与版本七迁移。测试数量会随代码增加，以实际输出为准。

| 重点流程                             | 验证位置                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| 真实账号、申请、审批、公告和授权界面 | `tests/accounts.spec.js`                                       |
| 电话与财务权限、并发核款、日历和迁移 | `server/tests/casework.test.mjs`                               |
| 企业—财务—管理员完整办理与取消退款   | `tests/casework.spec.js`                                       |
| 现场登记、改期与两步验证             | `server/tests/completion.test.mjs`、`tests/completion.spec.js` |
| 入口二维码、换图竞争和现场冲突异常   | `tests/requirements.spec.js`                                   |

上一轮审计回归：`server/tests/backup-audit.test.mjs`、`casework-audit.test.mjs`、`http-boundary.test.mjs`；浏览器侧为 `tests/venue-loading.spec.js`、`auth-navigation.spec.js` 和 `dialog-saving.spec.js`，分别覆盖密钥恢复、角色待办/退款通知、跨源预检、慢网旧数据、认证互斥及保存弹窗。

第二轮新增 `server/tests/security-review.test.mjs`、`product-review.test.mjs`、`ops-review.test.mjs` 共 7 项回归，覆盖财务最少数据权限、取消后到账、电话纠错及维护锁/进程异常。新增 `tests/product-review.spec.js`、`case-draft.spec.js`、`notification-target.spec.js` 共 4 项浏览器回归；财务消息定位使用真实跨账号业务，刷新失败、翻页及日历重试使用隔离响应模拟。

第三轮新增 `server/tests/version-guard.test.mjs`、`business-recheck.test.mjs`、`delivery-validity.test.mjs` 共 5 项后端回归，覆盖强制版本、改期磁盘保护、无效队列关闭和收件人隐私。旧测试明确传入实际版本，不在助手中自动猜版本；通信测试使用真实预约关系和隔离发送器，未向真实手机发送。审计范围和修正见[项目复核](project-audit.md)，交接步骤见[全流程清单](release-checklist.md)。

第四轮新增 `server/tests/automatic-backup.test.mjs`（3 项）、`delivery-concurrency.test.mjs`（2 项）、`session-rotation.test.mjs`（3 项）：分别验证自动备份发布故障和有效轮换、人工核实后的迟到通知响应，以及密码/短信/OAuth/注册/MFA 的当前浏览器会话替换。故障注入与发送器只在隔离测试中使用。

本次全量需求验收新增 `server/tests/approval-finance.test.mjs`（3 项）、`history-filters.test.mjs`（2 项）和 `tests/history-filters.spec.js`（2 项），覆盖财务新待办、北京时间首尾日期、历史停用审批人、归属权限、无效条件与手机布局。筛选异常界面采用隔离响应模拟；日期和权限另由真实 API 回归验证。

2026-10-23 架构复核新增 `server/tests/client-transport.test.mjs`（4 项）、`lifecycle.test.mjs`（5 项）和 `query-indexes.test.mjs`（2 项）：分别覆盖响应体中断、调用者取消、关闭排空及断连、旧库增量索引和真实查询计划。浏览器新增 `tests/public-data-isolation.spec.js`（3 项）和 `lazy-page-recovery.spec.js`（1 项），验证公告和场地故障双向隔离、实际发布申报、旧分包失效时局部恢复。不会为测试放宽正式接口的验证码、权限或版本检查。

本轮本地最终通过 **114 项后端与传输、51 项浏览器、2 项桌面/手机视觉测试**；构建通过但主包仍约 502 kB（gzip 149 kB），Vite 的体积提示保留。生产依赖审计本次为 0 漏洞，不代表今后持续无漏洞。隔离压测 32 个客户端、1000 次读取无错误，32 条同位审批一次成功、31 次冲突；仅代表同机合成样本。Docker 镜像、持久化和 Linux 视觉结果仍以当前提交 CI 为准。

再次复核新增 `tests/logout-navigation.spec.js` 两项，覆盖两个退出入口的互斥、失败重试、重新登录刷新，以及退出已经撤销会话但响应仍延迟时的其他 401。正式退出接口及 Cookie 策略保持不变。

再次复核最终本地通过 114 项后端与传输、53 项浏览器和 2 项视觉测试，构建、生产依赖审计及隔离压测通过；本次只修正前端退出交互。

## 完整 Docker 镜像验收

```sh
docker build -t outdoorsweb:verify .
npm run test:docker
```

需要运行中的 Linux Docker engine。脚本不读正式 `.env`，使用 UUID 容器和卷，检查非 root、健康、页面资源、首次管理员 MFA 门禁、企业申报审批、容器替换后的会话/申请/设计图，以及原密码和 MFA 密钥保留。最后只清理本次资源。为在真实镜像中稳定认证，仅对隔离卷内本条验证码挑战设置已知答案；仍使用正式 API 的浏览器绑定、过期和单次消费逻辑，生产镜像没有免验证码入口。验证码生成与抗重放由专门 API 回归覆盖，此 smoke 不宣称识别了随机验证码图片。

CI 在镜像构建后执行此项，整体上限 25 分钟、构建 10 分钟、smoke 5 分钟。引擎未启动时脚本明确失败，不跳过并假报通过。此项验证镜像和持久化，不能替代真实服务账号、目标主机或异机灾备验收。

## 直接调用写接口

先读取申请或账号的 `version`，使用带双引号的 `If-Match: "1"`（以实际版本替换 1）。审核、撤回、停启用和重置密码现在都强制要求；缺失 428、格式错误 400、过期 409。遇到冲突先重读并由操作者核对，不要自动获取新版本后重放旧决定。批量审核使用每条 `items[].version`，不能省略。会话、来源和 CSRF 校验仍须同时通过。

## 清理本地中间文件

清理前停止本地开发服务及测试进程，并确认命令在项目根目录执行。以下目录可按需清理：

| 路径                                              | 内容与重建方式                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `dist/`                                           | 编译结果；执行 `npm run build` 重建，之后才能用 `npm start` 或 `npm run preview` 访问页面 |
| `test-results/`、`playwright-report/`             | 测试结果及诊断报告，下次测试重新生成                                                      |
| `node_modules/.vite/`、`node_modules/.vite-temp/` | Vite 缓存和临时配置，下次开发或构建重新生成                                               |
| `tmp/` 中确认过的诊断产物                         | 旧截图、压测报告、一次性检查脚本和测试会话状态；按需重新运行对应检查                      |
| `tmp/pdfs/` 中的提取产物                          | 仅在需求原 PDF 仍可访问、正式场地底图已保存在 `src/assets/venue-plan.png` 时清理          |

先查看目标目录内容，再按明确路径删除；不要直接执行 `git clean -fdx` 或删除全部忽略文件。`tmp/` 未来可能包含新参考资料，需要每次核对，不能无条件整目录清空。已删除的截图和旧报告不会随文档更新自动恢复。

2026-10-21 本次整理先逐项核对路径及内容，再清理 `tmp/`、`test-results/` 中共 22 个可重建截图、压测和测试诊断文件（约 2.3 MB），以及空的 `node_modules/.vite-temp/`。当时 `tmp/pdfs/` 已无提取文件，没有新的参考资料；后续不能据此直接清空新生成的 `tmp/`。

同日第二轮专家复核完成后，再逐项清理本轮重建的 21 个截图、压测报告及测试状态文件（约 2.2 MB），移除其空目录和空的 Vite 临时目录；保留当前构建及正式视觉基线。后续测试会重新生成这些诊断产物。

当前 `dist/` 构建、根目录 Pages 发布文件、源码、字体及授权、`tests/visual/snapshots/`、依赖和项目外的需求原 PDF 均保留。业务数据库、备份、`.env`、MFA 密钥及 Docker 持久卷不在清理范围内。后续构建或测试会按需重新生成缓存和诊断目录。

```powershell
# 清理构建结果后，重新运行完整服务
npm run build
npm start
```

清理不修改服务端业务记录，也不代替[数据库空间维护](operations.md#旧库离线压缩与空间回收)。

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
| `npm run test:docker`                                  | 运行隔离完整镜像与重启持久化验收         |
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
