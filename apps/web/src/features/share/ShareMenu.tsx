import {
  Button,
  type ButtonProps,
  Menu,
  type MenuItem,
  type MenuProps,
  useToast,
} from '@asmbots/ui'
import { Code2, ImageDown, Link } from 'lucide-react'
import { copyLink, copyText, downloadCard, embedSnippet } from './share'

/** What a page shares. */
export interface ShareTarget {
  /** `copy link`: the page's URL, or the page's own copy (a replay stores itself first). */
  readonly link: string | (() => void)
  /**
   * `copy embed`: the embed's URL (`embedUrl`) and a name for its `<iframe>`. Left out where the
   * page has no battle to embed.
   */
  readonly embed?: { readonly url: string; readonly title: string } | undefined
  /**
   * `download png`: the page's share card, by its path on the API and the file's name, or the
   * page's own picture (the arena's screenshot). Left out where the page has neither.
   */
  readonly png?: { readonly path: string; readonly name: string } | (() => void) | undefined
}

export interface ShareMenuProps extends ShareTarget {
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  placement?: MenuProps['placement']
}

/**
 * `share ▾` (PRODUCT_SPEC §10): copy the page's link, copy an `<iframe>` of its battle for another
 * site, or save its share card as a PNG. Each copy says so in a toast.
 */
export function ShareMenu({
  link,
  embed,
  png,
  size = 'sm',
  variant,
  placement = 'bottom-end',
}: ShareMenuProps) {
  const { toast } = useToast()
  const items: MenuItem[] = [
    {
      label: 'copy link',
      icon: Link,
      onSelect: () =>
        typeof link === 'string' ? void copyLink(link, toast, 'link copied.') : link(),
    },
  ]
  if (embed !== undefined) {
    items.push({
      label: 'copy embed',
      icon: Code2,
      onSelect: () =>
        void copyText(
          embedSnippet(embed.url, embed.title),
          toast,
          'embed copied: paste it into any page.',
          'could not copy the embed.',
        ),
    })
  }
  if (png !== undefined) {
    items.push({
      label: 'download png',
      icon: ImageDown,
      onSelect: () =>
        typeof png === 'function' ? png() : void downloadCard(png.path, png.name, toast),
    })
  }
  return (
    <Menu
      placement={placement}
      trigger={
        <Button size={size} variant={variant} icon={Link}>
          share ▾
        </Button>
      }
      items={items}
    />
  )
}
