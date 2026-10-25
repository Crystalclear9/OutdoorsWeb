# 临时 Pages 成果演示（待删除）

访问 [GitHub Pages](https://crystalclear9.github.io/OutdoorsWeb/) 后，可以从顶部切换企业、审核人员、财务人员、场地工作人员、超级管理员及游客，无须后端或登录。各身份使用现有业务页面和菜单权限。企业、申请、公告、费用及设计图全部为虚构示例。

## 演示范围

- 企业查看申请、场地图及办理进度，并试填申报；上传图片只用于当前表单预览，演示记录使用统一示例设计图，不保存上传原图。
- 审核人员核对设计图、通过或退回申请；财务核定演示金额，企业查看费用及试填虚构流水。结果只改变演示状态，不产生真实预约、账单、到账或通知。
- 管理员发布演示公告，工作人员调整演示开放安排和现场登记。账号、授权、日志及维护可查看；真实账号操作、外发通知和备份维护不会执行。
- 取消及改期可查看表单，提交提示使用完整服务。此适配器不替代后端的完整状态流转和安全验收。

状态保存在当前标签页的 `sessionStorage`，刷新保留，切换身份共享同组样本并重建页面，清除未提交的草稿和弹窗。“重置演示”还原初始样本。关闭标签页后由浏览器清理；存储不可用时仍可在内存中展示，刷新不保留。不要输入真实密码、企业资料或付款信息。

## 构建与验证

```sh
npm run build
npm run test:api
npm run test:e2e
npm run test:showcase
npm run build:pages
```

`build` 是正常服务构建，`build:pages` 才包含临时演示。当前静态成果发布时，最后执行 `build:pages`，提交根目录 `index.html` 和 `assets/`，Pages 继续使用 `main / (root)`。正常 `build` 会覆盖静态发布文件，不要遗漏最后一步。Docker 始终使用正常 `build`。

本机预览：执行 `npm run build:pages`、`npm run preview`，打开 `http://127.0.0.1:4173/?showcase=1`。本地参数只能开启专门的演示构建。

静态测试使用不提供 `/api` 的服务，在仓库子路径验证六种身份、桌面和手机布局、审核与财务、申报与公告、刷新、重置和标签页隔离，并断言没有 `/api` 请求。正常服务测试验证网址参数及存储不能赋予演示身份。

## 隔离边界

仅 `mode=pages`、未配置 `VITE_API_BASE_URL`，且位于指定 GitHub Pages 主机和 `/OutdoorsWeb/` 路径时自动启用。本地仅允许 localhost/127.0.0.1 加显式 `showcase=1`。普通构建不输出演示 UI 或数据模块。演示适配器不设置认证 Cookie、CSRF 或服务端身份，失败也不回退到真实 API。前端展示身份不代表真实授权。

完整服务继续独立校验会话、权限、归属和事务版本。Pages 不提供数据库或真实业务 API；账号、收费、通信、备份和恢复须在完整服务中验收。

## 待删除清单

临时代码标记 `TEMPORARY_PAGES_SHOWCASE`，正式开放前一起移除：

1. 删除 `src/showcase/`、`playwright.showcase.config.js`、`tests/start-showcase.mjs`、`tests/showcase/`、`server/tests/showcase-gate.test.mjs` 及本文档。
2. 移除 `src/main.jsx`、`src/api.js` 的演示导入、分流及动态加载；移除 `src/App.jsx` 的演示登录提示、只读演示账号和 `initialPage` 参数，恢复默认工作台。
3. 删除 `package.json` 的 `build:pages`、`test:showcase` 及 CI 演示验证步骤；保留普通服务对伪造演示参数无效的回归，或改为无演示入口检查。
4. 更新 README、开发、架构、质量和安全说明的临时演示段落；执行正常构建及测试，提交同步的根目录发布文件，移除演示分包。
5. 核验 Pages 不再显示身份切换、Docker 仍需真实登录。旧标签页的演示存储没有服务端权限，可在浏览器中清除。

[文档目录](README.md)
