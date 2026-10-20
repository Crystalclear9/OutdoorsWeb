// Configuration diagnostics deliberately return variable names, never secret values.
export function integrationReadiness(env = process.env) {
  const result = [];
  const add = (key, label, names, validate) => {
    const enabled = names.some((n) => !!env[n]),
      missing = names.filter((n) => !env[n]),
      issues = enabled
        ? [...missing.map((n) => `缺少 ${n}`), ...(validate ? validate() : [])]
        : [];
    result.push({
      key,
      label,
      configured: enabled && !issues.length,
      state: !enabled
        ? "未配置"
        : issues.length
          ? "配置需修正"
          : "配置完整，待实际联调",
      issues,
    });
  };
  const validUrl = (value, root = false, allowHttp = false) => {
    try {
      const u = new URL(value);
      return (
        !u.username &&
        !u.password &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            (allowHttp || ["127.0.0.1", "localhost"].includes(u.hostname)))) &&
        (!root || (u.pathname === "/" && !u.search && !u.hash))
      );
    } catch {
      return false;
    }
  };
  add(
    "sms",
    "短信与语音",
    ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"],
    () => [
      ...(env.TWILIO_ACCOUNT_SID &&
      !/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID)
        ? ["TWILIO_ACCOUNT_SID 格式无效"]
        : []),
      ...(env.TWILIO_FROM && !/^\+[1-9]\d{6,14}$/.test(env.TWILIO_FROM)
        ? ["TWILIO_FROM 须使用 +国家码手机号"]
        : []),
    ],
  );
  for (const provider of ["qq", "wechat"])
    add(
      provider,
      provider === "qq" ? "QQ 登录" : "微信登录",
      [
        `${provider.toUpperCase()}_CLIENT_ID`,
        `${provider.toUpperCase()}_CLIENT_SECRET`,
      ],
      () =>
        !env.PUBLIC_URL
          ? ["缺少 PUBLIC_URL"]
          : validUrl(env.PUBLIC_URL, true)
            ? []
            : [
                "PUBLIC_URL 须为 HTTPS 根地址，本机测试可用 localhost 或 127.0.0.1",
              ],
    );
  add(
    "s3",
    "加密异机备份",
    ["S3_BACKUP_BUCKET", "BACKUP_ENCRYPTION_KEY"],
    () => [
      ...(env.BACKUP_ENCRYPTION_KEY &&
      !/^[a-f0-9]{64}$/i.test(env.BACKUP_ENCRYPTION_KEY)
        ? ["BACKUP_ENCRYPTION_KEY 须为 64 位十六进制"]
        : []),
      ...(!!env.S3_BACKUP_ACCESS_KEY !== !!env.S3_BACKUP_SECRET_KEY
        ? ["S3_BACKUP_ACCESS_KEY 与 S3_BACKUP_SECRET_KEY 须成对配置"]
        : []),
      ...(env.S3_BACKUP_ENDPOINT &&
      !validUrl(env.S3_BACKUP_ENDPOINT, false, env.S3_ALLOW_HTTP === "true")
        ? ["S3_BACKUP_ENDPOINT 地址或 HTTPS 配置无效"]
        : []),
    ],
  );
  add("alert", "外部故障告警", ["ALERT_WEBHOOK_URL"], () =>
    env.ALERT_WEBHOOK_URL && !validUrl(env.ALERT_WEBHOOK_URL)
      ? [
          "ALERT_WEBHOOK_URL 须为 HTTPS 地址，本机测试可用 localhost 或 127.0.0.1",
        ]
      : [],
  );
  return result;
}
