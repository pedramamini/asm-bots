/**
 * A page's `<h1>` where the page shows its name only in the chrome (the header's brand, the tab
 * title): hidden from sight, it heads the page in a screen reader's list of headings. Pages with a
 * visible `<h1>` (home, a bot, a profile, a docs page) do without.
 */
export function PageHeading({ children }: { children: string }) {
  return <h1 className="sr-only">{children}</h1>
}
