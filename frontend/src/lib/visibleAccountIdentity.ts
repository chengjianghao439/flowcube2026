export function visibleAccountIdentity(user: { username?: string; realName?: string; roleName?: string }) {
  if (/^(codex_|smoke_|esc_|pc_)/i.test(user.username || '') || (user.username || '').toLowerCase() === 'cua_pda_test') {
    return { name: '当前用户', account: '—', role: '—' }
  }
  return { name: user.realName || user.username || '当前用户', account: user.username || '—', role: user.roleName || '—' }
}
