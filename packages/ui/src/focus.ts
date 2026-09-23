/**
 * The elements Tab stops on: links, enabled form controls, and any element with a tabindex that
 * is not -1. A roving group's other members and an open menu's items are at tabindex -1, so the
 * group's one stop is the only one that counts.
 */
export const TABBABLE =
  ':is(a[href],button:not(:disabled),input:not(:disabled,[type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]):not([tabindex="-1"])'

/** The Tab stops inside `root`, in document order. */
export function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)]
}
