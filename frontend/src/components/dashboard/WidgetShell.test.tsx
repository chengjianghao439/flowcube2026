// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Boxes } from 'lucide-react'
import { WidgetShell } from './WidgetShell'

describe('卡片数据状态', () => {
  it('加载时不会误报空数据', () => {
    const html = renderToStaticMarkup(<WidgetShell title="库存" icon={Boxes} loading><p>暂无库存</p></WidgetShell>)
    expect(html).toContain('正在加载库存')
    expect(html).not.toContain('暂无库存')
  })
  it('请求失败时显示重试而非空数据', () => {
    const html = renderToStaticMarkup(<WidgetShell title="库存" icon={Boxes} error={new Error('网络异常')} onRetry={() => {}}><p>暂无库存</p></WidgetShell>)
    expect(html).toContain('重试')
    expect(html).not.toContain('暂无库存')
  })
})
