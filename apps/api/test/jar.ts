/** A cookie jar: the `name=value` pairs a response set, minus those it cleared. */
export class Jar {
  readonly cookies = new Map<string, string>()

  /** `ip` is the client's IP (`CF-Connecting-IP`): its own by default, so rate limits count each jar apart. */
  constructor(
    readonly ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join('.')}`,
  ) {}

  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';')
      const at = pair.indexOf('=')
      const name = pair.slice(0, at).trim()
      const cleared = attrs.some((a) => /^\s*max-age=0$/i.test(a))
      if (cleared) this.cookies.delete(name)
      else this.cookies.set(name, pair.slice(at + 1).trim())
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}
