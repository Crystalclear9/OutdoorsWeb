# 运行验收与后续改进

## 发布验证

发布候选版本必须先在本地完成构建、后端、压测、真实浏览器、临时 Pages 和 Windows 视觉验证，再执行 Docker 完整服务与固定 Linux 浏览器视觉测试。任何步骤失败或环境不可用时保留候选修改，不将远程 CI 当作首次验证环境。远程 CI 用于发布后的独立复核。

正常服务测试前执行 `npm run build`；浏览器测试期间不得重建同一 `dist`。临时演示使用独立构建目录。最后执行 `npm run build:pages` 同步当前阶段的静态发布文件，并检查文档链接及 Git 差异。

```powershell
npm run build
npm run test:api
npm run test:load
npm run test:e2e
npm run test:showcase
npm run test:visual
npm audit
docker build -t outdoorsweb:verify .
npm run test:docker
docker run --rm -v "${PWD}:/workspace" -v /workspace/node_modules -w /workspace -e PLAYWRIGHT_CHANNEL=chromium mcr.microsoft.com/playwright:v1.64.1-noble sh -c 'npm ci && npm run build && npm run test:visual'
npm run build:pages
```

固定环境容器会生成独立 Linux 依赖目录；不复用 Windows 的 `node_modules`。首次执行可能下载较大的官方镜像，需提前检查空间。测试镜像和缓存按本次资源清单管理，不使用全局清理指令删除其他项目资源。操作系统、浏览器差异应按对应基线核对，只有确认属于预期界面变化后才能更新基线。

## 后续工作与验收标准

| 优先级   | 工作           | 完成标准                                                                                                         |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| 上线前   | 真实机构试用   | 企业、审核及账号管理员分别完成草稿续办、退回补正、核验复核、并发处理和异常恢复；确认操作耗时与规则适用性。       |
| 上线前   | 容量与保留配置 | 在目标主机用接近实际的数据量验证延迟、磁盘门槛和备份占用；先查看保留策略预览，再按机构政策启用，保留可用恢复点。 |
| 上线前   | 独立恢复与告警 | 从异机备份恢复账号、设计图及 MFA 密钥；模拟应用停止和磁盘阈值，核对独立监控能通知负责人。                        |
| 按需启用 | 外部登录与通信 | 使用机构自己的服务账号完成短信、QQ/微信及回调联调，不以测试适配器或 Pages 演示代替真实验收。                     |
| 实测后   | 查询与前端性能 | 根据真实查询计划和页面加载耗时决定游标分页、索引或管理页面拆包，保留结果一致性及访问控制回归。                   |

审批提醒阈值目前只作用于当前视图；增加个人指派、升级提醒或强制申报提前期前，需要明确接手规则和责任人。企业核验记录目前作为参考，强制核验门槛和材料范围须由管理单位决定。

[文档目录](README.md) · [质量说明](quality.md)
