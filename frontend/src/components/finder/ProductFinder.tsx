/**
 * ProductFinder — re-exports the existing ProductFinderModal under the unified finder path.
 *
 * The ProductFinderModal has a two-panel layout (category tree + product table)
 * that is specific to product selection and does not fit the generic FinderModal pattern.
 * All callers share this implementation; mode and warehouse context control auxiliary columns.
 */
export { default as ProductFinder } from '@/components/shared/ProductFinderModal'
export type { ProductFinderModalProps as ProductFinderProps } from '@/components/shared/ProductFinderModal'
