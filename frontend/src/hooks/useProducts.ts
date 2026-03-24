import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCategoriesApi, createCategoryApi, updateCategoryApi, deleteCategoryApi, getProductsApi, getProductsActiveApi, createProductApi, updateProductApi, deleteProductApi, getProductsForFinderApi } from '@/api/products'
import type { QueryParams } from '@/types'
import type { CreateProductParams, UpdateProductParams, ProductFinderParams } from '@/types/products'

const K = 'products'
const KC = 'product-categories'
export const useCategories      = () => useQuery({ queryKey:[KC], queryFn:getCategoriesApi, staleTime:600000 })
export const useProducts        = (p: QueryParams) => useQuery({ queryKey:[K,p], queryFn:()=>getProductsApi(p) })
export const useProductsActive  = () => useQuery({ queryKey:[K,'active'], queryFn:getProductsActiveApi, staleTime:600000 })
export const useProductFinder   = (p: ProductFinderParams, enabled=true) =>
  useQuery({ queryKey:[K,'finder',p], queryFn:()=>getProductsForFinderApi(p), enabled, placeholderData:(prev) => prev })
export function useCreateCategory() { const qc=useQueryClient(); return useMutation({ mutationFn:createCategoryApi, onSuccess:()=>qc.invalidateQueries({queryKey:[KC]}) }) }
export function useUpdateCategory() { const qc=useQueryClient(); return useMutation({ mutationFn:({id,d}:{id:number;d:{name:string;sort?:number}})=>updateCategoryApi(id,d), onSuccess:()=>qc.invalidateQueries({queryKey:[KC]}) }) }
export function useDeleteCategory() { const qc=useQueryClient(); return useMutation({ mutationFn:deleteCategoryApi, onSuccess:()=>qc.invalidateQueries({queryKey:[KC]}) }) }
export function useCreateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:(d:CreateProductParams)=>createProductApi(d), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useUpdateProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:({id,data}:{id:number;data:UpdateProductParams})=>updateProductApi(id,data), onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
export function useDeleteProduct() { const qc=useQueryClient(); return useMutation({ mutationFn:deleteProductApi, onSuccess:()=>qc.invalidateQueries({queryKey:[K]}) }) }
