# 华中科技大学户外广场布展预约 Demo

根据所提供 PDF 的业务流程制作的响应式 Web 演示，支持本地运行及 GitHub Pages 静态访问。

## 启动

需要 Node.js 22.12 或更高版本。

```powershell
npm install
npm run dev
```

打开终端显示的本地地址（默认 http://127.0.0.1:5173）。

## GitHub Pages

访问地址：https://crystalclear9.github.io/OutdoorsWeb/

当前 Pages 使用 `main` 分支的根目录发布。根目录 `index.html` 和 `assets/` 是已编译的静态文件，浏览器不需要 Node.js 或 JSX 编译器。`.nojekyll` 使 Pages 直接发布静态文件。

源页面入口在 `src/index.html`，业务代码在 `src/main.jsx`。修改后执行：

```powershell
npm ci
npm run build
npm test
git add src scripts index.html assets
git commit -m "Update reservation demo"
git push
```

`npm run build` 先构建 `dist/`，再同步发布文件到根目录。资源路径使用 `./assets/`，可在 `/OutdoorsWeb/` 子目录加载。不要直接把源入口覆盖到根目录 `index.html`。

Pages 设置应为 “Deploy from a branch”，分支 `main`，目录 `/ (root)`。无需更换现有发布方式。发布更新由 GitHub 异步完成，推送后可能需要稍等并刷新。

`npm test` 包括真实静态服务下 `/OutdoorsWeb/` 子路径的生产构建加载测试，以及申报、审核、公告和手机端流程测试。本机测试使用 Edge；在其他操作系统上运行需调整 `playwright.config.js` 的浏览器配置。

## 演示流程

1. 默认进入企业演示身份，查看场地，选择桁架位、查询日期。
2. 发起布展申报，填写企业、联系人、手机号、最多 3 天的日期范围，上传 3 MB 以内 JPG/PNG/WebP 桁架设计图。
3. 在右上角切换为管理员，进入企业申报审核。支持通过及填写原因后退回；已通过的时段冲突会被拦截。
4. 切回企业查看审核结果；已通过的申请会体现在对应日期的场地分布中。
5. 管理员可发布、编辑、置顶及删除公告。游客可查看场地与公告。

## 演示边界

- React + Vite，纯前端；数据保存在当前浏览器 localStorage 中，各身份共享本机数据。清除本站浏览器存储即可恢复预置数据。
- 默认提供 9 条已通过及 3 条待审核示例。示例随第一次打开时的日期生成。
- 29 个桁架位分为 A/B/C 区，布局参考 PDF 重新绘制，为示意，非测绘或现场定位图。
- 身份切换模拟登录。手机号短信、QQ/微信授权、真实权限校验、电话通知尚未接入。
- 图片存储受浏览器配额限制，本版本用于少量样本演示；真实系统应使用后端数据库和文件存储。
- `npm run build` 检查生产构建；`npm run preview` 本地预览构建产物。
