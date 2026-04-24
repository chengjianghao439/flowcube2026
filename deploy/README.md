# Deploy Config

真实生产部署拓扑不得提交进仓库。

发布脚本按以下顺序读取部署配置：

1. 环境变量 `FLOWCUBE_DEPLOY_CONFIG` 指向的 JSON 文件
2. `deploy/production.local.json`

请从 [production.example.json](/Users/chengjianghao/flowcube/deploy/production.example.json) 复制一份本地文件后填写真实值：

```bash
cp deploy/production.example.json deploy/production.local.json
```

`deploy/production.local.json` 已被 `.gitignore` 忽略，只用于本机或 CI 工作目录。
