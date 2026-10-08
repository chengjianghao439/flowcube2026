# 代表截图与操作证据

原始照片保持原文件，重构后照片来自相同专属实例的合成资料。下列同尺寸、同主题对照用于指定状态；新增动态详情只有after时明确不称before/after。工作区其它标签数量有变化，不把顶栏变化当成同一表格的业务差异。

| 场景 | 原始 | 重构后 | 限定结论 |
| --- | --- | --- | --- |
| 销售长备注，1440×900浅色 | [before](screens/before/sale-light-1440.png) | [after](screens/after/root-fluid-sale-1440.png) | 商品身份完整，辅助备注两行/展开；同合成单据，后续增加了一条PDA阶段夹具，不能说全表资料数量始终一致 |
| 销售比例表，768×768浅色 | [before](screens/before/root-sale-fluid-768.png) | [after](screens/after/root-sale-fluid-final-768.png) | 同5单，行高约261→81px，采用表内横滚，页面无横溢出；不是768同时呈现全部列 |
| 供应商退款列表，1440×900浅色 | [before](screens/before/supplier-refund-list-light-1440.png) | [after](screens/after/root-supplier-refund-list-1440.png) | 同RF1，原采购/退货、人类身份、业务阶段和四位金额分层 |
| 供应商退款详情，1440×900浅色 | [before](screens/before/supplier-refund-detail-light-1440.png) | [after](screens/after/root-supplier-refund-detail-1440.png) | 同RF1草稿，原分配和资金/库存边界可读；未确认、取消或收款 |
| 供应商退款最终描述与焦点，1024×900 | 原始详情见上行 | [light](screens/after/root-supplier-description-final-1024.png)、[dark](screens/after/root-supplier-description-final-dark-1024.png) | 真正description目标存在；Tab仍在弹窗，Escape等待卸载后回原单号；浅深axe各0violation/1incomplete，人工边界保留 |
| 采购/收货/PDA设备比例表 | 原始入口见contact-before及各route图 | observations-fluid-final/scroll中12图+4横滚 | 四真实调用方×768/1024/1440浅色，无页面横溢出；右端固定动作与回左0均实际测量；不点击业务动作 |
| 基础资料与独立表单 | A/B before、workspace-tabs-before | [CRUD](base-crud-gui-validation.md)、[独立表单](a-followup-overlays.md)、[工作区](workspace-tabs-validation.md) | 实际输入/选择、取消/继续/放弃/重开、多标签保留；组件pending反例另列，不伪称真实提交中 |
| PDA扫码/手动/数量/阶段 | [before索引](observations-pda-before.json) | [after](observations-pda-after.json)、[final](observations-pda-final.json)、[320可达](evidence-b/pda-320-reachability.json) | 320/390浏览器；有效设备绑定和合法阶段读取，明确拒绝阶段也保留；无真机扫码或实体返回键证明 |

Root初始12张代表图、before的92入口与after108请求路径仅按记录绑定人工层级。A的119张after图、C的64张图逐张细看声明和B的各状态明细已合入coverage；不把contact缩略布局概览写成细读。

带勾选列的共享表格使用真实DataTable组件、合成只读一行HTML夹具。Chrome最初忽略混合calc、hover透字均是实际反例；最终普通reload后，固定56px选择列与60/20/20余宽比例正确。见[evidence-b/fluid-selection-preview.json](evidence-b/fluid-selection-preview.json)。该夹具不代表四个业务页面；物理横轮输入未观察到移动，最终横滚证据明确使用DOM scrollLeft与实际布局。

深色使用浏览器`.dark`模拟，未验证产品主题开关。截图和axe需等浮层动画稳定；立即主题切换拍到的过渡色与卸载前BODY焦点探针均排除，保留解释，不认定产品失败或通过。
