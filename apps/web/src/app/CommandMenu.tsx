import { CommandPalette, type PaletteCommand } from '@asmbots/ui'
import { THEMES } from '@asmbots/ui/themes'
import { useRouter } from '@tanstack/react-router'
import { GitFork, Keyboard, Palette, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { useSettings } from '../store/settings'
import { NAV } from './Frame'
import { goKey } from './keymaps'
import { SOURCE_URL } from './site'

export interface CommandMenuProps {
  /** The search it opens with: `theme` from the header's palette button. */
  query: string
  onClose: () => void
  /** Opens the key help. */
  onKeys: () => void
}

/**
 * The `mod+k` menu: the header's routes, the themes (the current one checked), the settings page,
 * the key help, and the source. Its own chunk: the frame loads it on the first `mod+k`.
 */
export function CommandMenu({ query, onClose, onKeys }: CommandMenuProps) {
  const router = useRouter()
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...NAV.map(({ to, label, icon, key }) => ({
        id: `go:${to}`,
        group: 'go',
        label: `go to ${label}`,
        icon,
        keys: goKey(key, label).keys,
        run: () => void router.navigate({ to }),
      })),
      ...THEMES.map((name) => ({
        id: `theme:${name}`,
        group: 'theme',
        label: name,
        icon: Palette,
        keywords: 'color look',
        current: name === theme,
        run: () => setTheme(name),
      })),
      {
        id: 'settings',
        group: 'site',
        label: 'settings',
        icon: Settings,
        keywords: 'preferences sound motion effects',
        run: () => void router.navigate({ to: '/settings' }),
      },
      {
        id: 'keys',
        group: 'site',
        label: 'show the keys',
        icon: Keyboard,
        keys: ['?'],
        run: onKeys,
      },
      {
        id: 'source',
        group: 'site',
        label: 'source on github',
        icon: GitFork,
        keywords: 'code repository',
        run: () => void window.open(SOURCE_URL, '_blank', 'noopener'),
      },
    ],
    [router, theme, setTheme, onKeys],
  )
  return <CommandPalette open onClose={onClose} commands={commands} query={query} />
}
