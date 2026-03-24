/**
 * ProductFinder — re-exports the existing ProductFinderModal under the unified finder path.
 *
 * The ProductFinderModal has a two-panel layout (category tree + product table)
 * that is specific to product selection and does not fit the generic FinderModal pattern.
 * It is kept as-is; this file provides a consistent import path within the finder system.
 */
export { default as ProductFinder } from '@/components/shared/ProductFinderModal'
export type { ProductFinderModalProps as ProductFinderProps } from '@/components/shared/ProductFinderModal'
