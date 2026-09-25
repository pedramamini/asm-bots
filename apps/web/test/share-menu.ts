import { act, fireEvent, screen, within } from '@testing-library/react'

/** What `share ▾` offers (`src/features/share/ShareMenu.tsx`). */
export type ShareItem = 'copy link' | 'copy embed' | 'download png'

/**
 * Opens the `share ▾` inside `container` and picks `item`, and lets what it starts (a clipboard
 * write, its toast) settle inside `act`.
 */
export async function pickShare(container: HTMLElement, item: ShareItem): Promise<void> {
  fireEvent.click(within(container).getByRole('button', { name: 'share ▾' }))
  const entry = await screen.findByRole('menuitem', { name: item })
  await act(async () => {
    fireEvent.click(entry)
  })
}
