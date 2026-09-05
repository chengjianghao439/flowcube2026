import type { ReactNode } from 'react'

/** 导入只负责排版；文件选择、上传和结果处理仍由业务页面管理。 */
export function ImportSteps({ template, upload }: { template: ReactNode; upload: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div><h3 className="text-sm font-medium">准备数据</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">下载模板，按列填写并保留原表头。</p></div>
      {template}
    </section>
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div><h3 className="text-sm font-medium">上传文件</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">选择文件后开始导入，结果显示在下方。</p></div>
      {upload}
    </section>
  </div>
}
