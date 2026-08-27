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

// 只替换 defaultConfig 块内的值（不碰块外可能出现同名段）。
// 两个坑（2026-08-27 实测）：
//  1. 必须在**当前** gradle 内容上重新锚定块——首次替换（versionCode）会改变块文本，
//     若仍用最初读取的 cfgMatch 快照做第二次替换（versionName），replace 会因
//     「快照文本已不存在于文件」而静默不生效（versionName 漏改、无报错）。
//  2. after === before 可能是「恒等替换」（同版本重跑时值与模式一致），是正常幂等
//     路径，不抛错——真正的「未匹配」由锚定正则为 null 捕获。
const replaceInDefault = (pat, repl) => {
  const m = gradle.match(/defaultConfig\s*\{([\s\S]*?)\}/)
  if (!m) throw new Error('build.gradle 中找不到 defaultConfig 块')
  const before = m[0]
  const after = before.replace(pat, repl)
  if (after !== before) {
    gradle = gradle.replace(before, after)
  }
}
replaceInDefault(/versionCode\s+\d+/, `versionCode ${nextCode}`)
replaceInDefault(/versionName\s+"[^"]*"/, `versionName "${version}"`)
// 写盘前的最终校验：字段必须真实落盘，杜绝静默漏改。
// 同版本重跑时替换是恒等替换（值未变），绕过本校验是对的——只拦「发生了替换但文件没变」。
if (curName !== version) {
  if (!gradle.includes(`versionName "${version}"`) || !gradle.includes(`versionCode ${nextCode}`)) {
    throw new Error('build.gradle 写盘校验失败：版本字段未全部更新')
  }
}
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
