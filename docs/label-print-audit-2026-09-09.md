# 标签打印检查与软件修复（2026-09-09）

## 结论与范围

检查了业务入队、打印机路由、ZPL 模板、桌面 RAW 消费、领取与终态回执、补打、过期与历史清理。检查阶段发现下列 7 项可复现问题，随后按用户授权完成软件修复。未发布、未向真实打印机发送任务。当前工作区还有其他任务的未提交修改，本报告不把它们归入本次变更。

## 修复前复现与现行实现

以下位置行号和缺陷叙述对应检查时快照；每项“现行实现”说明本次代码修复。原 JSON 保留修复前探针证据，不作为正确行为断言。

### LP-01 / P1：旧失败回执可以覆盖新一轮领取

位置：`backend/src/modules/print-jobs/print-jobs.command.js:315`，`frontend/src/components/desktop/DesktopPrintClientBridge.tsx:73`。

成功回执使用 ackToken + PRINTING CAS，但失败回执不传令牌；后端 fail 只按任务 ID 和 PENDING/PRINTING 更新。独立库执行 create → claim A → fail A → retry → claim B，再发送属于 A 的迟到失败，确认 A/B 令牌不同，B 仍被改成 FAILED（3）并清掉令牌。B 随后的正确成功回执也无法完成，人工重试可能造成重复标签。

现行实现：两条失败 API 均要求本轮 ackToken，以 PRINTING + 令牌 CAS 更新；缺令牌 400、旧令牌 409，陈旧回执不能修改新领取。桌面所有失败路径携带令牌。旧客户端须更新失败请求；旧版本无令牌失败上报不会覆盖状态，任务交给超时人工确认。

### LP-02 / P1：面单缺专用绑定会进入普通标签机

位置：`backend/src/modules/print-jobs/print-jobs.label-command.js:377`，`backend/src/modules/print-jobs/print-dispatch.js:136`。

enqueueWaybillLabelJob 设置 requireBinding=false；无 waybill 绑定时，解析器根据 contentType=zpl 回退到 type=1 普通标签机。独立库没有面单绑定、只有普通标签机时，实际生成的面单任务仍指向该标签机。与函数注释“无面单机绑定返回 null，不退回普通标签机”冲突，可能使用错误纸张或在错误位置出纸。

现行实现：面单要求明确的 waybill 用途绑定，禁用无绑定回退；缺绑定返回 null，保留取号事实。明确配置的全局用途绑定继续有效，不额外改变打印机类型契约。

### LP-03 / P1：本仓找不到打印机后回退到其他仓库

位置：`backend/src/modules/print-jobs/print-jobs.label-command.js:64`、`:81`、`:19`。

第一层按 warehouseId 查找失败后，resolveLabelPrinterId 会直接选环境指定打印机或全库第一台 type=1 打印机，丢失仓库边界。独立库为仓库 2 入队容器标签，唯一打印机属于仓库 1，任务仍指向仓库 1 的机器。

现行实现：环境指定设备和末级默认标签机均检查启用、标签类型和目标仓库或全局设备范围；本仓缺设备不再任意跨仓。显式用途绑定保持原契约。

### LP-04 / P1：业务文本未完整转义，可进入 ZPL 指令

位置：`backend/src/modules/print-jobs/print-jobs.template.js:65`，`backend/src/modules/print-jobs/labelZpl.js:16`。

内置兜底模板对商品名称、型号等字段保留 ASCII ^ 和 ~，直接拼接到指令文本。纯函数探针给商品名称插入字段结束与新坐标指令，输出中保留了新指令。自定义 ZPL 变量替换虽清洗 ^，仍保留 ~。这是生成内容层面的确认，没有向打印机实际发送该探针。

现行实现：画布和全部六种内置模板业务字段统一清洗 ^/~ 与 C0/C1 控制字符；可信正文保留。自定义模板采用单次回调替换，美元替换符保留字面值，插入值不递归展开。条码保留合法首尾空格及原模块宽度。

### LP-05 / P2：任务份数未被桌面消费

位置：`frontend/src/components/desktop/DesktopPrintClientBridge.tsx:81`、`:93`，`backend/src/modules/print-jobs/print-jobs.command.js:60`。

后端保存并返回 copies，但桌面 ClaimedJob 不声明／读取它，printClaimedJob 只发一次 RAW 内容后上报完成。对真实函数的临时转译副本注入记录用打印桥，copies=3 时观察到打印调用 1 次、完成上报 1 次。内容中未指定多份，因此该任务不能按 copies 打出 3 份。常规自动标签目前传 copies=1，主要影响显式多份任务和保留多份参数的重打。

现行实现：后端入队要求数字整数 copies=1–100，缺省1；桌面将完整模板按份数组成一次 RAW 提交。单份保持历史模板不变；多份遇模板 ^PQ 明确报错，避免数量相乘。RAW 提交成功后的核销网络失败只重试回执，不重打；设备部分出纸或断电仍需人工确认，不声称物理原子性。

### LP-06 / P2：已过期的待打印任务仍可被领取

位置：`backend/src/modules/print-jobs/print-jobs.dispatch.js:31`、`:55`。

claim 只过滤 status 与打印机，没有检查 expires_at，并在领取时重设 TTL。独立库将任务设为一分钟前过期，在 sweeper 处理前领取成功。客户端恰在过期与扫描之间上线时，原本应超时待确认的旧任务仍会被打印。

现行实现：领取 SELECT 与 CAS 均排除 expires_at 已到期的任务；只返回 CAS 成功记录，保留 NULL 过期时间的旧任务兼容。过期任务由扫描器改为超时待确认，不能通过领取续命。

### LP-07 / P2：编辑器纸高没有进入生成指令

位置：`backend/src/modules/print-jobs/labelZpl.js:61`，`frontend/src/pages/settings/print-templates/editor.tsx:557`。

统一几何返回纸宽和纸高，但 ZPL 生成只读取 widthMm。相同元素将 canvasHeightMm 从 50 改为 100，非空 ZPL 输出完全一致，未包含 ^LL。当前参数只能改变预览，无法通过本次任务下发给打印机。真实走纸是否受影响还取决于打印机介质校准与预存参数，不能在无真机时认定必然错纸。

现行实现：画布标签按已有203dpi换算输出 ^LL，默认50mm及自定义75mm已有回归；宽度、坐标、条码参数保持原几何契约。300dpi适配、介质校准、字体与扫码属于待接设备的验收，不在本次软件通过结论内。

## 修复前检查验证

- `npm run test:label`：16 项几何 + 11 项 ZPL + 5 例前后端一致性，通过。
- `npm run test:print`：18 项路由策略 + 15 项状态规则，通过。
- `npm run test:print-purge` 对应脚本：独立回环测试库运行，4 项通过。
- 上述合计 69 项现有回归通过；7 项问题探针是“缺陷存在”的证据，不是正确行为门禁。证据见 `label-print-audit-2026-09-09.json`。
- 测试专用配置经过 `tests/helpers/testEnvironment.js` 校验；新建随机命名的 flowcube_printaudit_*_test 库，执行 240 个迁移文件。第一次清理回归受默认 /var/www 下载目录权限阻断，改为任务专属 /tmp 下载目录后通过。两个本次测试库均已删除，没有连接生产库跑测试。
- 入库收货、退货容器和打包主链的打印入队调用使用调用方 conn；补打入口未发现创建实物容器或改库存的动作。成功核销使用状态与令牌 CAS，失联回收至失败而非自动重新打印，这些保护应保留。
- 系统所谓“已打印”目前由操作系统 RAW 提交成功后上报，没有纸张到位或条码可读的设备反馈，本次不将队列成功等同于真机验收。

## 本地设备与验收边界

只读检查本机 127.0.0.1:3307 / flowcube_dev8：有 6 台配置为启用的普通标签机，但均无可用客户端心跳；标签模板 type 5–10 各有一个默认模板。系统 lpstat 提示没有安装打印目的地。因此未执行真实打印，也未验证 Windows WinSpool、实际中文字体、纸张尺寸、打印浓度和 PDA 扫码。该状态只代表本次本地开发环境，不代表生产打印机状态。

七项软件问题已修复；接入真实标签机后再验收出纸份数、介质校准、中文字体及扫码。

## 修复验证

- 新增回归先在旧实现复现：队列专项 2 通过 / 6 失败，桌面组件 3 通过 / 12 失败，ZPL 先后新增 31 项安全/纸高与 7 项空格兼容回归并确认失败，再修复实现。
- `npm run test:label`：70 项通过（几何16、ZPL49、镜像5）；`npm run test:print`：33 项通过。
- 随机独立回环 `flowcube_printfix_*_test` 库运行队列专项8项、历史清理4项、mainline主链49项回归，均退出0；虚拟设备无消费者，测试库完成后已删除。
- 隔离修复工作树运行 `npm --prefix frontend run test:unit`：45 个文件、232 项通过，其中桌面桥接16项使用模拟 RAW/API，覆盖多份、100份多标签、^PQ冲突、非法份数、令牌失败回执和核销网络重试。
- `tsc -p frontend/tsconfig.app.json --noEmit`、变更生产文件及前端测试定向 ESLint、ERP构建通过。构建保留现有 queryClient 同时静态/动态导入警告，不代表真实设备验收。
- 独立规格及质量复审通过。新增 `smoke:print-queue` 入口接入 Tests CI 配置；未推送，尚未在远程CI运行。
- 已同步 AGENTS.md 第3/10节、模块 README 与本报告。无数据库结构迁移，无生产操作；软件结果和真机验收分别记录。

## 主工作区与本地页面复核

- 审查后回填19个打印专属路径；回填前逐一确认现有受控文件与本次基线一致，新建路径无冲突。AGENTS.md 只定向更新打印条款，其他任务改动保留。
- 主工作区再次运行桌面桥接16项、前端完整类型检查与 diff 检查，均通过。未提交、未推送；专用 `codex/label-print-fixes-20260909` 工作树保留修复记录。
- 使用已有本地测试账号在 `http://localhost:5173` 登录、读取打印模板列表并打开产品标签编辑页。在当前页面恢复默认布局、切换预览并把纸高从50改成75mm，看到75×75mm画布、条码与示例文字；未保存模板、未创建打印任务，关闭会话丢弃当前页改动。
- 浏览器加载实际 Vite `printJobContent.ts`，确认3份生成3个格式，^PQ与多份冲突被拒绝；这仅验证浏览器中的软件内容组装。页面无浏览器运行错误。截图保存在本地 `output/label-print-fixes-2026-09-09/preview-75mm.png`。
- 本任务浏览器会话 `flowcube-label-software` 已关闭并二次列表核验退出，未关闭其他会话或开发服务。
