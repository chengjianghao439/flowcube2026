export const MEASURE_EVENT = 'flowcube-party-print-measure'
export const PARTY_PRINT_FIT_EVENT = 'flowcube-party-print-fit'

/** Refresh only mounted party fields. Hidden/unmeasurable boxes remain unknown. */
export function refreshPartyPrintFields(root: HTMLElement) {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('[data-party-print-field]'))
  for (const box of boxes) box.dispatchEvent(new Event(MEASURE_EVENT))
  return {
    overflow: [...new Set(boxes.filter(box => box.dataset.printFit === 'overflow').map(box => box.dataset.partyPrintLabel || '资料'))],
    unavailable: boxes.some(box => box.dataset.printFit === 'unavailable' || box.dataset.printFit === 'pending'),
  }
}
