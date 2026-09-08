import { createContext, useContext } from 'react'

/** 工作区、合并页和页内 Tab 的可见性；默认 true 兼容非工作区页面。 */
export const SectionVisibilityContext = createContext(true)
export const useSectionActive = () => useContext(SectionVisibilityContext)
