import { Link } from 'react-router-dom'

interface PageViewNavigationProps {
  label: string
  activePath: string
  views: readonly { path: string; label: string; to?: string }[]
  onSelect?: (path: string) => void
}

export function PageViewNavigation({ label, activePath, views, onSelect }: PageViewNavigationProps) {
  return (
    <nav aria-label={label} className="fc-underline-tabs mb-4">
      {views.map(view => (
        <Link
          key={view.path}
          to={view.to ?? view.path}
          onClick={event => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onSelect?.(view.path)
          }}
          aria-current={activePath === view.path ? 'page' : undefined}
          className={`min-h-10 border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activePath === view.path ? 'border-primary font-semibold text-foreground' : 'border-transparent font-normal text-muted-foreground hover:text-foreground'}`}
        >{view.label}</Link>
      ))}
    </nav>
  )
}
