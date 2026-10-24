import type { ComponentProps } from 'react'
import { ResponsiveContainer } from 'recharts'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

type ChartContainerProps = Pick<ComponentProps<typeof ResponsiveContainer>, 'children' | 'width' | 'height'>

export function ChartContainer({ children, width = '100%', height = '100%' }: ChartContainerProps) {
  const active = useSectionActive()
  if (!active) return <div aria-hidden style={{ width, height }} />
  return <ResponsiveContainer className="fc-chart-container" width={width} height={height}>{children}</ResponsiveContainer>
}
