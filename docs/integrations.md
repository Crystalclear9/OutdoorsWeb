# 外部服务接入

配置项索引见[配置说明](configuration.md)。填写配置不等于服务已通过验收，需使用自己的服务账号完成实际联调。

## 短信、语音与 QQ/微信

在 `.env` 配置 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM`，并在 Twilio 开通目的国家、发送方及相应服务。短信接口与语音调用分别使用 [Messages](https://www.twilio.com/docs/messaging/api/message-resource) 和 [Calls](https://www.twilio.com/docs/voice/api/call-resource)。不同地区的发送资格、模板及费用由服务商管理，配置前登录页不展示未开放的快捷入口。

- 在账号设置验证并绑定手机号。短信发送前要求图片验证码；同号码最多每分钟一次、每天 10 次，同来源每小时 10 次。短信码 5 分钟有效、最多 5 次尝试、绑定浏览器且只能使用一次。绑定另需当前账号密码；同号码只能绑定一个账号。
- 用户在账号设置主动勾选审批结果短信或电话通知；只向已验证号码发送。管理员使用短信登录时也必须完成 TOTP。管理员 QQ/微信登录被禁用，保留密码和两步验证。
- 审批事务只写入发送任务，网络发送每 15 秒在后台处理，不阻塞审批。服务商 HTTP 429 明确未受理时指数退避，最多 5 次，并遵守有效的 `Retry-After`；其他明确的 4xx 拒绝停止自动重试，修正配置后人工处理。HTTP 5xx、408、网络超时、进程中断或成功响应缺少有效受理编号时标记“需核实”，不自动重复发送；不能因 HTTP 500 就假定未受理。[Twilio 对非幂等发送的说明](https://www.twilio.com/docs/api/errors/20500)明确提示重复短信或呼叫风险，[429 说明](https://www.twilio.com/docs/api/errors/20429)则明确请求未处理、可退避重试。运行维护页可查看最近 50 条任务并核实、关闭或重试明确失败的任务；“需核实”须先核对服务商记录，不能直接重试。受理编号表示服务商受理，不能当作用户实际收到的证明。
- 实际发送前再次核对账号、预约归属和当前审核/取消状态；预约取消、原单已改期、账号停用或任务关联失效时关闭排队任务并记录审计。已结束的批准预约不再发送旧布展指令，退回结果仍可告知。手机号换绑或退订也会阻止发送；人工重试仍须通过这些检查。已经发往服务商的请求无法通过本地取消召回，结果不确定时仍须到服务商核实。
- 服务商结果写回同时检查领取时的任务版本与发送状态；任务已被人工核实或其他进程更新时，迟到结果只写审计，不重新排队，也不覆盖人工依据。原任务继续按最新核实结果办理，冲突结果可在操作日志的 `delivery.late_result` 中追溯。
- 升级启动时，将旧适配器记录为待发送或失败的 HTTP 5xx/408、缺失受理编号任务转入“需核实”，递增版本并写入 `delivery.legacy_uncertain` 审计，保留原错误依据。重复启动不重复转换；已受理、已取消、已有不确定结果和人工核实后的任务保持原结论。升级应先停止旧版本进程，避免旧发送器继续按旧策略运行。
- QQ/微信配置 `PUBLIC_URL`、`QQ_CLIENT_ID/QQ_CLIENT_SECRET`、`WECHAT_CLIENT_ID/WECHAT_CLIENT_SECRET`。公共地址通常须为 HTTPS 根地址，例如 `https://venue.example.edu.cn`。在开放平台登记精确回调：`https://venue.example.edu.cn/api/auth/oauth/qq/callback`、`https://venue.example.edu.cn/api/auth/oauth/wechat/callback`。微信使用网站应用扫码登录资质。首次授权后进入企业资料补全页，完成后创建并绑定企业账号；已有账号请先在账号设置中绑定。授权 state 单次消费、10 分钟有效且绑定浏览器。令牌只用于服务端换取 OpenID，不保存到浏览器。

QQ 实现遵循[官方服务端授权流程](https://wiki.connect.qq.com/使用authorization_code获取access_token)，微信入口与回调采用[网站应用登录协议](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)。第三方拒绝授权、超时或未绑定会显示明确错误，重新登录后可重试。

## 加密异机备份、恢复与独立告警

配置 `S3_BACKUP_BUCKET`、区域、凭据及独立的 `BACKUP_ENCRYPTION_KEY`（64 位十六进制）。兼容存储可设置 `S3_BACKUP_ENDPOINT` 与 `S3_PATH_STYLE=true`；端点默认要求 HTTPS，只有受控内网测试才显式设 `S3_ALLOW_HTTP=true`。存储桶须为私有，配置生命周期规则控制异机保留时间，本程序不会删除远端对象。

每份本地快照通过完整性检查后，将数据库及 MFA 密钥一起使用 AES-256-GCM 加密上传，随后 HEAD 检查并下载回读 SHA-256 校验；全部成功才标记“复制并校验成功”。复制失败保留本地备份并在下一次维护重试，维护页显示状态。不要把异机加密密钥仅保存在这台服务器：丢失后无法恢复。文件格式为 `HUSTBK01` + 12 字节 IV + 密文（32 字节 MFA 密钥及 SQLite 文件）+ 16 字节认证标签。

下载 `.sqlite.enc` 后恢复到新目录：

```powershell
npm run restore:encrypted -- ./downloaded.sqlite.enc ./restored/app.sqlite
```

此命令读取 `.env` 中的 `BACKUP_ENCRYPTION_KEY`，验证认证标签及数据库完整性，不覆盖已有数据库；成功后生成 `app.sqlite` 和 `.mfa-key`。每次恢复使用独立临时文件，失败只清理本次临时文件，不删除其他恢复任务的中间文件。启用前将 `DB_PATH` 指向恢复文件；如设置 `APP_ENCRYPTION_KEY`，确保它与备份内原密钥一致。先在隔离环境核验账号、历史图片与 MFA，再按运维流程切换服务。

`ALERT_WEBHOOK_URL` 接收 JSON `{event,detail,at,service}`，支持 `ALERT_WEBHOOK_TOKEN` Bearer 认证和 `ALERT_WEBHOOK_SECRET` 的 HMAC-SHA256 签名（请求头 `X-HUST-Signature`，签名对象为原始请求正文）。健康、维护或发送队列异常会触发告警，同类成功告警抑制 30 分钟。接收方必须校验签名并返回 2xx；接收失败会在维护页显示。此接口适合接入自己的告警网关；企业微信、钉钉等不同消息格式应由网关转换。

应用自身停机时无法自报。另提供独立探测进程，设置 `MONITOR_URL=https://venue.example.edu.cn/api/health` 和上述告警变量，运行 `npm run monitor`。每 30 秒探测，连续失败 3 次告警，恢复后发送恢复事件；单次检查可执行 `npm run monitor -- --once`。应运行在另一台设备或独立监控平台，不能用同一应用容器代替整机故障监控。所有外发服务尚需用户自己的凭据和实际连通性验收。“运行维护”的接入检查逐项显示短信、QQ、微信、S3、告警的缺失配置和地址格式问题，只显示变量名称，不泄漏凭据；配置完整仍标记为待实际联调，不冒充已经验收。

[返回项目首页](../README.md) · [文档目录](README.md)
