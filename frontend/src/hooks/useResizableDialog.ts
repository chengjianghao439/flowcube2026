/**
 * useResizableDialog — 可调尺寸弹窗逻辑 Hook
 *
 * 功能：
 * - 从 localStorage 加载持久化尺寸（key: flowcube-dialog-size-{dialogId}）
 * - 校验合法性（范围 + 类型），非法时回退默认值
 * - 提供右下角拖拽 resize 的鼠标事件处理
 * - 拖拽结束后自动持久化最终尺寸
 * - 拖拽时禁止页面文本选中
 *
 * resizable=false 时：
 * - 不读写 localStorage
 * - handleResizeMouseDown 为空操作
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { safeJsonParse } from '@/lib/safeJsonParse'

const STORAGE_PREFIX = 'flowcube-dialog-size-'

interface PersistedSize {
  width: number
  height: number
}

function loadPersistedSize(
  dialogId: string,
  defaultWidth: number,
  defaultHeight: number,
  minWidth: number,
  minHeight: number,
): PersistedSize {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + dialogId)
    if (!raw) return { width: defaultWidth, height: defaultHeight }

    const parsed = safeJsonParse<unknown>(raw, `${STORAGE_PREFIX}${dialogId}`, true)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).width !== 'number' ||
      typeof (parsed as Record<string, unknown>).height !== 'number'
    ) {
      return { width: defaultWidth, height: defaultHeight }
    }

    const { width, height } = parsed as PersistedSize

    // 合法性校验：小于最小值或超出合理上限则回退
    const maxSanity = 4000
    if (
      width < minWidth || height < minHeight ||
      width > maxSanity || height > maxSanity
    ) {
      return { width: defaultWidth, height: defaultHeight }
    }

    return { width, height }
  } catch {
    return { width: defaultWidth, height: defaultHeight }
  }
}

// ─── 公共类型 ─────────────────────────────────────────────────────────────────

export interface UseResizableDialogOptions {
  dialogId: string
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  /** 是否启用 resize（false 时不读写 localStorage，不显示 handle）*/
  resizable?: boolean
}

export interface UseResizableDialogReturn {
  width: number
  height: number
  /** 绑定到 resize handle 的 onMouseDown 事件处理器 */
  handleResizeMouseDown: (e: React.MouseEvent) => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useResizableDialog({
  dialogId,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  resizable = true,
}: UseResizableDialogOptions): UseResizableDialogReturn {
  const [size, setSize] = useState<PersistedSize>(() =>
    resizable
      ? loadPersistedSize(dialogId, defaultWidth, defaultHeight, minWidth, minHeight)
      : { width: defaultWidth, height: defaultHeight },
  )

  // 用 ref 同步跟踪当前尺寸，供拖拽回调中（闭包外）使用
  const currentSizeRef = useRef(size)
  useEffect(() => {
    currentSizeRef.current = size
  }, [size])

  // 拖拽起始快照
  const dragStartRef = useRef<{
    mouseX: number
    mouseY: number
    initW: number
    initH: number
  } | null>(null)

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!resizable) return
      e.preventDefault()
      e.stopPropagation()

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        initW: currentSizeRef.current.width,
        initH: currentSizeRef.current.height,
      }

      // 拖拽期间禁止文本选中
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return
        const dx = ev.clientX - dragStartRef.current.mouseX
        const dy = ev.clientY - dragStartRef.current.mouseY

        // 动态计算允许的最大尺寸（相对当前视口）
        const maxW = Math.floor(window.innerWidth * 0.95)
        const maxH = Math.floor(window.innerHeight * 0.9)

        const newW = Math.min(Math.max(dragStartRef.current.initW + dx, minWidth), maxW)
        const newH = Math.min(Math.max(dragStartRef.current.initH + dy, minHeight), maxH)

        currentSizeRef.current = { width: newW, height: newH }
        setSize({ width: newW, height: newH })
      }

      const onMouseUp = () => {
        dragStartRef.current = null
        document.body.style.userSelect = ''

        // 拖拽结束后持久化最终尺寸
        localStorage.setItem(
          STORAGE_PREFIX + dialogId,
          JSON.stringify(currentSizeRef.current),
        )

        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [resizable, minWidth, minHeight, dialogId],
  )

  return {
    width: size.width,
    height: size.height,
    handleResizeMouseDown,
  }
}
