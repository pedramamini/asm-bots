import { CommandPalette, type PaletteCommand, useToast } from '@asmbots/ui'
import { THEMES } from '@asmbots/ui/themes'
import { useRouter } from '@tanstack/react-router'
import {
  BookOpen,
  Bug,
  Compass,
  Keyboard,
  Link2,
  LogIn,
  LogOut,
  Palette,
  Settings,
  Sparkles,
  UserRound,
  Volume2,
  Wind,
} from 'lucide-react'
import { useMemo } from 'react'
import { useMe } from '../api/queries'
import { docEntries } from '../docs'
import { signIn, useSignOut } from '../features/account/AccountSlot'
import { copyLink } from '../features/share/share'
import { toggleSound } from '../features/sound/engine'
import { MOTION_PREFERENCES, useSettings } from '../store/settings'
import { useBoot } from './boot/boot'
import { NAV } from './Frame'
import { GitHubIcon } from './github-icon'
import { GLOBAL_KEYS, goKey } from './keymaps'
import { keymap, ROUTE_SEARCH } from './keys'
import { SOURCE_URL } from './site'

export interface CommandMenuProps {
  /** The search it opens with: `theme` from the header's palette button. */
  query: string
  onClose: () => void
}

/** The keymap's groups as the menu heads them: the frame's own keys are the site's. */
const KEY_GROUPS: Readonly<Record<string, string>> = { global: 'site' }

/**
 * The `mod+k` menu: everything the site can do from here. The header's routes, the page's own
 * keys (the arena's play and step, the editor's panels) as the keymap holds them, the themes, the
 * settings, every docs page, the account, and the links out. Its own chunk: the frame loads it on
 * the first `mod+k`.
 */
export function CommandMenu({ query, onClose }: CommandMenuProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { data: me } = useMe()
  const signOut = useSignOut()
  const openTour = useBoot((state) => state.openTour)
  const settings = useSettings()
  const commands = useMemo<PaletteCommand[]>(() => {
    const go = (to: string) => () => void router.navigate({ to })
    const open = (url: string) => () => void window.open(url, '_blank', 'noopener')
    const { theme, sound, effects, motion } = settings
    return [
      ...NAV.map(({ to, label, icon, key }) => ({
        id: `go:${to}`,
        group: 'go',
        label: `go to ${label}`,
        icon,
        keys: goKey(key, label).keys,
        run: go(to),
      })),
      {
        id: 'go:/settings',
        group: 'go',
        label: 'go to settings',
        icon: Settings,
        run: go('/settings'),
      },
      ...pageCommands(),
      ...THEMES.map((name) => ({
        id: `theme:${name}`,
        group: 'theme',
        label: name,
        icon: Palette,
        keywords: 'color look',
        current: name === theme,
        run: () => settings.setTheme(name),
      })),
      {
        id: 'sound',
        group: 'settings',
        label: `turn sound ${sound.on ? 'off' : 'on'}`,
        icon: Volume2,
        keywords: 'audio mute',
        run: toggleSound,
      },
      ...(Object.keys(effects) as (keyof typeof effects)[]).map((effect) => ({
        id: `effect:${effect}`,
        group: 'settings',
        label: `turn ${effect} ${effects[effect] ? 'off' : 'on'}`,
        icon: Sparkles,
        keywords: 'arena effects',
        run: () => settings.setEffect(effect, !effects[effect]),
      })),
      ...MOTION_PREFERENCES.map((preference) => ({
        id: `motion:${preference}`,
        group: 'settings',
        label: `motion: ${preference}`,
        icon: Wind,
        keywords: 'reduced animation',
        current: preference === motion,
        run: () => settings.setMotion(preference),
      })),
      ...docEntries().map(({ section, page }) => ({
        id: `docs:${page.slug}`,
        group: 'docs',
        label: page.title,
        icon: BookOpen,
        keywords: section,
        run: () => void router.navigate({ to: '/docs/$', params: { _splat: page.slug } }),
      })),
      ...(me
        ? [
            {
              id: 'profile',
              group: 'account',
              label: 'your profile',
              icon: UserRound,
              keywords: me.user.handle,
              run: () =>
                void router.navigate({ to: '/u/$handle', params: { handle: me.user.handle } }),
            },
            {
              id: 'sign-out',
              group: 'account',
              label: 'sign out',
              icon: LogOut,
              run: () => void signOut(),
            },
          ]
        : [
            {
              id: 'sign-in',
              group: 'account',
              label: 'sign in with github',
              icon: LogIn,
              run: signIn,
            },
          ]),
      {
        id: 'tour',
        group: 'site',
        label: 'take the tour',
        icon: Compass,
        keywords: 'help welcome',
        run: openTour,
      },
      {
        id: 'copy-link',
        group: 'site',
        label: "copy this page's link",
        icon: Link2,
        keywords: 'share url',
        run: () => void copyLink(window.location.href, toast, 'link copied.'),
      },
      {
        id: 'source',
        group: 'site',
        label: 'source on github',
        icon: GitHubIcon,
        keywords: 'code repository',
        run: open(SOURCE_URL),
      },
      {
        id: 'issue',
        group: 'site',
        label: 'report a bug',
        icon: Bug,
        keywords: 'github issue feedback',
        run: open(`${SOURCE_URL}/issues/new`),
      },
    ]
  }, [router, toast, me, signOut, openTour, settings])
  return <CommandPalette open onClose={onClose} commands={commands} query={query} />
}

/**
 * The live keymap's commands as the menu lists them: the page's keys, and the frame's `?` and
 * `/`. Not the `g` chords (the routes above say them) nor `mod+k` itself, and `/` only on a page
 * with a search.
 */
function pageCommands(): PaletteCommand[] {
  const skip = new Set([GLOBAL_KEYS.commands.keys.join(' ')])
  if (document.querySelector(`[${ROUTE_SEARCH}]`) === null)
    skip.add(GLOBAL_KEYS.search.keys.join(' '))
  return keymap
    .commands()
    .filter((command) => command.group !== 'go' && !skip.has(command.keys.join(' ')))
    .map((command) => ({
      id: `key:${command.keys.join(' ')}`,
      group: KEY_GROUPS[command.group ?? ''] ?? command.group,
      label: command.description,
      icon: Keyboard,
      keys: command.keys,
      run: () => void command.run(),
    }))
}
