import { useContext, useEffect, useRef, useState, type FocusEvent } from 'react'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'

/** 独立录入弹窗的草稿/关闭保护；不接管 API 或业务成功回执。 */
export function useDialogDraftGuard({ open, identity, dirty, pending = false, onClose }: {
  open: boolean; identity: string | number; dirty: boolean; pending?: boolean; onClose: () => void
}) {
  const active = useSectionActive(), tabPath = useContext(TabPathContext)
  const context = useRef({ open, identity, active, generation: 0 })
  if (context.current.open !== open || context.current.identity !== identity || context.current.active !== active) {
    context.current = { open, identity, active, generation: context.current.generation + 1 }
  }
  const generation = context.current.generation
  const mounted = useRef(false), submission = useRef<number | null>(null)
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [discard, setDiscard] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null), fieldRef = useRef<HTMLElement | null>(null)
  const focusRef = useRef<HTMLElement | null>(null), resumeRef = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = (epoch: number) => mounted.current && context.current.open && context.current.active && context.current.generation === epoch
  const locked = pending || submitting === generation
  useDirtyGuard(tabPath, open && (dirty || locked))

  function requestClose() {
    if (!current(generation) || pending || submission.current === generation) return
    if (!dirty) { onClose(); return }
    const focused = document.activeElement
    focusRef.current = focused instanceof HTMLElement && focused.matches('input,select,textarea,[role="combobox"]') ? focused : fieldRef.current
    resumeRef.current = false
    setDiscard(generation)
  }
  function rememberFocus(event: FocusEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.matches('input,select,textarea,[role="combobox"]')) fieldRef.current = event.target
  }
  function beginSubmit() {
    if (!current(generation) || pending || submission.current === generation) return null
    submission.current = generation; setSubmitting(generation)
    return {
      finish: () => {
        if (submission.current === generation) { submission.current = null; setSubmitting(null) }
        return current(generation)
      },
    }
  }
  return {
    locked, requestClose, beginSubmit, contentRef, rememberFocus,
    canEdit: () => current(generation) && !pending && submission.current !== generation,
    discardProps: {
      open: open && active && discard === generation,
      title: '放弃未保存的修改？', description: '当前填写内容尚未保存。放弃后需要重新填写。',
      confirmText: '放弃修改', cancelText: '继续编辑',
      onConfirm: () => { resumeRef.current = false; setDiscard(null); if (current(generation)) onClose() },
      onCancel: () => { resumeRef.current = true; setDiscard(null) },
      onCloseAutoFocus: (event: Event) => {
        if (!resumeRef.current) return
        resumeRef.current = false; event.preventDefault()
        if (!current(generation)) return
        const content = contentRef.current, target = focusRef.current
        if (target?.isConnected && content?.contains(target) && !target.matches(':disabled')) target.focus({ preventScroll: true })
        else content?.focus({ preventScroll: true })
      },
    },
  }
}
