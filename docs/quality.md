# 验证范围与已知限制

自动验证在独立数据库、临时目录和测试账号中执行。测试通过说明对应场景有证据，不代表第三方服务、真实收费或部署环境已经完成验收。发布时以目标提交的 [Verify application 工作流](https://github.com/Crystalclear9/OutdoorsWeb/actions/workflows/verify.yml)为准。

## 验证范围

临时 Pages 身份展示另由 `tests/showcase/pages.showcase.js` 检查静态子路径、企业、管理员、游客三种身份、手机及桌面、审批结果共享、申报及公告、重置与零 API 请求。`showcase-gate.test.mjs` 和 `tests/production.spec.js` 检查普通构建不可启用展示身份。这些样本交互不替代真实服务验收，见[临时演示说明](temporary-showcase.md)。

`tests/showcase/review-gaps.showcase.js` 检查演示审批人筛选、过期待审的身份差异、损坏状态恢复、北京时间的申请及日志日期筛选，以及只读日历。静态测试构建独立输出 `tmp/showcase-build`，不覆盖普通服务的 `dist`。

| 范围                                             | 主要证据                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 工作台状态直达及设计图失败恢复                   | `tests/dashboard-status-navigation.spec.js`、`tests/booking-design-recovery.spec.js`，真实数据筛选、图片503及200损坏、重试和单次审批 |
| 固定地点、搭建方校验、并发内容审核与过期身份差异 | `server/tests/content-review.test.mjs`、`tests/content-expiry.spec.js`、`tests/accounts.spec.js`                                     |
| 认证、验证码、MFA 与会话撤销                     | `server/tests/api.test.mjs`、`session-rotation.test.mjs`、`challenge-concurrency.test.mjs`、`captcha-capacity.test.mjs`              |
| 跨来源、新挑战和多服务的 MFA 账号限流            | `server/tests/mfa-account-limit.test.mjs`                                                                                            |
| MFA 登记前撤销本人设备的 CSRF 与归属             | `server/tests/admin-mfa-sessions.test.mjs`                                                                                           |
| 设备撤销后读取失败与原位恢复                     | `tests/session-state-recovery.spec.js`，真实双设备登录、撤销生效及纯读恢复                                                           |
| 通知查询失败门禁与核实冲突提示保留               | `tests/delivery-query-recovery.spec.js`，独立数据库与真实登录、核实写入和版本冲突                                                    |
| 企业归属、职责授权及写入时重新鉴权               | `server/tests/permissions.test.mjs`、`security-review.test.mjs`、`business-recheck.test.mjs`                                         |
| 历史同位竞争、版本冲突、幂等及跨午夜             | `server/tests/multiprocess.test.mjs`、`version-guard.test.mjs`、`commit-date.test.mjs`                                               |
| 日志筛选、失败恢复与导出内容一致性               | `tests/audit-export-consistency.spec.js`                                                                                             |
| 审计归档读取失败恢复与分页下载一致性             | `tests/archive-state-recovery.spec.js`，真实登录、归档分页及下载内容校验                                                             |
| 账号回写代次、改密互斥及失败重试                 | `tests/account-session-boundaries.spec.js`                                                                                           |
| 通知偏好保存一致性、绑定互斥及读取恢复           | `tests/identity-preference-saving.spec.js`，隔离通信适配器、实际注册与绑定及真实偏好写入                                             |
| 初次申请提交字段互斥、失败保留与真实重试         | `tests/booking-form-saving.spec.js`                                                                                                  |
| MFA 状态读取与账号同步失败恢复                   | `tests/mfa-state-recovery.spec.js`，实际启用及一次性恢复码保留                                                                       |
| 首次验证码 Cookie 迟到与页面重开                 | `tests/captcha-cookie-order.spec.js`，独立转发真实接口并实际登录                                                                     |
| 账号查询失败后暂停敏感操作及恢复目标核对         | `tests/account-query-recovery.spec.js`                                                                                               |
| 授权读取恢复及一次性临时密码保留                 | `tests/access-state-recovery.spec.js`，真实密码重置、读取故障及不重复写入的恢复                                                      |
| 维护轮询先后顺序及慢网下的状态更新               | `tests/operations-poll-order.spec.js`                                                                                                |
| 审批队列查询失败、操作门禁与草稿恢复             | `tests/review-query-consistency.spec.js`                                                                                             |
| 通信结果不确定、旧任务升级与人工核实             | `server/tests/delivery-outcomes.test.mjs`、`delivery-upgrade.test.mjs`、`delivery-concurrency.test.mjs`                              |
| 备份配对、恢复与发布竞争                         | `server/tests/backup-key-pairing.test.mjs`、`backup-publication.test.mjs`、`restore-publication.test.mjs`                            |
| 备份及恢复拒绝旧 SQLite 辅助文件与迟到 WAL       | `server/tests/restore-sidecars.test.mjs`、`backup-sidecars.test.mjs`，包含真实旧 WAL 和发布期间竞争                                  |
| 异机上传拒绝、中断及文件流释放                   | `server/tests/offsite-streams.test.mjs`，本地 HTTP 服务与真实 S3 客户端                                                              |
| 健康、维护失败、关闭排空及容量限制               | `server/tests/ops-review.test.mjs`、`lifecycle.test.mjs`、`runtime.test.mjs`                                                         |
| 低空间临时文件回收与并发告警                     | `server/tests/backup-temp-cleanup.test.mjs`、`alert-concurrency.test.mjs`                                                            |
| 短信输入类型和外发副作用边界                     | `server/tests/sms-input.test.mjs`                                                                                                    |
| 慢网、迟到响应、保存互斥与失败恢复               | `tests/auth-navigation.spec.js`、`dialog-saving.spec.js`、`requirements.spec.js`、`public-data-isolation.spec.js`                    |
| 桌面与手机排版                                   | `tests/visual/interface.visual.js`，Windows 与固定 Linux 浏览器分别比较基线                                                          |
| 容器运行与持久化                                 | `scripts/docker-smoke.mjs`，替换容器后核验账号、申请、设计图及 MFA                                                                   |

测试入口、环境隔离与视觉基线操作见[开发与测试](development.md)。代码变更历史见 [Git 提交](https://github.com/Crystalclear9/OutdoorsWeb/commits/main/)及[变更记录](../CHANGELOG.md)。

## 已知限制

- **维护协调**：维护租约固定一小时，尚无续期和整个工作进程的执行时限。超长或挂起任务需要运维处置；改进需要同时覆盖任务终止、退出确认和租约协调。
- **身份核验**：邮箱仅作为登录名，未验证所有权；企业名称及联系资料不等于企业真实性核验。密码恢复由管理员核验身份后处理。
- **外部接入**：短信、电话、QQ/微信、S3 和告警需要服务凭据、回调与真实联调。服务商受理不等于实际送达，流水提交不等于到账。
- **部署范围**：SQLite 用于单机或多个进程共享同一本地数据库文件。多主机独立数据卷不能保证全局互斥，不建议使用网络文件系统共享 SQLite。
- **数据增长**：深 OFFSET 分页、模糊搜索、统计和归档应按实际查询计划及目标机器延迟优化。合成压测不构成容量承诺。
- **前端体积**：部分管理页面仍随主包加载；可按访问频率继续拆包。办理模块已支持延迟加载与局部失败恢复。
- **运营责任**：设计判断、电话接通、收费依据、实际收款及退款由机构人员核实。系统不连接银行自动扣款或部分退款。
- **基础设施**：公网 HTTPS、入口限流、密钥保管、独立日志留存和恢复演练需要部署与运营配置。

## 发布验收

检查目标提交 CI、备份及匹配密钥、升级回滚路径；以独立企业、审核和财务账号核验完整办理。外部通信实际发送并核对回执，异机备份下载、解密并恢复真实副本。按[发布与交接清单](release-checklist.md)记录责任人与结果。

[文档目录](README.md)
