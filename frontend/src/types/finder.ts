import type { ReactNode } from 'react'

/** Unified selection result returned by all Finder components. */
export interface FinderResult {
  id: number
  name: string
  code?: string
  contact?: string | null
  phone?: string | null
}

/** Column definition for FinderTable / FinderModal. */
export interface FinderColumn<T = Record<string, unknown>> {
  key: string
  title: string
  /** Fixed pixel width, or any valid CSS grid track value (e.g. '120px', '1fr'). */
  width?: number | string
  render?: (value: unknown, row: T) => ReactNode
}
