/** Nested Radix overlays must share the layer and focus stacks. The locked
 * component versions otherwise resolve different private copies of these
 * modules, causing Escape to dismiss both the calendar and its parent dialog. */
export const radixSingletons = ['@radix-ui/react-dismissable-layer', '@radix-ui/react-focus-scope']
