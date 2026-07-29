// 小组件语义色调 token：图标底座与强调色。映射为静态 class（不能拼接动态字符串，
// 否则会被 Tailwind purge —— bg-success/10 这类是注册进 theme 后才生成的）。
// 单独成文件，让 WidgetShell / StatTile 只导出组件（利于 fast-refresh）。
export type WidgetTone = 'primary' | 'success' | 'warning' | 'info' | 'danger'

export const TONE_ICON: Record<WidgetTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info:    'bg-info/10 text-info',
  danger:  'bg-destructive/10 text-destructive',
}
