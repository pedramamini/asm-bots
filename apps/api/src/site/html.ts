/**
 * A page's HTML with its own `<head>` (`heads.ts`): the title replaced, and the description, the
 * canonical link, the robots rule, and the Open Graph and Twitter tags of `index.html` replaced by
 * the page's, streamed through `HTMLRewriter`.
 */
import { headTags, type PageHead } from '@asmbots/protocol'

/** The tags `headTags` writes: each one `index.html` has goes, and the page's take its place. */
const REPLACED = [
  'meta[name="description"]',
  'meta[name="robots"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'link[rel="canonical"]',
]

/** Whether `res` is a page: HTML, with a body. */
export function isPage(res: Response): boolean {
  return res.status === 200 && (res.headers.get('Content-Type') ?? '').startsWith('text/html')
}

/**
 * `res` with `head`'s title and tags. Its ETag goes: it named the file, and the body is now this
 * page's.
 */
export function withHead(res: Response, head: PageHead): Response {
  let rewriter = new HTMLRewriter()
    .on('title', {
      element(title) {
        title.setInnerContent(head.title)
      },
    })
    .on('head', {
      element(element) {
        element.append(`\n${headTags(head)}\n`, { html: true })
      },
    })
  for (const selector of REPLACED) {
    rewriter = rewriter.on(selector, {
      element(tag) {
        tag.remove()
      },
    })
  }
  const page = rewriter.transform(res)
  const headers = new Headers(page.headers)
  headers.delete('ETag')
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers })
}
