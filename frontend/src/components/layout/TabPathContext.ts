import { createContext } from 'react'

/**
 * 供动态路由页面读取自己所属 Tab 的路径。
 * 例：TabPanel 渲染 /pda/task/123 时，此 context value 为 "/pda/task/123"。
 */
export const TabPathContext = createContext<string>('')
