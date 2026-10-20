# 配置说明

从项目根目录复制 `.env.example` 为 `.env`。本地 `npm` 运行脚本读取 `.env`；Compose 使用它替换 `compose.yaml` 中的配置。已有管理员的密码不会因修改配置而自动改变，需按[管理员恢复步骤](operations.md#管理员恢复与备份)显式处理。

## 核心服务

| 变量                 | 默认或示例值             | 用途                                                                     |
| -------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `ADMIN_EMAIL`        | `admin@example.com`      | 首次创建管理员的邮箱，须自行设置                                         |
| `ADMIN_PASSWORD`     | 示例占位符，必须替换     | 10–128 位，包含字母和数字                                                |
| `APP_PORT`           | `8080`                   | 仅 Compose 使用的主机端口                                                |
| `PORT`               | `3001`                   | 本地 API 监听端口；Compose 固定容器内为 3001                             |
| `HOST`               | `0.0.0.0`                | 本地监听地址；Compose 固定容器内为 0.0.0.0                               |
| `DB_PATH`            | `./data/app.sqlite`      | 本地数据库；Compose 固定为 `/app/data/app.sqlite`                        |
| `COOKIE_SECURE`      | `false`                  | HTTPS 正式服务设为 `true`；本地 HTTP 使用 `false`                        |
| `PUBLIC_ORIGIN`      | 空                       | 额外允许的浏览器来源，精确到协议、域名和端口，逗号分隔；同域通常留空     |
| `TRUSTED_PROXY_IPS`  | 空                       | 可信代理的精确 IP，逗号分隔；直接访问时留空                              |
| `REQUIRE_ADMIN_MFA`  | `true`（示例及 Compose） | 管理员开启两步验证后才能使用业务功能                                     |
| `APP_ENCRYPTION_KEY` | 空                       | 可选的 64 位十六进制 MFA 加密密钥；留空自动生成数据库同目录的 `.mfa-key` |

`PUBLIC_ORIGIN` 控制请求来源，`PUBLIC_URL` 用于第三方登录回调，两者用途不同。`VITE_API_BASE_URL` 是可选的前端构建变量；默认使用同域 `/api`。现有 Dockerfile 不传入这个构建变量，推荐继续使用同域 Docker 服务。

开发环境的 Vite 代理固定到 `http://127.0.0.1:3001`；修改本地 `PORT` 时须同步修改 `vite.config.js` 的代理目标。Cookie 使用 SameSite=Lax，配置 CORS 不会自动解决跨站 Cookie 限制。

## 维护

| 变量                    | 默认值                    | 用途                                                                  |
| ----------------------- | ------------------------- | --------------------------------------------------------------------- |
| `BACKUP_INTERVAL_HOURS` | `24`                      | 自动备份间隔，0–720 小时；0 关闭自动备份，保留清理和手动备份          |
| `BACKUP_KEEP`           | `14`                      | 自动备份保留数量，2–365                                               |
| `MIN_FREE_DISK_MB`      | `256`                     | 最低可用磁盘空间，0–1000000 MB；低于阈值健康检查失败                  |
| `ARCHIVE_AFTER_DAYS`    | `365`                     | 历史图片及审计归档阈值，30–3650 天                                    |
| `BACKUP_DIR`            | 数据库同目录的 `backups/` | 可选本地维护目录；当前 Compose 未传入此变量，使用 `/app/data/backups` |

归档仍保留资料并占用空间；清理过期临时记录与删除业务历史是不同操作。备份和空间回收方法见[运行维护](operations.md)。

## 外部服务

未配置服务时，相关快捷入口不开放。接入资质、回调地址和验收步骤见[外部服务接入](integrations.md)。

| 变量组                                                   | 用途                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PUBLIC_URL`                                             | OAuth 公共 HTTPS 根地址，不含路径，例如 `https://venue.example.edu.cn` |
| `QQ_CLIENT_ID`、`QQ_CLIENT_SECRET`                       | QQ 网站登录                                                            |
| `WECHAT_CLIENT_ID`、`WECHAT_CLIENT_SECRET`               | 微信网站应用扫码登录                                                   |
| `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM` | 短信和语音服务；须开通发送区域和发送方                                 |
| `TWILIO_VOICE`                                           | 语音名称，默认 `Polly.Zhiyu`                                           |
| `S3_BACKUP_BUCKET`、`S3_BACKUP_REGION`                   | 私有备份桶与区域，默认区域 `us-east-1`                                 |
| `S3_BACKUP_ACCESS_KEY`、`S3_BACKUP_SECRET_KEY`           | 存储凭据，须成对填写；未填写时 SDK 可使用其默认凭据链                  |
| `S3_BACKUP_ENDPOINT`、`S3_PATH_STYLE`                    | 兼容存储端点及路径模式；路径模式默认 `false`                           |
| `S3_BACKUP_PREFIX`                                       | 对象前缀，默认 `outdoors/`                                             |
| `S3_ALLOW_HTTP`                                          | 默认 `false`；仅受控内网测试显式开启                                   |
| `BACKUP_ENCRYPTION_KEY`                                  | 独立的 64 位十六进制备份加密密钥，须另行离线保管                       |
| `ALERT_WEBHOOK_URL`                                      | 接收通用 JSON 告警的 HTTPS 网关地址                                    |
| `ALERT_WEBHOOK_TOKEN`、`ALERT_WEBHOOK_SECRET`            | 可选 Bearer 认证与 HMAC-SHA256 签名密钥                                |
| `MONITOR_URL`                                            | 独立监控进程探测的公共健康地址；Compose 应用不启动独立监控             |

不要向工单、日志、截图或仓库粘贴凭据。密钥丢失会影响 MFA 或备份恢复；只保存在应用所在机器也无法防范整机丢失。

[返回项目首页](../README.md) · [文档目录](README.md)
