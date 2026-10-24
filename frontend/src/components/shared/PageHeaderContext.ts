import { createContext, type ReactNode } from 'react'

/** 合并页面统一页名与导航，子页提供唯一的小字说明、标题旁状态和动作；有提示时优先显示提示。 */
export const PageHeaderContext = createContext<{ title: string; navigation: ReactNode } | null>(null)
