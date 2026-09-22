// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { useWorkspaceTabTitle } from './useWorkspaceTabTitle'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

test('详情数据已缓存时，子页先于父级注册标签也能显示业务单号', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  const host = document.createElement('div'), root = createRoot(host)
  function Detail() { useWorkspaceTabTitle('SO20260922001'); return null }
  function Outlet() {
    useEffect(() => { useWorkspaceStore.getState().syncFromLocation('/sale/42', '销售单 #42') }, [])
    return <Detail />
  }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/sale/42']}><Outlet /></MemoryRouter>))
    expect(useWorkspaceStore.getState().tabs[1].title).toBe('SO20260922001')
  } finally { act(() => root.unmount()) }
})
