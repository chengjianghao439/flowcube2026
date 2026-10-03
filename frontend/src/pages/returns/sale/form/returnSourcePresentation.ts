/** Service financial deltas are four-place values, including amounts below .01. */
export const returnNet = (value: number) => Number(value).toFixed(4)
