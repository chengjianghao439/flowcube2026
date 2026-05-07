# 极序 Flow (FlowCube) — 代码级清理与安全扫描计划

> 生成时间：2026-05-07
> 适用版本：v0.3.82
> 运行环境：Node.js 20+ / MySQL 8.0 / Docker / Alibaba Cloud

---

## 清理优先级总览

```
优先级     风险等级  任务
─────────────────────────────────────────────────────────
P0         高       敏感信息扫描 → 确认无凭证/密钥/备份泄露
P0         高       依赖漏洞扫描 → 修复已知 CVE
P1         中       死代码清理   → 移除未引用的 controller/page
P1         中       无用依赖清理 → 降低构建体积和攻击面
P2         低       Git 仓库瘦身 → 删除误提交的大文件
P2         低       并发安全边界 → 确认容器锁/事务防护有效
```

---

## 一、无用依赖清理

### 1.1 扫描未实际引用的包（depcheck）

针对三个独立的 package.json 分别运行：

```bash
# 后端（CommonJS，无 TypeScript）
npx depcheck --json /sessions/amazing-affectionate-allen/mnt/flowcube/backend \
  --ignores="nodemon,dotenv" \
  --skip-missing=true

# 前端（ESM + TypeScript）
npx depcheck --json /sessions/amazing-affectionate-allen/mnt/flowcube/frontend \
  --ignores="cross-env,vite,typescript,autoprefixer,postcss,tailwindcss,terser,@vitejs/*,core-js,regenerator-runtime" \
  --skip-missing=true \
  --tsconfig=/sessions/amazing-affectionate-allen/mnt/flowcube/frontend/tsconfig.json

# 桌面端（CommonJS Electron）
npx depcheck --json /sessions/amazing-affectionate-allen/mnt/flowcube/desktop \
  --ignores="electron,electron-builder,iconv-lite,semver" \
  --skip-missing=true
```

**说明**：
- `--ignores`: 跳过 CLI 工具、构建工具和 Vite 插件（它们不会在源码中被 `require`/`import`）
- `--skip-missing=true`: 只报告未使用的包，不报缺失的包
- 前端运行时依赖（react-dom, axios 等）通常都会被实际引用，重点关注 `dependencies` 中未被引用的

**手动核查重点**（已知项目中值得检查的包）：

| 包名 | 位置 | 核查原因 |
|------|------|----------|
| `multer` | backend | 检查是否还有文件上传路由在使用 |
| `xlsx` | backend | 检查是否被 `exceljs` 完全替代 |
| `core-js` / `regenerator-runtime` | frontend | 仅在 PDA 构建时用到，Electron 构建是否仍需引用 |
| `lodash` / `mathjs` / `d3` | frontend | artifact 可用库，项目是否真正引用了 |

### 1.2 找出体积最大的包

```bash
# 后端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && \
  du -sh node_modules/*/ | sort -rh | head -20

# 前端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend && \
  du -sh node_modules/*/ | sort -rh | head -20

# 桌面端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/desktop && \
  du -sh node_modules/*/ | sort -rh | head -20
```

**体积阈值**：超过 10MB 的包应关注是否必要。已知体积较大的候选：
- `electron`（桌面端，~300MB，必然的）
- `@capacitor/*`（前端，~50MB，仅 PDA 需要）
- `eslint` / `typescript` 等 devDependencies 只会在安装阶段使用

### 1.3 检查重复依赖

```bash
# 后端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && npm ls --depth=0 2>/dev/null | head -80

# 检查是否有同一包的多版本嵌套
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && npm dedupe --dry-run 2>/dev/null

# 前端 — 检查是否有未被 hoist 的重复包（Vite 构建时可能增加产物体积）
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend && npx vite-bundle-analyzer 2>/dev/null || \
  echo "可用: npx vite-plugin-inspect 分析各 chunk 大小"
```

### 1.4 版本对齐检查

检查三个 `package.json` 中是否有同名但版本不一致的运行依赖（尤其是 `mysql2`、`axios`、`semver`）：

```bash
# 提取各端同名依赖的版本号
cd /sessions/amazing-affectionate-allen/mnt/flowcube && \
  node -e "
    const pkgs = {
      backend: require('./backend/package.json'),
      frontend: require('./frontend/package.json'),
      desktop: require('./desktop/package.json')
    };
    const allDeps = new Set();
    for (const [name, pkg] of Object.entries(pkgs)) {
      for (const [dep, ver] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
        allDeps.add(dep);
      }
    }
    for (const dep of [...allDeps].sort()) {
      const versions = {};
      for (const [name, pkg] of Object.entries(pkgs)) {
        const v = (pkg.dependencies && pkg.dependencies[dep]) || (pkg.devDependencies && pkg.devDependencies[dep]);
        if (v) versions[name] = v;
      }
      if (Object.keys(versions).length > 1) {
        const vals = [...new Set(Object.values(versions))];
        if (vals.length > 1) {
          console.log('⚠️ 版本不一致:', dep, JSON.stringify(versions));
        }
      }
    }
  "
```

---

## 二、死代码与无用文件清理

### 2.1 后端：找出未被引用的 controller / service 文件

**方案 A：grep 追踪引用链（推荐，零依赖）**

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend/src

# 步骤1：列出所有 controller 文件
echo "=== 所有 controller ==="
find modules -name '*.controller.js' | sort

# 步骤2：检查哪些 controller 未被 routes 引用
for f in $(find modules -name '*.controller.js'); do
  name=$(basename "$f" .js)
  count=$(grep -r "$name" modules/ --include='*.routes.js' -l 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "❌ 未引用: $f"
  fi
done

# 步骤3：检查哪些 service 未被 controller/routes 引用
for f in $(find modules -name '*.service.js'); do
  name=$(basename "$f" .js)
  count=$(grep -r "$name" modules/ --include='*.routes.js' -o --include='*.controller.js' -l 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "❌ 未引用: $f"
  fi
done

# 步骤4：检查 utils 和 middleware 中是否有未导出的文件
for f in $(find utils middleware -name '*.js'); do
  name=$(basename "$f" .js)
  count=$(grep -r "$name" . --include='*.js' -l 2>/dev/null | wc -l)
  if [ "$count" -le 1 ]; then
    echo "⚠️ 只被自己引用: $f"
  fi
done
```

**方案 B：基于 require 的静态分析**

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && \
  grep -roh "require('\.\/[^']*')" src/ | sed "s/require('\.\///;s/')//" | sort -u > /tmp/used_files.txt && \
  find src/ -name '*.js' -not -path '*/node_modules/*' | sed 's|^src/||' | sort > /tmp/all_files.txt && \
  comm -13 /tmp/used_files.txt /tmp/all_files.txt | grep -v node_modules | head -30
```

### 2.2 前端：找出未被引用的页面 / 组件

**方案 A：TypeScript 未使用导出检测（内置，无需额外工具）**

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend

# 检查未使用的导出（noUnusedLocals 已在 tsconfig 中启用时自动生效）
npx tsc --noEmit --pretty 2>&1 | head -50

# 检查未使用的函数/变量（ESLint 规则）
npx eslint src/ --rule 'no-unused-vars: error' --rule '@typescript-eslint/no-unused-vars: error' --format stylish 2>/dev/null
```

**方案 B：基于路由注册表扫描页面文件**

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend/src

# 列出所有 pages 目录（即路由页面）
echo "=== 所有 page 目录 ==="
ls -d pages/*/ | sort

# 检查每个页面是否在 router 中被 lazy import
for dir in pages/*/; do
  name=$(basename "$dir")
  count=$(grep -r "$name" router/ --include='*.tsx' -l 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "❌ 可能未注册路由: $name"
  fi
done
```

**方案 C：React 组件引用追踪**

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend/src

# 检查 components 下各个子目录的组件是否被引用
for dir in components/*/; do
  name=$(basename "$dir")
  # 排除 ui/（shadcn 基础组件）和 shared/（公共组件，通过 index 导出）
  if [ "$name" = "ui" ] || [ "$name" = "shared" ]; then
    continue
  fi
  imports=$(grep -r "from '@/components/$name" . --include='*.tsx' -l 2>/dev/null | wc -l)
  if [ "$imports" -eq 0 ]; then
    imports=$(grep -r "from '\.\./components/$name\|from '../../components/$name\|from '../../../components/$name" . --include='*.tsx' -l 2>/dev/null | wc -l)
  fi
  if [ "$imports" -eq 0 ]; then
    echo "⚠️ 可能未被引用: components/$name/"
  fi
done
```

### 2.3 构建产物 / 临时文件 / 日志清理

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# 构建产物
echo "=== 构建产物 ==="
du -sh frontend/dist/ 2>/dev/null && echo "  (npm run clean 可清理)"
du -sh desktop/release/ 2>/dev/null && echo "  (桌面安装包构建产物)"
du -sh frontend/android/.gradle/ 2>/dev/null && echo "  (Android 构建缓存)"

# 日志文件
echo "=== 日志文件 ==="
find . -name '*.log' -not -path './.git/*' -type f 2>/dev/null
find . -path '*/logs/*' -not -path './.git/*' -type f 2>/dev/null
find frontend/logs/ -type f 2>/dev/null && echo "  (前端日志)"

# 临时文件和系统文件
echo "=== 临时/系统文件 ==="
find . -name '.DS_Store' -not -path './.git/*' -type f 2>/dev/null
find . -name '*.tmp' -not -path './.git/*' -type f 2>/dev/null
find . -name '*.swp' -not -path './.git/*' -type f 2>/dev/null
find . -name '*.bak' -not -path './.git/*' -not -path './backups/*' -type f 2>/dev/null

# npm 缓存
echo "=== npm 缓存 ==="
du -sh backend/node_modules/.cache/ 2>/dev/null
du -sh frontend/node_modules/.cache/ 2>/dev/null
```

### 2.4 过时迁移文件和种子数据检查

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend/src/database

# 列出所有迁移文件（SQL + JS）
echo "=== 全部迁移文件 ==="
ls -1 *.sql 2>/dev/null | wc -l && echo "  (SQL 迁移文件总数)"
ls -1 *.js 2>/dev/null | wc -l && echo "  (JS 迁移文件)"

# 检查是否有入口索引文件引用了所有迁移
echo "=== 迁移入口 ==="
find . -name 'index.js' -o -name 'migrate.js' 2>/dev/null

# 检查是否有重复/冲突的迁移（文件名中 date 或序号重复）
echo "=== 序号异常检查 ==="
ls *.sql 2>/dev/null | grep -oP '^\d+' | sort | uniq -d | head -10

# 检查种子数据目录
echo "=== 种子数据 ==="
find /sessions/amazing-affectionate-allen/mnt/flowcube/tests -name 'seed*.js' -o -name 'seed*.sql' 2>/dev/null
ls -la /sessions/amazing-affectionate-allen/mnt/flowcube/scripts/ | grep -i seed
```

### 2.5 检查废弃 endpoints 和兼容代码

搜索 `DEPRECATED` / `deprecated` / `TODO` / `FIXME` / `HACK` / `XXX`：

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# 找出所有带废弃标记的路由和代码
grep -rn 'DEPRECATED\|deprecated' --include='*.{js,ts,tsx}' --exclude-dir=node_modules --exclude-dir=.git | grep -v 'node_modules' | head -30

# 找出 TODO / FIXME（技术债务跟踪）
echo "=== TODO ==="
grep -rn 'TODO' --include='*.{js,ts,tsx}' --exclude-dir=node_modules --exclude-dir=.git | grep -v 'node_modules' | head -20
echo "=== FIXME ==="
grep -rn 'FIXME' --include='*.{js,ts,tsx}' --exclude-dir=node_modules --exclude-dir=.git | grep -v 'node_modules' | head -20
```

---

## 三、敏感信息与不安全配置扫描

### 3.1 全项目敏感信息扫描

**推荐工具：gitleaks（最成熟，无需配置规则）**

```bash
# 方式1：直接 Docker 运行（推荐，无需安装 Go）
docker run --rm -v /sessions/amazing-affectionate-allen/mnt/flowcube:/repo \
  ghcr.io/gitleaks/gitleaks:latest detect \
  --source=/repo \
  --verbose \
  --report-path=/repo/gitleaks-report.json

# 方式2：透过 pip 安装
pip install gitleaks 2>/dev/null || \
  brew install gitleaks 2>/dev/null || \
  echo "请手动安装: https://github.com/gitleaks/gitleaks#installing"
```

**已知高风险文件检查（项目现状）**：

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# .env 文件（极危险，必须确认未被提交）
echo "=== .env 文件状态 ==="
git ls-files | grep -i '\.env'
echo "---"
ls -la .env* 2>/dev/null

# 大型 SQL 备份（项目已有 backup.sql）
echo "=== 数据库备份 ==="
ls -la flowcube_backup.sql 2>/dev/null
git ls-files flowcube_backup.sql 2>/dev/null && echo "⚠️  备份文件已入库！"

# SSH 密钥和敏感配置文件
echo "=== 密钥文件 ==="
find . -name '*id_rsa*' -o -name '*id_ed25519*' -o -name '*.pem' -o -name '*.key' \
  -not -path './.git/*' 2>/dev/null | head -10

# deploy 配置
echo "=== 部署配置 ==="
ls deploy/*.json 2>/dev/null | grep -v example
git ls-files deploy/ | grep -v example
```

**需要特别关注的文件**（基于项目已知结构）：

| 文件 | 风险等级 | 说明 |
|------|----------|------|
| `.env.aliyun` | 🔴 高 | 生产环境变量，确认已 gitignore |
| `flowcube_backup.sql` | 🔴 高 | 443KB 数据库备份，确认未入库 |
| `deploy/production.local.json` | 🔴 高 | 部署配置（密码等），确认已 gitignore |
| `.git-build-sha` | 🟡 中 | 构建时写入的 commit hash，不影响安全 |
| `gitleaks-report.json` | 🟢 低 | 扫描报告，清理后应删除 |

### 3.2 安全配置审查

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# Docker Compose 硬编码检查
echo "=== Docker Compose 硬编码密码 ==="
grep -n 'password\|PASSWORD\|secret\|SECRET\|TOKEN' docker-compose.yml docker-compose.backup.yml 2>/dev/null | grep -v '\${' | grep -v '#'

# Dockerfile 检查（是否暴露了不必要的端口、是否以 root 运行）
echo "=== Dockerfile EXPOSE ==="
grep -rn 'EXPOSE' Dockerfile.* 2>/dev/null

# Helm 安全头检查
echo "=== Helmet 配置 ==="
grep -A5 'helmet' /sessions/amazing-affectionate-allen/mnt/flowcube/backend/src/app.js

# CORS 配置（生产环境是否过于宽松）
echo "=== CORS 配置 ==="
grep -A10 'cors(' /sessions/amazing-affectionate-allen/mnt/flowcube/backend/src/app.js | head -15

# JWT 配置
echo "=== JWT 配置 ==="
grep -n 'JWT_SECRET\|JWT_EXPIRES' /sessions/amazing-affectionate-allen/mnt/flowcube/backend/src/config/env.js
```

**安全配置检查清单**：

| 检查项 | 预期结果 | 风险 |
|--------|----------|------|
| docker-compose 无硬编码密码 | 所有密码通过 `${VAR}` 环境变量引用 | 🔴 |
| HTTPS 已启用 | Nginx 配置或反向代理应强制 HTTPS | 🔴 |
| Helmet CSP 生产模式严格 | 开发模式放宽了 `upgradeInsecureRequests` | 🟡 |
| JWT_SECRET >= 32 位 | env.js 中有字符长度校验 | 🟢 |
| CORS 生产环境严格 | 应仅允许 `CORS_ORIGIN` 或 `CORS_REFLECT` | 🟡 |
| MySQL 端口不暴露公网 | docker-compose 中 `MYSQL_PORT:3306` 默认暴露 | 🟡 |

### 3.3 遗留调试代码扫描

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# console.log 扫描（适合找遗留调试）
echo "=== console.log ==="
grep -rn 'console\.log\|console\.dir\|console\.table' \
  --include='*.{js,ts,tsx}' \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  . 2>/dev/null | grep -v 'node_modules' | grep -v '//.*console' | head -30

# debugger 语句扫描
echo "=== debugger ==="
grep -rn 'debugger' \
  --include='*.{js,ts,tsx}' \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  . 2>/dev/null | grep -v 'node_modules' | head -10

# 被注释掉的测试代码（常见问题）
echo "=== 注释掉的代码块 >10行 ==="
grep -rn '\/\*' --include='*.{js,ts,tsx}' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  . 2>/dev/null | grep -l 'function\|const\|let\|var' | head -10

# 暴露的错误详情
echo "=== APP_EXPOSE_ERRORS ==="
grep -rn 'APP_EXPOSE_ERRORS\|expose.*errors' \
  --include='*.{js,ts,tsx}' --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | head -5
```

---

## 四、依赖漏洞扫描

### 4.1 npm audit（零配置，推荐作为 CI 门禁）

```bash
# 后端 — 仅扫描运行时依赖（devDependencies 不参与生产运行）
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && \
  npm audit --production --audit-level=high 2>&1 | tail -30

# 前端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/frontend && \
  npm audit --production --audit-level=high 2>&1 | tail -30

# 桌面端
cd /sessions/amazing-affectionate-allen/mnt/flowcube/desktop && \
  npm audit --production --audit-level=high 2>&1 | tail -30

# 汇总报告（JSON 格式便于分析）
cd /sessions/amazing-affectionate-allen/mnt/flowcube/backend && \
  npm audit --production --json 2>/dev/null | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.vulnerabilities) {
      for (const [name, info] of Object.entries(d.vulnerabilities)) {
        if (info.severity === 'critical' || info.severity === 'high') {
          console.log('🔴', info.severity, name, info.via);
        }
      }
    }
  " 2>/dev/null
```

**审计级别说明**：

| 级别 | 操作 |
|------|------|
| `critical` | 必须立即修复，考虑升级大版本或替换包 |
| `high` | 优先在下次发布中修复 |
| `moderate` | 安排修复，可带病运行 |
| `low` | 记录跟踪，不影响当前 |

### 4.2 深度扫描（Snyk / Trivy）

**推荐 Trivy — 开源、离线可用、支持多种语言**：

```bash
# Docker 方式运行 Trivy
docker run --rm \
  -v /sessions/amazing-affectionate-allen/mnt/flowcube:/repo \
  aquasec/trivy:latest filesystem --scanners vuln,secret,misconfig \
  --severity CRITICAL,HIGH \
  /repo

# 针对 Docker 镜像的漏洞扫描
# docker compose build 之后：
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image flowcube-backend:latest
```

**Snyk CI 集成建议**（如果已有 Snyk 账户）：

```yaml
# .github/workflows/security-scan.yml（可选）
name: Security Scan
on:
  schedule:
    - cron: '0 6 * * 1'  # 每周一 06:00
jobs:
  snyk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: npm ci --prefix backend
      - run: npm ci --prefix frontend
      - uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 4.3 GitHub Dependabot 集成（零成本）

在 `.github/dependabot.yml` 中添加：

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
    target-branch: "main"
    labels:
      - "dependencies"
      - "backend"
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
    target-branch: "main"
    labels:
      - "dependencies"
      - "frontend"
  - package-ecosystem: "npm"
    directory: "/desktop"
    schedule:
      interval: "weekly"
    target-branch: "main"
    labels:
      - "dependencies"
      - "desktop"
```

---

## 五、Git 仓库瘦身

### 5.1 检查大文件和历史中误提交的文件

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# 当前工作区中大文件
echo "=== 当前工作区大文件（>1MB）==="
find . -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/.playwright-cli/*' \
  -type f -size +1M -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $NF}' | sort -rh | head -20

# 历史中所有被跟踪的大文件（git rev-list：找出曾在任何提交中出现的大文件）
echo "=== 历史中大文件 ==="
git rev-list --objects --all 2>/dev/null | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' 2>/dev/null | \
  awk '/^blob/ {print $3, $4}' | sort -rn | head -20

# 使用 git-sizer（推荐，更全面的分析）
# 安装：brew install git-sizer
npx git-sizer 2>/dev/null || \
  echo "安装: npm install -g git-sizer 或 brew install git-sizer"
```

### 5.2 已知的大文件问题扫描

```bash
cd /sessions/amazing-affectionate-allen/mnt/flowcube

# 确认大备份文件是否被跟踪
echo "=== 备份文件Git状态 ==="
git ls-files flowcube_backup.sql 2>/dev/null && \
  echo "⚠️  flowcube_backup.sql (443KB) 已被Git跟踪！" || \
  echo "✅ flowcube_backup.sql 未被Git跟踪"

git ls-files '*.apk' 2>/dev/null && \
  echo "⚠️  有 APK 文件被Git跟踪！" || \
  echo "✅ 无 APK 文件被跟踪"

git ls-files '*.exe' 2>/dev/null && \
  echo "⚠️  有 EXE 文件被Git跟踪！" || \
  echo "✅ 无 EXE 文件被跟踪"

# 检查 LFS 配置
echo "=== Git LFS ==="
git lfs env 2>/dev/null | head -5 || echo "未启用 Git LFS"

# .gitignore 是否有常见忽略项
echo "=== .gitignore 缺失检查 ==="
for pattern in "*.log" "*.tmp" "*.apk" "*.exe" "*.zip" "node_modules" "dist/" "release/" ".env" "flowcube_backup.sql"; do
  grep -q "$pattern" .gitignore 2>/dev/null && \
    echo "✅ $pattern" || \
    echo "❌ 缺少: $pattern"
done
```

### 5.3 BFG Repo-Cleaner（如需移除历史中的大文件）

> **警告**：此操作会重写 Git 历史，仅应在确认需要时执行，且需要所有协作者同步。

```bash
# Docker 方式运行 BFG（无需安装 Java）
docker run -v /sessions/amazing-affectionate-allen/mnt/flowcube:/repo \
  openjdk:11-jre-slim bash -c "
    curl -L https://github.com/rtyley/bfg-repo-cleaner/releases/download/v1.14.0/bfg-1.14.0.jar -o bfg.jar
    java -jar bfg.jar --delete-files 'flowcube_backup.sql' /repo
    cd /repo && git reflog expire --expire=now --all && git gc --prune=now --aggressive
  "
```

---

## 六、综合自动化清理脚本

以下脚本组合了上述所有检查，以 **只读模式** 运行（仅报告，不删除）。预览运行后，确认每一项的输出再决定是否执行清理。

```bash
#!/usr/bin/env bash
# ============================================================
# FlowCube Cleanup & Security Scan — 只读预览模式
# 运行：bash scripts/cleanup-scan.sh
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT="$ROOT/.cleanup-report-$(date +%Y%m%d-%H%M%S).txt"
echo "FlowCube Cleanup Report" > "$REPORT"
echo "Generated: $(date)" >> "$REPORT"
echo "==========================================" >> "$REPORT"

echo "=========================================="
echo " FlowCube 代码清理扫描 — 只读模式"
echo "=========================================="

# ── 1. 文件系统扫描 ────────────────────────────────────────
echo ""
echo "[1/8] 扫描大文件和构建产物..."
find . -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/.playwright-cli/*' \
  -type f -size +5M -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $NF}' >> "$REPORT"

echo "[1/8] ✅ 大文件列表已记录"

# ── 2. 敏感文件扫描 ────────────────────────────────────────
echo ""
echo "[2/8] 扫描敏感文件..."
for pat in "*.pem" "*.key" "id_rsa" "id_ed25519" ".env" ".env.*"; do
  result=$(find . -name "$pat" -not -path './.git/*' 2>/dev/null)
  if [ -n "$result" ]; then
    echo "⚠️  敏感文件: $result" >> "$REPORT"
  fi
done
echo "[2/8] ✅ 敏感文件扫描完成"

# ── 3. 调试代码扫描 ────────────────────────────────────────
echo ""
echo "[3/8] 扫描遗留调试代码..."
grep -rn 'console\.log\|debugger' --include='*.{js,ts,tsx}' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  . 2>/dev/null | grep -v '//.*console' | head -40 >> "$REPORT"
echo "[3/8] ✅ 调试代码扫描完成"

# ── 4. 构建产物 ────────────────────────────────────────────
echo ""
echo "[4/8] 检查构建产物..."
for dir in "frontend/dist" "desktop/release" "backend/downloads"; do
  if [ -d "$dir" ]; then
    size=$(du -sh "$dir" 2>/dev/null | cut -f1)
    echo "📦 $dir ($size)" >> "$REPORT"
  fi
done
echo "[4/8] ✅ 构建产物检查完成"

# ── 5. 临时文件 ────────────────────────────────────────────
echo ""
echo "[5/8] 扫描临时文件..."
find . -name '.DS_Store' -not -path './.git/*' -type f -delete 2>/dev/null
find . -name '*.log' -not -path './.git/*' -not -path '*/node_modules/*' -type f >> "$REPORT"
echo "[5/8] ✅ 临时文件扫描完成（已自动清理 .DS_Store）"

# ── 6. Git 大文件跟踪 ─────────────────────────────────────
echo ""
echo "[6/8] 检查 Git 跟踪的大文件..."
git ls-files | while IFS= read -r f; do
  if [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    size=$(ls -lh "$f" | awk '{print $5}')
    echo "📏 $size $f" >> "$REPORT"
  fi
done
echo "[6/8] ✅ Git 大文件检查完成"

# ── 7. 依赖审计（仅摘要）─────────────────────────────────
echo ""
echo "[7/8] 运行 npm audit（后端）..."
cd "$ROOT/backend"
npm audit --production --audit-level=high 2>&1 | tail -5 >> "$REPORT"
cd "$ROOT"
echo "[7/8] ✅ 后端依赖审计完成"

# ── 8. 死代码统计 ─────────────────────────────────────────
echo ""
echo "[8/8] 统计未引用文件..."
export ROOT
# 后端 controller 引用检查
find "$ROOT/backend/src/modules" -name '*.controller.js' 2>/dev/null | while IFS= read -r f; do
  name=$(basename "$f" .js)
  if ! grep -rq "$name" "$ROOT/backend/src/modules" --include='*.routes.js' 2>/dev/null; then
    echo "❌ 未引用的 controller: $f" >> "$REPORT"
  fi
done
# 前端页面路由检查
find "$ROOT/frontend/src/pages" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | while IFS= read -r dir; do
  name=$(basename "$dir")
  if ! grep -rq "$name" "$ROOT/frontend/src/router" 2>/dev/null; then
    echo "⚠️  可能未注册的路由: $name" >> "$REPORT"
  fi
done
echo "[8/8] ✅ 死代码统计完成"

echo ""
echo "=========================================="
echo " 扫描完成！报告已保存："
echo " $REPORT"
echo "=========================================="
```

将以上内容保存为 `scripts/cleanup-scan.sh`，然后运行：

```bash
chmod +x scripts/cleanup-scan.sh
bash scripts/cleanup-scan.sh
```

---

## ⚠️ 注意事项（绝对不能删的文件）

| 文件/目录 | 原因 |
|-----------|------|
| `backend/src/database/` 下的迁移 SQL | 删除会导致新建环境无法初始化，只能标记为"已执行" |
| `frontend/components/ui/` | shadcn/ui 组件是手改的，不是通过 cli 管理，删了需要手动恢复 |
| `frontend/public/icons/` | PWA 图标和 manifest 引用 |
| `desktop/preload.js` | Electron IPC 桥接文件，缺了渲染进程无法通信 |
| `docker/*.conf` | Nginx 配置，缺了前端服务不工作 |
| `.gitignore` | 不要误删已有的忽略规则 |
| `deploy/production.example.json` | 保留作为新环境部署参考 |

### 确认安全的删除候选

| 文件/目录 | 状态 |
|-----------|------|
| `flowcube_backup.sql` | ✅ 如未入库可删除，有 `backups/` 目录管理 |
| `frontend/dist/` | ✅ 构建产物，CI 会重新生成 |
| `desktop/release/` | ✅ 构建产物，CI 会重新生成 |
| `frontend/android/.gradle/` | ✅ 缓存，运行 `pda:sync` 时会重新下载 |
| `frontend/logs/` | ✅ 运行时日志 |
| **`node_modules/`** | ✅ 任何端的 node_modules 都可以安全删除，`npm ci` 恢复 |
| `.tmp-flowcube-downloads/` | ✅ 临时下载目录 |
| `.playwright-cli/` | ✅ CI 环境才需要，本地可删除 |
| 所有 `*.log` 文件 | ✅ 运行时日志 |
| 所有 `.DS_Store` | ✅ macOS 系统文件 |

---

## 推荐执行顺序

```
Step 1: 运行 cleanup-scan.sh（只读报告）
   ↓
Step 2: 审查报告，确认无害的清理项
   ↓
Step 3: 执行 npm audit 修复高危漏洞
   ↓
Step 4: 删除已确认的构建产物和临时文件
   ↓
Step 5: 运行 depcheck 并审查未使用的依赖
   ↓
Step 6: 检查死代码（controller / page 引用）
   ↓
Step 7: 如有大文件在 Git 历史中，用 BFG 清理
   ↓
Step 8: 提交 .gitignore 补全和清理成果
   ↓
Step 9: 配置 Dependabot 每周依赖更新
   ↓
Step 10: 添加 gitleaks 或 trivy 到 CI 流程
```
