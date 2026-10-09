/** Focus only; selection stays with each picker's guarded current result. */
export function moveFinderFocus<T>(event: React.KeyboardEvent<HTMLElement>, rows: T[], index: number,
  keyOf: (row: T) => number, scrollToIndex?: ((index: number) => void) | null,
  disabled: (row: T) => boolean = () => false): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !rows.length) return
  event.preventDefault()
  const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + direction
  while (next >= 0 && next < rows.length && disabled(rows[next])) next += direction
  if (next < 0 || next >= rows.length) return
  const node = event.currentTarget, table = node.closest('table'), key = String(keyOf(rows[next]))
  const focus = () => {
    if (!table?.isConnected) return true
    const target = [...table.querySelectorAll<HTMLElement>('[data-finder-key]')].find(row => row.dataset.finderKey === key)
    if (!target) return false
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return true
  }
  if (focus()) return
  scrollToIndex?.(next)
  let attempts = 0
  const afterScroll = () => { if (!focus() && ++attempts < 12) requestAnimationFrame(afterScroll) }
  requestAnimationFrame(afterScroll)
}
