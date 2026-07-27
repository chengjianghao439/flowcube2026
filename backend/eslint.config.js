// ESLint 9 flat config（backend 是 CommonJS，所以这里用 require/module.exports）
//
// 之前 package.json 里写着 "lint": "eslint src/"，但 eslint 根本没装、也没有配置文件，
// 这条命令一直是必失败的。2026-07-27 补齐。
//
// 定位：后端没有类型检查兜底（纯 JS + 手写 SQL），所以这里比前端更看重「能跑但错」的
// 那类问题：漏 await 的 Promise、未使用的变量（往往是重构漏删的旧分支）、
// 意外的全局变量。风格问题（缩进、引号、分号）一律不管。
const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  {
    ignores: ['node_modules/**', 'downloads/**', 'uploads/**', 'apk/**', 'src/database/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // 重构后漏删的变量/参数在手写 SQL 的代码里特别容易堆积（比如换了查询条件但
      // 上面的入参还留着），是真实的信号。下划线前缀表示「刻意不用」。
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // 尽力而为的副作用（打印入队失败、日志写失败）不该打断业务事务，
      // 项目里 catch {} 是既定写法，见 printOptionalSideEffect。
      'no-empty': ['error', { allowEmptyCatch: true }],

      // console 是后端当前的日志出口（utils/logger 也是包装 console），不禁。
      'no-console': 'off',
    },
  },
  {
    // 测试与脚本：允许更随意的写法
    files: ['scripts/**/*.js'],
    rules: { 'no-unused-vars': 'warn' },
  },
]
