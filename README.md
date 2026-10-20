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
- 自动备份、历史归档、空间检查；可配置短信、语音、QQ/微信、加密异机备份及独立告警。

## 文档

| 需要做什么                     | 文档                                 |
| ------------------------------ | ------------------------------------ |
| 注册、申报、审批与现场管理     | [使用指南](docs/user-guide.md)       |
| 查配置变量与 Docker / 本地差异 | [配置说明](docs/configuration.md)    |
| 了解权限、并发、验证码与密钥   | [账号与安全规则](docs/security.md)   |
| 备份、恢复、升级与故障排查     | [运行维护](docs/operations.md)       |
| 接入短信、QQ/微信、S3 与告警   | [外部服务接入](docs/integrations.md) |
| 本地开发、测试与 Pages 发布    | [开发与测试](docs/development.md)    |
| 查源码、生成文件与目录职责     | [项目结构](docs/architecture.md)     |
| 查近期修正                     | [变更记录](CHANGELOG.md)             |

[全部文档](docs/README.md)

本地生成目录及旧诊断资料的清理范围、保留项与重建方法见[中间文件清理说明](docs/development.md#清理本地中间文件)。

## 当前边界

- 邮箱作为登录名，尚未验证邮箱所有权；密码恢复由管理员核验身份后处理。
- 外部服务需要自己的账号、凭据和实际联调，配置检查及协议测试不能替代送达或恢复验收。
- SQLite 适用于单机，或多个进程共享同一个本地数据库文件。多台服务器需改用集中式数据库，不能靠复制数据卷保证全局互斥。
- [GitHub Pages 入口](https://crystalclear9.github.io/OutdoorsWeb/)仅提供静态页面，无法独立运行账号和业务 API。完整功能使用 Docker 服务地址。

数据库结构版本为 **6**。升级前先备份，回滚必须匹配数据库与程序版本。最近一轮代码验证包括 57 项后端测试、27 项浏览器测试、桌面/手机视觉回归和 Docker 构建；具体覆盖范围及执行方法见[开发与测试](docs/development.md)。
