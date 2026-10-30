// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getByRole, queryByRole } from '@testing-library/dom'
import { expect, test, vi } from 'vitest'
import PageHeader from './PageHeader'
import { PageHeaderContext } from './PageHeaderContext'
import { ActionBar } from './ActionBar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('page status stays with the title and the only caption contains the business rule', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), save = vi.fn()
  try {
    act(() => root.render(<PageHeader title="系统设置" description={<>保存后<strong>立即生效</strong></>} status={<span>编辑中</span>}
      actions={<button onClick={save}>保存修改</button>} />))
    const heading = getByRole(host, 'heading', { name: '系统设置', level: 1 })
    expect(heading.parentElement?.textContent).toContain('编辑中')
    expect(host.querySelector('.desktop-page-description')?.textContent).toBe('保存后立即生效')
    expect(host.querySelector('.desktop-page-description strong')?.textContent).toBe('立即生效')
    expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1)
    expect(host.textContent?.match(/保存后立即生效/g)).toHaveLength(1)
    expect(queryByRole(host, 'note')).toBeNull()
    act(() => getByRole(host, 'button', { name: '保存修改' }).click())
    expect(save).toHaveBeenCalledTimes(1)
  } finally { act(() => root.unmount()); host.remove() }
})

test('ordinary pages render no empty status or note row', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<PageHeader title="销售订单" description="核对销售明细、订单状态与回款。" />))
    expect(getByRole(host, 'heading', { name: '销售订单' })).toBeTruthy()
    expect(queryByRole(host, 'note')).toBeNull()
    expect(host.querySelector('.desktop-page-status')).toBeNull()
    expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1)
  } finally { act(() => root.unmount()); host.remove() }
})

test('merged page retains its group title, navigation, child actions and business scope', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<PageHeaderContext.Provider value={{ title: '资金工作区', navigation: <nav aria-label="资金视图"><a href="#/payments/payable">现结账款</a></nav> }}>
      <PageHeader title="现结供应商账款" description="月结付款请走对账单" actions={<button>登记付款</button>} />
    </PageHeaderContext.Provider>))
    expect(getByRole(host, 'heading', { name: '资金工作区' })).toBeTruthy()
    expect(getByRole(host, 'navigation', { name: '资金视图' })).toBeTruthy()
    expect(getByRole(host, 'button', { name: '登记付款' })).toBeTruthy()
    expect(host.querySelector('.desktop-page-description')?.textContent).toBe('月结付款请走对账单')
    expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1)
    expect(queryByRole(host, 'note')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

test('document headers use the same description and retain inline state and actions', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), save = vi.fn()
  try {
    act(() => root.render(<ActionBar title="新建采购单" description="核对采购仓库、到货日期与商品。"
      subtitle={<span>未保存</span>} rightActions={<button onClick={save}>保存</button>} />))
    expect(host.querySelector('.desktop-page-description')?.textContent).toBe('核对采购仓库、到货日期与商品。')
    expect(getByRole(host, 'heading', { name: '新建采购单' }).parentElement?.textContent).toContain('未保存')
    act(() => getByRole(host, 'button', { name: '保存' }).click())
    expect(save).toHaveBeenCalledTimes(1)
  } finally { act(() => root.unmount()); host.remove() }
})
