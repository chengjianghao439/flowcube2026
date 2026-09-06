import { createContext, type ReactNode } from 'react'

/** 合并页面只统一页名与导航，子页继续提供自己的说明和动作。 */
export const PageHeaderContext = createContext<{ title: string; navigation: ReactNode } | null>(null)
