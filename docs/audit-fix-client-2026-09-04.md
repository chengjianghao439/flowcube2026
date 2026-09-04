# 客户端审计修复 F11–F15（2026-09-04）

本记录描述隔离工作树内的实现与本次验证，不代表已经发布、部署或在 Windows / Android 真机上验收。对应原始报告 `docs/system-audit-2026-09-04.md` 的 F11–F15。

## 现行契约

### F11：销售退货扫码上架

条码仅用于识别类型并向后端查询，不使用 `Number(parsed.code)` 或条码数字段充当数据库主键。

- `GET /api/return-tasks/:id/putaway-container?barcode=完整条码` 返回 `containerId / barcode / taskId / warehouseId / status`。
- `GET /api/return-tasks/:id/putaway-location?barcode=完整条码` 返回 `id / code / warehouseId / status`。库位解析复用 `locations.service.findByCode`，支持 R 条码与 LOC 编码。
- 两接口均要求登录、`RETURN_ORDER_EXECUTE`、`X-Client: pda`、有效设备会话；查询明确检查非空设备绑定仓、用户仓库范围、任务待上架状态。容器必须属于本任务的 `sale_return` 来源、与任务同仓且为待上架状态；库位必须可用且与任务同仓。无需增加通用 `INVENTORY_VIEW / LOCATION_VIEW` 权限。
- `POST /:id/putaway` 在事务内重新检查任务、容器来源/状态、库位状态，并补齐设备仓非空、用户仓库范围、容器与任务同仓和库位未删除校验。容器条码查询、写入预读和事务加锁读均排除软删除容器，避免旧标签推进上架数量而不计入库存。条码查询不是写入授权凭据。
- 页面查询失败保留当前步骤并给出中文错误；查询或提交中阻止重复扫码；切换任务/卸载后丢弃旧查询和写入回执的界面回调，避免清空新任务的已扫容器。上架成功清空容器并刷新任务；不确定结果使用原有幂等回执确认，`requestAction` 明确为后端的 `return.putaway`，不自动重放写入。
- 任务详情增加 `pendingPutawayContainers[{id,barcode,qty,productId,productName}]`，展示部分质检拆出的合格批次真实条码与数量；界面仍要求扫描实物标签与库位，不通过列表直接提交 ID。

### F01 / F11：退货标签与操作回执闭环

收货、质检接口统一返回 `{ taskId, status, containers: [{ containerId, barcode, qty, status }], printJobIds, noPrinterCount }`。质检回执包含未检原容器的最新数量与合格、拒收拆分容器。库存修复在同一业务事务内入队 ZPL，使用稳定任务/阶段/容器/状态/数量键防重复；无打印机保留业务回执，入队异常则回滚。相关真实队列、幂等和事务测试见库存修复记录。

PDA 收货/质检页显示本次批次条码、数量、状态及打印队列结果，完成质检后仍保留回执并允许进入上架；无打印机明确提示在 ERP 配置或补打并核对贴标后继续。更新标签时提示分开放置并更换旧标签。关键操作采用后端的 `return.receive` / `return.check` 回执动作名，失败显示中文反馈。

### F12：跨来源令牌续期

`client.ts` 使用没有业务响应拦截器的独立 Axios 实例续期。每次请求显式继承当前 `apiClient.defaults.baseURL` 与有界 timeout（缺失时 15 秒），调用相对 `/auth/refresh`。浏览器 `/api`、桌面 `file://` 与 PDA `https://localhost` 均使用实际 API 基址；运行时切换 API 后的下一次续期读取新基址。保留并发 401 合并为一次续期和重放仅一次的闸门；续期或重放再次 401 会登出。

并发合并按 refresh token / API 基址区分会话；无 refresh token 在建立进行中记录前返回失败，重新登录后可正常续期。续期等待期间退出、切换账号或 API 地址后，旧响应不会更新令牌、重放旧请求或把新会话登出；旧请求完成也不会清掉新会话进行中的续期记录。测试覆盖旧续期成功与失败两条分支。

### F13：证书校验

移除旧的按主机/IP 放行证书错误策略。`certificate-error` 默认拒绝所有身份或信任链错误；更新请求同样使用 Chromium 网络栈的严格验证。未引入可随意配置的跳过校验开关，也未修改实际部署配置。

部署需使用证书有效、域名匹配的 HTTPS 地址。旧 IP 自签证书兜底不再自动受信；需要修复域名/证书配置。实际生产证书和客户端当前 API 地址未在本任务访问核验。

### F14：可信清单与安装包绑定

渲染层 → preload → IPC 的下载参数统一为 `{ downloadUrl, version }`，仪表盘按钮和全局提示都使用此契约。摘要不由渲染层决定。

主进程每次下载重新从已配置的 HTTPS API `/api/app-update/latest` 读取清单，设置请求超时并拒绝清单重定向；验证清单版本、HTTPS 地址和 64 位十六进制 SHA-256。前端下载地址解析同样只接受 HTTPS，避免显示主进程必然拒绝的地址。所选 URL / 版本必须与该清单一致，且为较新版本（显式调试环境变量除外）。无摘要、URL/版本不匹配时不下载、不安装。

下载完成后必须通过 SHA-256 检查，失败删除损坏文件；用户完成保存与安装确认后、调用 `shell.openPath` 前再次校验，覆盖确认期间的文件损坏。原生提示回退与仪表盘手动更新都走同一校验路径。安装包仍可保存到下载目录并选择稍后安装。

兼容限制：旧清单或 GitHub fallback 若没有 `sha256`，自动安装会安全拒绝，需重新发布带摘要的清单。此处未将缺失摘要视为可跳过校验条件，也未宣称安装包已具备操作系统代码签名。

### F15：自动更新提示消费

根路由挂载 `DesktopUpdateBridge`，使用运行时 `window.flowcubeDesktop.isDesktop` 识别桌面，不依赖用户进入仪表盘。收到更新后通过现有 Dialog / Button 展示版本和中文更新说明，可立即更新、忽略此版本、稍后提醒；失败保留提示并显示错误。

主进程按 webContents 保存待提示快照。preload 先订阅事件再读取快照，避免启动晚到；读快照期间已有新事件时丢弃旧快照，卸载时移除监听并阻止异步回调。忽略版本会清除当前快照并保存偏好，显式手动检查仍可再次显示该版本。

## 本次验证

全部命令使用项目 Node 22 环境；未连接生产、未启动用户开发服务、未启动真实 Electron 或安装程序。缺陷测试先覆盖失败行为，再执行修复后的回归。总任务升级 React Router 至 7.18.3 后补充实际 `AppRouter` / `HashRouter` 回归，覆盖 ERP 通配路由、PDA 子路由、绝对导航、浏览器返回、跨端导航保护及未登录重定向。

- `npm --prefix frontend run test:unit`：69 passed / 0 failed（原有 26 项，加本任务 43 项）。
- `node --test tests/audit-desktop.test.js tests/audit-return-putaway.test.js`：18 passed / 0 failed。
- `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit`：通过。
- `npm --prefix frontend run lint`：0 errors，5 条既有 React Fast Refresh warnings，未新增屏蔽。
- `npm --prefix backend run lint`：通过。
- `npm --prefix frontend run build` / `npm --prefix frontend run build:pda`：均通过（React Router 7.18.3、标签回执与续期生命周期更新后重跑，分别 3.77 秒 / 23.19 秒）；产物未提交。
- `git diff --check`：通过。

测试边界：Axios 使用真实实例和拦截器，仅替换传输适配器与会话存储；React 使用真实 DOM 渲染、PDA 键盘扫码和 Dialog，替换 API/设备反馈边界；桌面 VM 加载完整实际 main/preload/update 模块，仅替换 Electron/网络边界，使用临时文件验证真实哈希和损坏清理；退货查询测试运行实际 service/routes/库位解析与仓库范围逻辑，以隔离查询夹具替代数据库。真实 MySQL 库存业务验证由总审计修复任务统一记录。

为 React 组件测试新增 `jsdom ^26.1.0` 开发依赖，由总任务同步 package 与 lock。

本机原始日志（临时文件，不提交）：`/tmp/flowcube-client-unit-20260904.log`、`/tmp/flowcube-client-node-20260904.log`、`/tmp/flowcube-client-tsc-20260904.log`、`/tmp/flowcube-client-lint-20260904.log`、`/tmp/flowcube-client-backend-lint-20260904.log`、`/tmp/flowcube-client-build-erp-20260904.log`、`/tmp/flowcube-client-build-pda-20260904.log`、`/tmp/flowcube-client-diffcheck-20260904.log`。类型检查及 diff 检查成功时日志为空，命令最终均 exit 0。

## 原生验收与文档同步

仍需 Windows 安装包验证：到期续期、有效/无效证书、启动晚挂载更新提示、更新下载/保存/安装退出；仍需 Android APK 验证：扫码硬件输入、退货上架、PDA `https://localhost` 到期续期与网络切换；仍需实际打印机核对退货收货/质检拆分后的标签内容与贴标操作。DOM/VM、数据库队列不能代替这些实际路径。

`AGENTS.md` 第 4 / 8 / 9 / 10 / 12 节与主报告风险状态由总任务合并现行摘要；`docs/DEPLOY.md`、`docs/runbooks/failure-recovery.md` 和更新服务旧自签注释应删除“主机白名单兜底继续可用”的描述，替换为严格证书策略。发布说明与版本号未在本任务修改，未提交或推送。
