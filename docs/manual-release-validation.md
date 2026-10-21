# 手动发版代码验证记录

范围是发版工作流、脚本、测试与说明；没有业务/迁移/锁文件变更，没有安装服务器组件、改凭据、配置GitHub环境/Secrets、触发发布或正式QA。

## 起点与授权

- 核对main完整SHA：`8db3e40f22e3949b50d1d698086c1a9cac2c183f`。独立checkout，新分支 `codex/manual-offline-release`，没有修改其他工作区或旧PR。
- #95 merged为`140f7327fab636c9f9aa4dce27e5ececcc620822`；#96 merged为上述main。#96实际修改前端锁文件、旧离线数据库预检及测试，没有修改release-gate/server-update。本次这些发版执行器的改动按现行main核对，不声称与#96存在不存在的文件重叠。
- 依赖安装第一次因审批引用旧暂停而未执行；上游补充时间顺序证据后，仅重试一次，获批完成独立目录的前端锁定依赖安装。没有因此尝试其他路径绕过拒绝。
- 先写协议及GitHub门禁测试并观察缺少实现的失败，再实现。前一批回归与编辑时间重叠，不作为有效基线或最终证据。

## 离线证据

`npm run test:manual-release` 包含Python协议/真实RSA签名/真实flock及Node工作流/GitHub门禁测试；HTTP、SSH传输、Docker调用只用受控替身，绝不生产连接。完整执行器回归使用真实Bash与真实备份helper，读取合成Docker输出/合成转储。

| 必须拒绝的情形 | 行为证据 |
|---|---|
| SHA不符、短SHA、分支/tag、未合入SHA | 临时Git仓库解析；包SHA/run绑定；source-lock摘要复核 |
| 文件篡改、错镜像ID/revision、错误Docker tag | 整包及逐文件摘要；真实RSA验签；内层Docker config身份；实际执行器shell拒绝迁移 |
| Tests失败/取消/跳过/未跑 | 真门禁函数及替身GitHub API完整调用；失败不构建/发包 |
| npm audit失败/跳过/缺目标 | 四个实际audit job/step身份，缺任意项拒绝，不改阈值 |
| 重复版本/SHA/PDA code、失败后重试 | 持久占位与收据；失败保留；真实flock并发只执行一次 |
| 任意SSH命令、SCP、注入 | 实际强制命令wrapper拒绝；发送器只生成一次receive-v1，无远程shell |
| 硬编码版本/主机 | 两组不同版本的真实打包/复核；两组主机的实际发送器命令组装，确认参数改变输出 |
| 非人工触发的合并/push/串联 | 解析workflow事件并反向加入push/workflow_run/call/PR使守卫失败；实际解析器逐项拒绝 |
| 路径穿越、绝对路径、链接、重复/额外条目 | tar内容验证在任何解出前拒绝 |
| 容量不足、坏备份、权限/摘要/来源漂移 | shell与真实备份helper故障注入；不授权迁移，旧备份仍在 |
| 迁移、启动、ready/页面/公网失败 | shell停止后续步骤，无旧镜像重标/恢复，无SET GLOBAL/引擎启动/cron |

反例曾发现真实Bash错误：`[镜像ID一致] && [revision一致]` 的首项失败可被后续命令覆盖。已改显式return失败，并复核同类磁盘检查。修正后重跑wrong-image拒绝和正常顺序测试。另两项实际shell撤门证明：删目标写契约门或健康门后，原本拒绝的合成场景会错误进入迁移；恢复后永久拒绝断言继续有效。

独立审阅另补并修复四个反例：接收器信号须停止整个子进程组；签名前核受代码审查固定的老大ID白名单并fresh重查；最新schedule安全失败不能借旧push绿灯；评论最后编辑时间不能晚于触发或颠倒备份/批准顺序。另补初始版本基线，防止空新状态目录放行旧版重复发布；执行前持久化全局在途标记，真实SIGKILL后换完整SHA/版本/run仍阻断；可捕获失败也阻断后续所有版本，待运维处置。

`test-docker-export.sh` 仅在普通Tests CI临时runner使用合成文件、FROM scratch、network=none构建并导出真实Docker归档，用同一解析器核验，不拉镜像、不连接服务器。该CI结果须以本PR完整commit的终态为准，不能用本地替身测试代替。


提交前已执行的本地验证：

- `npm run test:manual-release`：25项Python + 10项Node全部通过，包括真实RSA、flock、TERM进程组与SIGKILL重启阻断。
- 发布执行器/资源/串联退出/目标/秘密边界/旧中转兼容回归：87项通过。
- 产物/签名侧文件/来源/SBOM及独立桌面附件/读取校验：38项通过；旧网页SCP分支测试按已删除功能替换，桌面兼容测试保留。
- smoke私有凭据/浏览器运行时/SSH信任：21项通过。缺锁定后端依赖曾导致独立环境测试不能加载dotenv；获批在本checkout执行`npm ci --ignore-scripts --no-audit`补齐；桌面兼容测试同样补齐锁定依赖，锁文件未改。
- 同SHA门禁、PDA不可变清单及独立桌面兼容：32项通过。本地合计213项（25 Python、188 Node）；未把失败探索轮次计为通过。
- `actionlint`、`shellcheck -x`、Python AST / Node语法、`test:agents-md-guard`、`git diff --check`通过。

## 保留与改变

保留：同SHA Tests/Security及实际audit、完整归档/OCI身份、互斥、磁盘与超时、真实MySQL健康/TCP认证、目标写契约、停写、新鲜备份/独立收据、完整/受限权限smoke、浏览器资源上限和ready/前端检查。

移除：main自动发网页/PDA、工作流串联应用发布、Mac入口与中转CLI、服务器Git更新、首次数据库启动/重建、临时数据库参数修改、cron同步、skip gate和自动回滚。旧流程相关断言同步改成新失败停止契约，不保留自动回滚作为“通过”条件。历史#94/#95/#96数据库离线工具保持独立、未改动。

## 运行与验收边界

没有运行实际网页/PDA发布、正式smoke、运维检查或真人浏览器QA。未验证实际SSH/指纹、服务器权限/路径、真实Compose组合及数据库锁、迁移权限、生产备份恢复、网络吞吐、OIDC在线领取/真实issuer轮换、APK/设备或Windows更新。运维配置、非生产服务器演练和实际备份均按[运行手册](manual-release.md)另行审批；旧key停用必须先清单后老大单独批准。

本次不合并、不推main、不设auto-merge。远端commit与每项CI状态在草稿PR及交付报告中独立核对。
