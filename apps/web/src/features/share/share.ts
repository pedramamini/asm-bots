/**
 * Sharing a page (PRODUCT_SPEC §10): copying its link or an embed of it, and saving its card. An
 * embed is the arena with no frame (`/embed/arena…`), for another site's `<iframe>`: the embed of
 * an arena page's URL is the same URL under `/embed`, its query and fragment kept.
 */
import type { ToastApi } from '@asmbots/ui'
import { apiUrl } from '../../api/client'
import { downloadBlob } from '../arena/battle/files'

/** An embed's size, px: 16:9, room for the arena and its controls. */
export const EMBED_WIDTH = 800
export const EMBED_HEIGHT = 450

/** Where the embeds live, before the arena path they show. */
export const EMBED_PREFIX = '/embed'

/**
 * Copies `text` and says `done` in a toast, or `failed` when the clipboard refused it. Returns
 * the text, or null when it was refused.
 */
export async function copyText(
  text: string,
  toast: ToastApi['toast'],
  done: string,
  failed: string,
): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(text)
    toast(done, { variant: 'accent' })
    return text
  } catch {
    toast(failed, { variant: 'danger' })
    return null
  }
}

/**
 * Copies `url` and says `done` in a toast, or that it could not. Returns the link, or null when
 * the clipboard refused it.
 */
export function copyLink(
  url: string,
  toast: ToastApi['toast'],
  done: string,
): Promise<string | null> {
  return copyText(url, toast, done, 'could not copy the link.')
}

/** The embed of an arena page's URL: `…/arena?b=…#src=…` → `…/embed/arena?b=…#src=…`. */
export function embedUrl(url: string): string {
  const page = new URL(url)
  page.pathname = `${EMBED_PREFIX}${page.pathname}`
  return page.href
}

/** The arena page an embed's URL shows: `…/embed/arena/<key>` → `…/arena/<key>`. */
export function watchUrl(url: string): string {
  const embed = new URL(url)
  if (embed.pathname.startsWith(`${EMBED_PREFIX}/`)) {
    embed.pathname = embed.pathname.slice(EMBED_PREFIX.length)
  }
  return embed.href
}

/** The name of a battle's embed: `ASM BOTS: dwarf vs imp`, or its count past three bots. */
export function embedTitle(names: readonly string[]): string {
  const bots = names.length <= 3 ? names.join(' vs ') : `${names.length} bots`
  return `ASM BOTS: ${bots}`
}

/** `value` safe in a double-quoted HTML attribute. */
function attribute(value: string): string {
  return value.replace(
    /[&"<>]/g,
    (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] as string,
  )
}

/** The `<iframe>` of the embed at `src`, named `title` for screen readers, to paste in a page. */
export function embedSnippet(src: string, title: string): string {
  return `<iframe src="${attribute(src)}" title="${attribute(title)}" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" style="border:0" allow="fullscreen" loading="lazy"></iframe>`
}

/** Saves the share card at `path` on the API (`/bots/b-1/og.png`) as the file `name`. */
export async function downloadCard(
  path: string,
  name: string,
  toast: ToastApi['toast'],
): Promise<void> {
  try {
    const res = await fetch(apiUrl(path))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    downloadBlob(await res.blob(), name)
  } catch {
    toast('could not make the image.', { variant: 'danger' })
  }
}
