#!/usr/bin/env bash
# 同步递增三端版本号（backend / frontend / desktop）到同一个值。
#
# 为什么三端要一致：版本号是整个系统的统一标识。后端 /health、桌面端关于页、
# 桌面自动更新(latest.json) 都各读各自 package.json 的 version；三端不一致会让
# 线上排查“到底跑的哪一版”变得混乱。desktop/package.json 还是 git tag 的唯一来源
# （release-desktop-tag.sh 据它生成 v<version>），所以它必须准确。
#
# 用法: bash bump-version.sh <version>     例: bash bump-version.sh 0.4.8
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "用法: bash bump-version.sh <version>   例: 0.4.8" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ 版本号格式应为 x.y.z（如 0.4.8）" >&2
  exit 1
fi

# 定位仓库根：脚本在 .claude/skills/release-flowcube/scripts/ 下，但发布要在项目根跑。
# 优先用当前工作目录（应为项目根），校验三端目录存在。
ROOT="$(pwd)"
for d in backend frontend desktop; do
  if [[ ! -f "$ROOT/$d/package.json" ]]; then
    echo "❌ 找不到 $d/package.json —— 请在 flowcube 项目根目录运行本脚本" >&2
    exit 1
  fi
done

echo "将三端版本统一设为: $VERSION"
for d in backend frontend desktop; do
  ( cd "$ROOT/$d" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null )
  echo "  ✓ $d -> $(node -p "require('$ROOT/$d/package.json').version")"
done

# PDA（Android）版本必须一起升，否则 PDA 端永远检测不到更新：
#   frontend/android/app/build.gradle  APK 内置版本（versionName + versionCode）
#   backend/apk/version.json           后端对 PDA 公布的版本（PDA 拿它跟自己比对）
# 两者不一致或没递增，PDA 就会认为「已是最新」。历史上正因本脚本漏掉这一步，
# PDA 端自 v0.3.80 起停更约 30 个版本 —— 每次 CI 都重新构建并上传了最新 APK，
# 但公布的版本号一直没变，客户端从不下载。
GRADLE="$ROOT/frontend/android/app/build.gradle"
APK_JSON="$ROOT/backend/apk/version.json"
if [[ -f "$GRADLE" && -f "$APK_JSON" ]]; then
  node - "$VERSION" "$GRADLE" "$APK_JSON" "$ROOT" <<'NODE'
const fs = require('fs')
const [version, gradlePath, apkJsonPath, root] = process.argv.slice(2)

let gradle = fs.readFileSync(gradlePath, 'utf8')

// 锚定到 defaultConfig 块内的 versionCode / versionName，避免误匹配其他位置的同类字段
const cfgMatch = gradle.match(/defaultConfig\s*\{([\s\S]*?)\}/)
if (!cfgMatch) throw new Error('build.gradle 中找不到 defaultConfig 块')
const cfg = cfgMatch[1]
const codeMatch = cfg.match(/versionCode\s+(\d+)/)
const nameMatch = cfg.match(/versionName\s+"([^"]*)"/)
if (!codeMatch) throw new Error('defaultConfig 中找不到 versionCode')
if (!nameMatch) throw new Error('defaultConfig 中找不到 versionName')
const curName = nameMatch[1]
const curCode = Number(codeMatch[1])
if (!Number.isInteger(curCode) || curCode <= 0) throw new Error(`versionCode 非法: ${curCode}`)

// 幂等核心（2026-08-26 修复）：只有真正切换到新版本（versionName 变化）才递增 versionCode。
// 同一版本重跑（如补写 release notes 后重跑本脚本）不得重复 +1 ——
// 历史教训：v0.7.0/v0.7.1 连续两次因重跑把 versionCode 递增了两次（99→100 / 100→101），
// 均需手工修正，风险是 PDA 端跳过版本、CI 构建跑两遍。
let nextCode = curCode
if (curName !== version) {
  nextCode = curCode + 1
} else {
  console.log(`  ! versionName 已是 ${version}（同版本重跑），versionCode 保持 ${curCode} 不变`)
}

// 只替换 defaultConfig 块内的值（不碰块外可能出现同名段）
const replaceInDefault = (pat, repl) => {
  const before = cfgMatch[0]
  const after = before.replace(pat, repl)
  gradle = gradle.replace(before, after)
}
replaceInDefault(/versionCode\s+\d+/, `versionCode ${nextCode}`)
replaceInDefault(/versionName\s+"[^"]*"/, `versionName "${version}"`)
fs.writeFileSync(gradlePath, gradle)

const apk = JSON.parse(fs.readFileSync(apkJsonPath, 'utf8'))
// version.json 与 build.gradle 的 versionCode 必须一致（历史曾出现 101/100 不一致，
// 以 gradle 为准并对齐 JSON —— PDA 下载判新旧依据的是 version.json 公布值）
const jsonCode = Number(apk.versionCode)
if (Number.isInteger(jsonCode) && jsonCode !== nextCode && curName !== version) {
  console.log(`  ! version.json.versionCode(${jsonCode}) 与 build.gradle(${nextCode}) 不一致，已对齐`)
}
apk.version = version
const codeChanged = nextCode !== curCode
apk.versionCode = nextCode
// PDA 更新提示会展示发布时间：只有真正切换版本（versionCode 变化）才刷新，
// 同版本重跑（补 notes）不应虚更新日期
if (codeChanged) {
  apk.publishedAt = new Date().toISOString()
}
// 更新说明取本版 release notes 的首段（PDA 更新提示里展示给用户）
const notesPath = `${root}/docs/release-notes/${version}.md`
if (fs.existsSync(notesPath)) {
  const para = fs.readFileSync(notesPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  if (para) apk.releaseNote = para
} else {
  console.log(`  ! 未找到 docs/release-notes/${version}.md，PDA 更新说明沿用上一版，请写完 notes 后重跑本脚本`)
}
fs.writeFileSync(apkJsonPath, `${JSON.stringify(apk, null, 2)}\n`)
console.log(`  ✓ PDA -> ${version} (versionCode ${curCode} → ${nextCode})`)
NODE
else
  echo "  ! 跳过 PDA 版本同步（未找到 build.gradle 或 backend/apk/version.json）"
fi

echo "完成。三端 package.json/package-lock 与 PDA 版本已更新（尚未 commit）。"
