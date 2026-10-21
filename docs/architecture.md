# 项目结构

## 目录归属

| 路径                                        | 内容                                         | 是否提交       |
| ------------------------------------------- | -------------------------------------------- | -------------- |
| `src/`                                      | React 源码、样式、HTML 源入口及场地底图      | 是             |
| `server/`                                   | HTTP API、认证、SQLite、业务、维护和恢复工具 | 是             |
| `shared/`                                   | 前后端共用的权限定义                         | 是             |
| `scripts/`                                  | 构建后同步 Pages 与隔离压测脚本              | 是             |
| `server/tests/`                             | 后端、事务、权限、恢复及独立进程测试         | 是             |
| `tests/`                                    | 浏览器测试与隔离服务入口                     | 是             |
| `tests/visual/snapshots/`                   | Windows / Linux 的桌面及手机视觉基线         | 是             |
| `docs/`                                     | 使用、配置、开发和运维文档                   | 是             |
| `.github/workflows/`                        | 持续集成配置                                 | 是             |
| 根目录 `index.html`、`assets/`、`.nojekyll` | `main / (root)` 的 Pages 发布入口            | 是，由构建同步 |
| `dist/`                                     | 本地和 Docker 使用的构建结果                 | 否             |
| `node_modules/`                             | 依赖安装结果                                 | 否             |
| `test-results/`、`playwright-report/`       | 测试运行结果                                 | 否             |
| `tmp/`                                      | 临时截图、压测报告和诊断文件                 | 否             |
| `data/`、`backups/`、`.env`                 | 业务数据、备份、密钥及本机配置               | 否             |

根目录发布文件不等于第二份源码。修改 `src/` 后执行 `npm run build`，由 `scripts/sync-pages.mjs` 同步入口并移除旧的哈希脚本和样式。不要手工修改哈希文件，也不要将根目录发布资源移到其他位置而不同时修改 Pages 发布方式。

`tmp/` 中既可能有可重建的截图，也可能有本机测试状态和参考材料；不要将它整体提交或用宽泛的清理命令处理。业务卷、数据库、备份、配置及 `.mfa-key` 不属于可随意清理的构建缓存。中间文件目录按需生成，不要求在干净工作区中始终存在；清理范围与重建方法见[开发指南](development.md#清理本地中间文件)。

## 字体与校名素材

校园风格界面合自 `codex/campus-venue-redesign`（`86910b3`）。校名字样位于 `src/assets/hust-signature.png`；标题使用本地 `src/assets/fonts/CampusHeading-Medium.woff2`，授权保留在同目录 `OFL.txt`，并通过 `src/public/assets/CampusHeading-OFL.txt` 随构建发布。

常规构建直接使用已提交的字体，不需要额外下载或 Python 依赖。需要重新生成标题子集时，安装 `fonttools` 与 `brotli`，将 LXGW WenKai Medium v1.530 原字体路径传给 `python scripts/prepare-heading-font.py <字体路径>`；修改后的字体使用 Campus Heading 名称，并保留原授权。

合并保留主分支的真实 API、业务逻辑和依赖，不接入重设计分支的身份预览功能。

## 后端模块

| 文件                                                         | 职责                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `index.mjs`、`app.mjs`                                       | 启动关闭、HTTP 边界、静态文件、来源校验和异常响应  |
| `api.mjs`、`business.mjs`                                    | 预约审批、账号管理、公告、现场登记、查询和操作记录 |
| `casework.mjs`                                               | 工作日历、反馈时限、电话跟进与线下费用状态流转     |
| `core.mjs`                                                   | 身份与权限检查、事务、参数校验、图片解码           |
| `security.mjs`、`work-queue.mjs`                             | 密码散列、令牌摘要及受限密码任务队列               |
| `captcha.mjs`、`mfa.mjs`、`external-registration.mjs`        | 图片验证码、两步验证、首次快捷注册                 |
| `integrations.mjs`、`delivery.mjs`、`readiness.mjs`          | 第三方登录、手机号验证、通知队列及配置诊断         |
| `store.mjs`                                                  | 数据表、索引、约束与保留数据的增量迁移             |
| `maintenance.mjs`、`maintenance-worker.mjs`                  | 维护调度、租约、健康检查、清理、归档和自动备份     |
| `backup.mjs`、`backup-key.mjs`、`offsite.mjs`、`restore.mjs` | 一致性快照、加密异机备份和恢复                     |
| `compact.mjs`、`compaction.mjs`                              | 离线空间回收及压缩前安全快照                       |
| `admin.mjs`、`monitor.mjs`、`proxy.mjs`                      | 管理员恢复、独立监控和可信代理来源识别             |

后端源文件保持现有入口路径，供 npm 脚本、Docker 和维护命令使用。数据库结构版本为 7，迁移不自动重置业务记录或已有密码。

## 前端入口

`src/main.jsx` 挂载应用，`App.jsx` 管理登录状态、导航与公共场地数据。`components.jsx` 提供通用组件及账号页面；申请、审批台、现场登记、公告、授权和维护使用各自页面模块。`api.js` 封装请求与会话失效处理，`shared/permissions.js` 供两端统一判断业务权限。

`src/Casework.jsx` 按需加载，提供独立办理页和申请详情中的记录面板；与 `server/casework.mjs` 对接。审核权限负责电话结果，独立 `payments.manage` 权限负责核款，超级管理员负责日历。`src/AccessCode.jsx` 在使用指南内生成公开入口二维码。

构建会生成主入口与办理模块等哈希分包。`scripts/sync-pages.mjs` 同步当前产物并清理过期的哈希 JS/CSS；根目录 `assets/` 与 `dist/assets/` 中当前资源应一致。正式字体、底图和授权随构建发布，不属于诊断截图。

`src/assets/venue-plan.png` 保存需求 PDF 的场地原图，`src/venue-layout.js` 定义五段共 29 个交互位置。来源和编号规则见[使用指南](user-guide.md#场地底图与编号)。

[返回项目首页](../README.md) · [文档目录](README.md)
