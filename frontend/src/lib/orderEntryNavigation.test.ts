// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { focusOrderEntryField } from './orderEntryNavigation'

afterEach(() => { document.body.replaceChildren() })

it('只定位当前表单内活动且可编辑的同名字段', () => {
  document.body.innerHTML = `
    <section hidden><div data-entry-field="warehouse"><button>旧页</button></div></section>
    <form>
      <div data-entry-field="warehouse" hidden><input></div>
      <div data-entry-field="warehouse"><button disabled>清空</button><input value="保留输入"></div>
    </form>`
  const form = document.querySelector('form')!
  const input = form.querySelector<HTMLInputElement>('input[value]')!
  const scroll = vi.fn()
  input.scrollIntoView = scroll
  expect(focusOrderEntryField(form, 'warehouse')).toBe(true)
  expect(document.activeElement).toBe(input)
  expect(input.selectionEnd).toBe(input.value.length)
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  expect(focusOrderEntryField(form, 'missing')).toBe(false)
  form.setAttribute('inert', '')
  expect(focusOrderEntryField(form, 'warehouse')).toBe(false)
})
