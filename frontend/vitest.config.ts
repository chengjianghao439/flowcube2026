import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * 前端单元测试（审计 4.3 起步）。
 * 先覆盖纯逻辑：labelGeometry 几何、金额/辅助单位换算、单据状态推导、权限码守卫。
 * 只跑单元测试，不跑组件渲染（无 jsdom，避免拖慢 CI）；需要 DOM 时再加 jsdom 环境。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'android', 'dist'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
