/**
 * usePrint — PDA / ERP 触发打印 Hook
 *
 * 用法：
 *  const { print, printing } = usePrint()
 *  await print({ printerId: 1, title: '包裹标签', content: html, contentType: 'html' })
 */
import { useState, useCallback } from 'react'
import axios from 'axios'
import { toast } from '@/lib/toast'

interface PrintParams {
  printerId: number
  title: string
  content: string
  contentType?: 'html' | 'zpl' | 'text'
  copies?: number
  templateId?: number
}

export function usePrint() {
  const [printing, setPrinting] = useState(false)

  const print = useCallback(async (params: PrintParams) => {
    setPrinting(true)
    try {
      const res = await axios.post('/api/print-jobs', {
        printerId:   params.printerId,
        title:       params.title,
        content:     params.content,
        contentType: params.contentType || 'html',
        copies:      params.copies || 1,
        templateId:  params.templateId,
      })
      toast.success(`打印任务已发送：${params.title}`)
      return res.data.data
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '打印失败')
      throw e
    } finally {
      setPrinting(false)
    }
  }, [])

  return { print, printing }
}
