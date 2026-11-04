# 验证范围与已知限制

自动验证在独立数据库、临时目录和测试账号中执行。测试通过说明对应场景有证据，不代表第三方服务、真实收费或部署环境已经完成验收。发布时以目标提交的 [Verify application 工作流](https://github.com/Crystalclear9/OutdoorsWeb/actions/workflows/verify.yml)为准。

## 验证范围

`server/tests/offsite-live-wal.test.mjs` 保持真实WAL连接和已提交数据，通过实际加密及恢复核对直接库导出的内容，并检查密钥失配、上传失败和临时文件清理。

`server/tests/saved-design-reuse.test.mjs` 使用实际小于3 MB、转换后大于3 MB的图片，检查在线及归档原图、连续草稿保存、原子提交与幂等重试，并验证跨账号拒绝、版本冲突、新上传限制和共享配额。浏览器回归见 `tests/booking-trusted-image-reuse.spec.js`，Pages 回归见 `tests/showcase/trusted-image-reuse.showcase.js`。`retention-capacity.test.mjs` 同时核对真实保留查询的主键索引计划及引用保护结果。

`tests/booking-copy-image-race.spec.js` 使用不同像素设计图验证复制时的迟到原图不会覆盖新上传内容，并检查连续退回复制的来源关联；`server/tests/reschedule-draft-quota.test.mjs` 验证普通及已归档源图改期时计入草稿配额，超额拒绝无副作用，释放空间后可重试。

`tests/font-csp.spec.js` 在真实服务响应的安全策略下检查字体加载，捕获字体策略违规及加载失败；复制图片回归同时检查未产生 Blob URL 连接策略违规。

账号绑定、归档、投递查询及公告日期的私有服务浏览器测试，在收尾时先关闭本例完整浏览器上下文，再关闭服务，释放连接池与预连接。

新增 `server/tests/maintenance-lifecycle.test.mjs`、`retention-capacity.test.mjs` 覆盖真实挂起、父进程退出、续期失效和容量/保留门禁；`drafts.test.mjs` 覆盖私有访问、重开数据库恢复、幂等及原子提交；`enterprise-verification.test.mjs` 覆盖内部依据隐私、版本冲突和资料变更复核；`review-priority.test.mjs` 覆盖临期逾时筛选和稳定排序。浏览器对应 `tests/drafts.spec.js`、`enterprise-verification.spec.js`、`review-priority.spec.js`，Pages草稿另见 `tests/showcase/drafts.showcase.js`。

`tests/dashboard-read-recovery.spec.js` 检查企业和管理员工作台首次及后续读取失败、清除旧统计、禁止将失败显示为成功空态，以及纯读恢复不产生业务写入。

临时 Pages 身份展示另由 `tests/showcase/pages.showcase.js` 检查静态子路径、企业、管理员、游客三种身份、手机及桌面、审批结果共享、申报及公告、重置与零 API 请求。`showcase-gate.test.mjs` 和 `tests/production.spec.js` 检查普通构建不可启用展示身份。这些样本交互不替代真实服务验收，见[临时演示说明](temporary-showcase.md)。

`tests/showcase/review-gaps.showcase.js` 检查演示审批人筛选、过期待审的身份差异、损坏状态恢复、北京时间的申请及日志日期筛选，以及只读日历。静态测试构建独立输出 `tmp/showcase-build`，不覆盖普通服务的 `dist`。

`tests/showcase/input-contract.showcase.js` 检查企业名称、联系人及公告标题正文仅含空格时拒绝保存，修正输入后才新增或更新；`tests/notice-beijing-date.spec.js` 使用真实公告接口和非中国时区浏览器，检查北京时间午夜前后列表及阅读详情的日期一致。

| 范围                                             | 主要证据                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 跨北京时间日期及恢复焦点后的状态核对             | `tests/expiry-day-refresh.spec.js`，企业及管理员历史、详情读取失败、暂停写入、草稿保留及纯读恢复                                     |
| 身份读取独立恢复与审核保存导航保护               | `tests/session-read-recovery.spec.js`、`tests/review-navigation-saving.spec.js`，已有会话恢复、纯读取、单条及批量失败保存互斥        |
| 详情及改期版本冲突后的纯读核对                   | `tests/booking-conflict-recovery.spec.js`，真实跨账号写入、409后读取503、草稿保留及关闭后的迟到响应                                  |
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
| 企业不含结果通知订阅、绑定互斥及读取恢复         | `tests/identity-binding-recovery.spec.js`，启用隔离短信适配器、已验证手机及实际注册换绑                                              |
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

- **维护协调**：已实现总时限、续期及退出确认；PID存活保护以单机共享同一进程命名空间为边界，不支持多个独立PID命名空间的容器共享同一个维护数据库。强杀后的恢复仍须核查最近维护结果。
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
