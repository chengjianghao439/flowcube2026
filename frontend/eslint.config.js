// ESLint 9 flat config（frontend 是 "type": "module"，所以这里用 ESM 写法）
//
// 依赖早就装在 package.json 里了（eslint 9 / typescript-eslint 8 / react-hooks /
// react-refresh），缺的一直只是这个配置文件，导致 `npm run lint` 直接报错退出。
//
// 定位：lint 只管 tsc 管不到的那一类问题——失效的 hooks 依赖、误用的 async、
// 漏删的调试代码。类型正确性归 `tsc -p tsconfig.app.json --noEmit`，两者不重叠，
// 所以这里刻意关掉所有与类型检查重复或纯风格的规则（缩进、引号、分号交给编辑器）。
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // dist / android 是构建产物与原生工程；generated 由 npm run generate:status 生成，
    // 手改会被覆盖，lint 它没有意义。
    ignores: ['dist/**', 'android/**', 'node_modules/**', 'src/generated/**', 'public/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, __DEV_LOCAL_BACKEND__: 'readonly' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // keepAlive 多标签工作区下，hooks 依赖写漏会表现成「切回标签页数据不刷新」，
      // 是这个项目真实踩过的坑。2026-07-27 清完 13 处存量后恢复为 error。
      // 唯一一处 eslint-disable 在 pages/categories/index.tsx（表单重置刻意只认 id，
      // 不认对象引用），那里写明了理由——新增 disable 也请照此写清楚为什么。
      'react-hooks/exhaustive-deps': 'error',

      // 热更新边界：非组件导出会让整文件失去 HMR。项目里有大量「组件 + 常量」同文件的
      // 既有写法，降为 warn 而不是强行拆文件。
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // any 在这个仓库里主要出现在与后端信封解包、第三方库交接的地方，
      // 一律禁掉会逼出大量无意义的类型体操；交给 code review 判断。
      '@typescript-eslint/no-explicit-any': 'off',

      // 未使用变量：tsc 的 noUnusedLocals/noUnusedParameters 已经在管，
      // 这里只补一条 tsc 不管的——下划线前缀视为「刻意不用」。
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        // `({ _key, originalQty, ...r }) => r` 是全项目通用的「解构剔除字段」写法
        // （提交前把仅供 UI 用的列摘掉），被剔掉的名字当然不会再被使用。
        ignoreRestSiblings: true,
      }],

      // 生产代码里漏下的 console.log 会把用户数据打进浏览器控制台。
      // warn/error 放行（前端确实用它们报异常）。
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // 全角空格 U+3000 在 JSX 文案里是**刻意的中文排版**（如「12 种　合计数量：34」），
      // 换成半角会让间距变窄。只在代码位置上禁止它（那才是真会出事的地方——
      // 粘贴中文时混进标识符或运算符之间）。
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true }],

      // 空块：catch {} 在这个项目里是常用写法（打印、剪贴板等尽力而为的副作用，
      // 失败了本来就不该打断主流程）。其余空块仍然报错。
      'no-empty': ['error', { allowEmptyCatch: true }],

      // `let timer: number | undefined` + 稍后赋值，中间有闭包先读它（清理函数要能在
      // 赋值前就安全调用）——这种声明无法改写成 const，不是遗漏。
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // 配置文件跑在 Node 里，不是浏览器环境
    files: ['*.config.{js,ts}', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: { globals: globals.node },
  },
)
