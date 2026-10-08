# 嵌套弹层兼容性与真实回归

本批实际依赖树：Dialog/Select、Popover、Menu/Toast 原分别解析不同 DismissableLayer/FocusScope。各自维护层级和焦点上下文；仅在日期 onEscapeKeyDown 停止传播不能保证外层监听器不先处理。不同版本造成层级冲突的背景见 [Radix issue1088](https://github.com/radix-ui/primitives/issues/1088)，当前结论仍以本机依赖解析、真实GUI与行为测试为准。

首次 Vite/Vitest dedupe 到旧顶层1.1.11/1.1.7，正确真实日期2→1→0成立；但旧layer不识别较新Popover传入的deferPointerDownOutside，React发DOM属性警告。因此没有以此版本结束验收。

统一到1.1.19/1.1.16后，真实八项Dialog焦点测试出现1失败/7通过：内层Escape后仍两个dialog，不是回焦到另一个目标。追加call-through监听观察和有限条件等待，单独用例仍失败，没有增大timeout、mock Radix或改期望。新版layer在render算isHighest，再条件注册capture监听；内层注册时错过更新会使监听缺失。日期浮层的布局重渲染可掩盖这个条件，故单个日期通过不代表所有嵌套Dialog通过。相关上游时序问题见 [Radix issue4143](https://github.com/radix-ui/primitives/issues/4143)，该报告不作为本批通过证据。

逐版检查npm发布代码：1.1.12尚无defer属性；1.1.13支持defer并在事件中检查最高层；1.1.14和1.1.19均改为render检查。最终选择 npm overrides 的 DismissableLayer1.1.13、FocusScope1.1.16，保留原Dialog/Popover/Select/Menu组件版本及业务代码。包锁同步，Vite/Vitest共享radixSingletons，避免以后又加载私人副本。

Vitest必须内联Radix包以应用同一解析，不能让Node外部化绕开dedupe。正则匹配实际文件路径的 `/@radix-ui/`；匹配包名开头的表达式不生效。配置依据 [Vitest server.deps.inline](https://v4.vitest.dev/config/server)。早期测试同步超时是诊断记录，不作为产品断言失败。

最终测试、真实嵌套Date/Select/Dialog及原业务页面复验结果统一登记在 verification.md。原1.1.19失败日志保持独立，既有全量1864通过记录也是调整前快照，不能充当最终依赖版本的全量证明。
