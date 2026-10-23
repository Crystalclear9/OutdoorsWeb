# 华中科技大学户外广场企业布展预约系统

React 前端、Node.js 24 API 与 SQLite 数据库组成的完整应用。账号、申请、设计图、审批、公告、场地安排和操作日志保存在服务端。推荐通过 Docker 同域运行页面与 API。

## 快速启动

需要 Docker Desktop（Linux containers）或 Docker Engine + Compose。

1. 复制配置：Windows 执行 `Copy-Item .env.example .env`；Linux/macOS 执行 `cp .env.example .env`。
2. 修改 `.env` 中的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。密码须为 10–128 位，包含英文字母和数字，并替换示例占位符。
3. 在项目根目录执行：

   ```sh
   docker compose up --build -d
   ```

4. 打开[本地完整服务](http://localhost:8080)。管理员首次登录后开启两步验证并保存恢复码；企业通过“登录 / 注册”创建账号。

```sh
docker compose ps
docker compose logs --tail=100 app
```

`APP_PORT` 可更换主机访问端口。业务数据保存在 `app-data` 持久卷，重建镜像和 `docker compose down` 不清除数据；删除卷会清空业务数据。公网运行须配置 HTTPS，并设置 `COOKIE_SECURE=true`。不要提交 `.env`、数据库、备份或密钥。

## 功能概览

- 企业账号、图片验证码、两步验证、资料维护与登录设备管理。
- 按原图对应的 29 个桁架位查询场地，提交最长 3 天的布展申请。
- 连续审阅、冲突提示、批量审批、取消预约和保留原位的改期审批。
- 按职责授权工作人员，管理公告、暂停开放、现场实际摆放和审计日志。
- 工作日反馈时限、人工电话跟进、独立财务核对、线下缴费与退款登记。
- 自动备份、历史归档、空间检查；可配置短信、语音、QQ/微信、加密异机备份及独立告警。

## 文档

| 需要做什么                     | 文档                                             |
| ------------------------------ | ------------------------------------------------ |
| 注册、申报、审批与现场管理     | [使用指南](docs/user-guide.md)                   |
| 电话跟进、财务授权与缴费退款   | [办理与线下费用](docs/casework.md)               |
| 查配置变量与 Docker / 本地差异 | [配置说明](docs/configuration.md)                |
| 查防护措施、权限和安全边界     | [防御措施与安全规则](docs/security.md)           |
| 备份、恢复、升级与故障排查     | [运行维护](docs/operations.md)                   |
| 接入短信、QQ/微信、S3 与告警   | [外部服务接入](docs/integrations.md)             |
| 本地开发、测试与 Pages 发布    | [开发与测试](docs/development.md)                |
| 查运行架构、扩展边界和目录职责 | [项目结构与架构](docs/architecture.md)           |
| 对照原 PDF 与后续要求          | [需求核对与验收边界](docs/requirements-audit.md) |
| 查多代理审计与修复范围         | [项目复核记录](docs/project-audit.md)            |
| 组织发布、运营与维护交接       | [全流程验收清单](docs/release-checklist.md)      |
| 查近期修正                     | [变更记录](CHANGELOG.md)                         |

[全部文档](docs/README.md)

本地生成目录及旧诊断资料的清理范围、保留项与重建方法见[中间文件清理说明](docs/development.md#清理本地中间文件)。

## 当前边界

- 邮箱作为登录名，尚未验证邮箱所有权；密码恢复由管理员核验身份后处理。
- 外部服务需要自己的账号、凭据和实际联调，配置检查及协议测试不能替代送达或恢复验收。
- SQLite 适用于单机，或多个进程共享同一个本地数据库文件。多台服务器需改用集中式数据库，不能靠复制数据卷保证全局互斥。
- [GitHub Pages 入口](https://crystalclear9.github.io/OutdoorsWeb/)仅提供静态页面，无法独立运行账号和业务 API。完整功能使用 Docker 服务地址。

数据库结构版本为 **7**。升级前先备份，回滚必须匹配数据库与程序版本。2026-10-23 架构复核后，本地通过 120 项后端与传输测试、60 项浏览器及 2 项桌面/手机视觉回归，构建、隔离压测和生产依赖审计通过。CI 另验证完整 Docker 镜像的启动、业务和重启持久化，具体结果以对应提交工作流为准，方法见[开发与测试](docs/development.md#验证)。核心业务已实现；用户已确认保留财务核定后通知企业的流程，不再将其列为待确认事项。真实电话送达、收费依据和外部服务仍待运营验收，见[完整需求结论](docs/requirements-audit.md#2026-10-22-全量需求验收结论)。
