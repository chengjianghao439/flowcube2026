import type { ReactNode } from 'react'

/** 富文本的标点由各个业务提示写在对应节点内。 */
export function PageDescription({ children }: { children: ReactNode }) {
  let content = children
  if (typeof children === 'string') {
    const text = children.trimEnd().replace(/[。.!?！？…]+$/u, '')
    if (!text) return null
    content = `${text}。`
  }
  if (content == null || typeof content === 'boolean') return null
  return <p className="desktop-page-description mt-1 text-xs leading-5 text-muted-foreground">{content}</p>
}
