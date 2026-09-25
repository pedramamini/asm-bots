/** `share ▾` (`src/features/share/ShareMenu.tsx`), picked from a spec. */
import type { Locator, Page } from '@playwright/test'

/** Opens the `share ▾` inside `within` and picks `item`. */
export async function pickShare(
  page: Page,
  within: Locator,
  item: 'copy link' | 'copy embed' | 'download png',
): Promise<void> {
  await within.getByRole('button', { name: 'share ▾' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
