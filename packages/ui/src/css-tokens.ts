/** A rule of a token stylesheet: its selectors and its custom properties. */
export interface TokenRule {
  readonly selectors: readonly string[]
  readonly props: Readonly<Record<string, string>>
}

/**
 * The rules of a flat token stylesheet such as tokens.css: no nesting, no at-rules. Comments and
 * declarations that are not custom properties are dropped.
 */
export function parseTokenRules(css: string): TokenRule[] {
  const rules: TokenRule[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selectorText = '', body = ''] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props: Record<string, string> = {}
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      const name = declaration.slice(0, colon).trim()
      if (colon > 0 && name.startsWith('--')) props[name] = declaration.slice(colon + 1).trim()
    }
    const selectors = selectorText.split(',').map((s) => s.trim().replace(/\s+/g, ' '))
    rules.push({ selectors, props })
  }
  return rules
}

/**
 * The custom properties that `<html data-theme="theme">` gets from the rules; `null` for no
 * data-theme at all. As in the cascade, `:root[data-theme="…"]` beats `:root`, and a later rule
 * beats an earlier one of the same weight.
 */
export function themeTokens(
  rules: readonly TokenRule[],
  theme: string | null,
): Record<string, string> {
  const matched = rules
    .map((rule, order) => ({ rule, order, weight: weight(rule, theme) }))
    .filter((m) => m.weight > 0)
    .sort((a, b) => a.weight - b.weight || a.order - b.order)
  return Object.assign({}, ...matched.map((m) => m.rule.props))
}

/** How a rule's selectors match `<html data-theme="theme">`: 0 no match, 1 `:root`, 2 the theme. */
function weight(rule: TokenRule, theme: string | null): number {
  let best = 0
  for (const selector of rule.selectors) {
    const bare = selector.replace(/["']/g, '')
    if (theme !== null && bare === `:root[data-theme=${theme}]`) best = 2
    else if (bare === ':root') best = Math.max(best, 1)
  }
  return best
}
