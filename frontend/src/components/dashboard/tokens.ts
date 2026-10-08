// 小组件语义色调 token：图标底座与强调色。映射为静态 class（不能拼接动态字符串，
// 否则会被 Tailwind purge —— bg-success/10 这类是注册进 theme 后才生成的）。
// 单独成文件，让 WidgetShell / StatTile 只导出组件（利于 fast-refresh）。
export type WidgetTone = 'primary' | 'success' | 'warning' | 'info' | 'danger'

export const TONE_ICON: Record<WidgetTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success-ink',
  warning: 'bg-warning/10 text-warning-ink',
  info:    'bg-info/10 text-info-ink',
  danger:  'bg-destructive/10 text-destructive-ink',
}

// StatTile 的 accent 模式：整卡浅色调 + tone 色值（tone='danger' 即「红底红字」告警卡）。
export const TONE_CARD: Record<WidgetTone, string> = {
  primary: 'border-primary/20 bg-primary/5',
  success: 'border-success/20 bg-success/5',
  warning: 'border-warning/20 bg-warning/5',
  info:    'border-info/20 bg-info/5',
  danger:  'border-destructive/20 bg-destructive/5',
}

// StatTile 的 accent 模式下的大数值文字色。
export const TONE_TEXT: Record<WidgetTone, string> = {
  primary: 'text-primary',
  success: 'text-success-ink',
  warning: 'text-warning-ink',
  info:    'text-info-ink',
  danger:  'text-destructive-ink',
}
