# 本轮验证与证据边界

2026-10-08销售统一入口恢复后的最新验证见[sale-entry-recovery.md](sale-entry-recovery.md)：265文件/2006例、类型检查、前后端lint、ERP构建、销售/成套/数量回归与真实两张合成草稿验收。以下1877例与PDA构建为前一系统批次，不能替代该增量的证据边界。

后续按用户要求移除仪表盘常用工作后，新增限定验证见[dashboard-common-work-removal.md](dashboard-common-work-removal.md)。以下全量与构建是前一系统批次记录，未在本增量重复执行。原批次产品源码曾冻结。开发环境加载本机dev-env，Node22；类型检查明确指定`tsconfig.app.json`。本轮没有推送/CI/生产证据。

| 检查 | 结果 | 日志 / 边界 |
| --- | --- | --- |
| 全前端`npm --prefix frontend run test:unit` | 260文件 / 1877用例通过 | [frontend-full.log](verification/frontend-full.log)，最后可见文案修正后再次执行；不是浏览器/业务提交验收 |
| `tsc -p frontend/tsconfig.app.json --noEmit` | exit0 | [types.log](verification/types.log)；空输出需结合本轮工具观察到的退出0，不用根空壳tsconfig冒充通过 |
| 前端lint | exit0，0错误 / 37警告 | [lint.log](verification/lint.log)；不声称警告已清零或全部属于历史基线 |
| ERP与PDA build | 两端exit0 | [build-erp.log](verification/build-erp.log)、[build-pda.log](verification/build-pda.log)；没有Windows安装包、Android真机或生产部署 |
| 15项受影响项目守卫 | 全部exit0 | [guards.json](verification/guards.json)及各日志，含文案/标签/PDA扫码/刷新/日期/会话/轮询/API路由/写权限/权限/数量覆盖/查询循环/SQL标识符/占位/AGENTS文档；“正在读取”自然拦截后只改为“正在加载”并重验 |
| SupplierRefund受影响后端8套件 | 300用例通过 | [supplier-refunds.log](verification/supplier-refunds.log)；金额、来源、权限、回执、未知结果和小额夹具；不是全后端套件 |
| 客户退款限仓真实API | 自然SQL失败后9用例通过 | [a-backend-read.md](a-backend-read.md)、a-api-read-red/green；本批专属实例，不连接生产 |
| 数量/扫码比较/执行/退款闸门 | 4套件49用例通过 | [business-preservation.log](verification/business-preservation.log)；没有改库存或状态机规则 |
| 库存唯一事实源守卫 | 430后端源码扫描通过 | [stock-source.log](verification/stock-source.log)；不代替并发库存数据库smoke |
| 受控弹窗/草稿/标签/日历 | 最终canonical5文件47用例通过；本轮描述增量7文件专项通过 | [aria-and-drafts.log](verification/aria-and-drafts.log)、shared-components-review；真实Radix嵌套/返回焦点，无stub或加长测试timeout；全前端最终回归已包含这些用例 |
| 比例表格/原像素布局 | 2文件30用例通过 | B报告及evidence-b；自然red保留，Chrome选择列反例后修正。旧像素保存、实际拖动、Escape取消、勾选保留另验 |
| 最后占库文案专项 | 3文件16用例通过，单页lint0 | [final-copy-allocation.log](verification/final-copy-allocation.log)、[final-copy-lint.log](verification/final-copy-lint.log)；仅文案，没有修改数量、仓库、预览或原请求 |
| Radix依赖配置 | Layer1.1.13 / FocusScope1.1.16，五类浮层共用deduped单例 | [radix-singletons.log](verification/radix-singletons.log)、[radix-compatibility.md](radix-compatibility.md)；1.1.19真实嵌套Dialog回归失败被保留，未以日期偶然rerender绿掩盖 |
| 源码与证据清单 | inventory / merge-evidence一致性检查通过 | coverage的allowlist快照只证明清单新鲜，不能当作GUI版本或整个工作树指纹 |

## 实际页面复验

真实本地API和本批独占MySQL提供合成长名称/型号/颜色、长备注、多商品、两位数量、四位单价/退款及合法阶段。1440/1024/768电脑窗口、320/390PDA浏览器包含列表、表单、详情、错误/重试、空态、选择器、日期、草稿和多标签。精确路径/主题/尺寸/状态及未执行项在coverage和对应observations中；没有全页面全状态通过的结论。

四个实际fluid用方销售、采购、收货、PDA设备共有12张尺寸图及4次表内右端/返回左端，页面无横溢出；同5单768×768销售约261→81px行高。纯组件选择夹具另证明56px固定勾选列、真实比例、320内部滚动保留选择、固定操作与不透明hover，不外推成全部业务用方通过。滚动方法和未观察到的物理横轮行为都有记录。

最终销售查询日历实际2→1→0、Select-only脏输入继续回原combobox、多标签客户/两商品数量1.25和2/备注保留，以及关闭继续/放弃已操作复验。供应商退款最后1024浅深描述目标存在，Tab未离开弹窗，关闭等待卸载后回原单号按钮；两主题axe均37pass/0violation/1incomplete(aria-hidden-focus)。该incomplete保留人工边界，不能写全部可访问性通过。旧contrast violation和description缺目标的失败JSON仍保留。

`.dark`是DOM模拟，不宣称主题菜单切换已验；空列表不代表有数据表格，原生PDA/扫码枪/相机/软键盘/物理打印/银行资金均未验。角色权限内联切换保护、各详情合法阶段、隐藏/迟到/撤权等没有实际GUI证明时依旧待验。

## 资源退出

[browser-cleanup-final.json](browser-cleanup-final.json)确认所有本任务命名浏览器退出。[runtime-cleanup-pre.json](runtime-cleanup-pre.json)先核本批label、容器ID、volume mount、端口、活进程身份，再正常logout本批合成认证(HTTP200)及停止服务；[runtime-cleanup-final.json](runtime-cleanup-final.json)确认专属容器/卷/归属文件删除、四端口无监听、API/Vite/runtime/runner不存在，私有合成认证目录移除。共享3307仍为同一ID、running且healthy，未清理或停用它。

细粒度打印前提helper收尾收到401 `AUTH_TOKEN_EXPIRED`，wrapper退出1，见[runtime-helper-cleanup-failed.log](verification/runtime-helper-cleanup-failed.log)。**不能把该helper写成成功**；外层EXIT trap删除专属实例的结果经过独立精确资源核对，确认没有遗留容器/卷/服务。下一次长时间验收应在本批helper收尾前刷新其合法测试登录，随后再作最终认证撤销，避免把GUI当前token与helper捕获token混为一处。

持久化报告/JSON/选用日志完成凭据形状扫描，未发现JWT、Bearer正文或真实DB/JWT环境值。曾有工具原始网络输出回显本批合成header，没有保存进仓库；相关本批登录已撤销，整个专属实例与私有认证资料已移除。

未执行：全部后端库存/财务数据库smoke、全部权限组合GUI、CI、Windows原生、Android真机、物理打印和生产。它们不由1877前端用例替代。


## 2026-10-08 转移到 main 后复核

按用户只保留 main 的要求，本轮 UI 改动及仪表盘“常用工作”删除已原样转到 main 工作区，仍未提交。转移前后 975 个文件的 SHA-256 与权限一致，main 原有环境文档改动未覆盖；原始验收日志（含被忽略文件）保留。详情见 `docs/worktree-retention-2026-09-25.md` 的当日记录。

在 main 按现有 lockfile 执行 npm ci 后，重新执行前端全量单测：260 文件 / 1877 用例通过（16:52:55 开始，45.50 秒自然退出 0），类型检查指定 tsconfig.app.json，退出 0。仪表盘删除现已包含在该次全量验证中。没有新增界面实现或业务规则；没有重新宣称未覆盖的 GUI、真机或生产通过。
