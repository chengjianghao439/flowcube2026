import { useMemo, useState } from 'react'

type TreeNode<T> = { id: number; name: string; code?: string | null; children?: T[] }

export type TreeTableRow<T> = {
  id: number
  node: T
  depth: number
  expandable: boolean
  expanded: boolean
}

export function useTreeTable<T extends TreeNode<T>>(tree: readonly T[]) {
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const keyword = search.trim().toLowerCase()
  const searching = Boolean(keyword)

  const { rows, parents, branches, total } = useMemo(() => {
    const ordered: { node: T; depth: number; parentId: number | null }[] = []
    const parents = new Map<number, number | null>()
    const branches = new Set<number>()
    function visit(nodes: readonly T[], depth: number, parentId: number | null) {
      for (const node of nodes) {
        ordered.push({ node, depth, parentId })
        parents.set(node.id, parentId)
        if (node.children?.length) {
          branches.add(node.id)
          visit(node.children, depth + 1, node.id)
        }
      }
    }
    visit(tree, 0, null)

    const matches = new Set<number>()
    const matchingBranches = new Set<number>()
    if (keyword) {
      // 逆序把命中从后代传给祖先，显示完整路径且无需重复遍历子树。
      for (const { node, parentId } of ordered.slice().reverse()) {
        if (matchingBranches.has(node.id) || node.name.toLowerCase().includes(keyword) || node.code?.toLowerCase().includes(keyword)) {
          matches.add(node.id)
          if (parentId != null) matchingBranches.add(parentId)
        }
      }
    }

    const rows: TreeTableRow<T>[] = []
    const openIds = new Set<number>()
    for (const { node, depth, parentId } of ordered) {
      if (keyword ? !matches.has(node.id) : parentId != null && !openIds.has(parentId)) continue
      const expandable = keyword ? matchingBranches.has(node.id) : branches.has(node.id)
      const expanded = expandable && (Boolean(keyword) || expandedIds.has(node.id))
      if (expanded) openIds.add(node.id)
      rows.push({ id: node.id, node, depth, expandable, expanded })
    }
    return { rows, parents, branches, total: ordered.length }
  }, [tree, expandedIds, keyword])

  function toggle(id: number) {
    if (searching) return
    setExpandedIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function revealChildren(id: number) {
    setExpandedIds(previous => {
      const next = new Set(previous)
      for (let ancestor: number | null | undefined = id; ancestor != null; ancestor = parents.get(ancestor)) {
        next.add(ancestor)
      }
      return next
    })
  }

  return {
    rows, total, search, setSearch, searching, toggle, revealChildren,
    expandAll: () => setExpandedIds(branches),
    collapseAll: () => setExpandedIds(new Set()),
  }
}
