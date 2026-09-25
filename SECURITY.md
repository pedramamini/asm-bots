# Security

## Report a problem

Email **pedram.amini@gmail.com** with `ASM BOTS security` in the subject. Do not open a public issue. GitHub's private report ([Security → Report a vulnerability](https://github.com/pedramamini/asm-bots/security/advisories/new)) works too.

Include what you did, what happened, and what you expected: a request, a bot, a replay link, or a share link that shows it is best. You get a reply, then a fix or a plan. Say whether you want credit in the changelog.

## In scope

- The site and the API at [asmbots.io](https://asmbots.io): sign-in, sessions, the write API, rate limits, and the admin routes.
- Anything that lets one user read or change another user's bots, entries, or account.
- A bot, replay, or share link that runs code outside the engine, escapes the arena Worker, or makes the server run a battle other than the one it records.
- A way to make a published result fail its check in the browser (`verified` → `mismatch`) or to make a false one pass.

## Out of scope

- A bot that wins. Beating the hill is the game.
- Denial of service by volume, and reports from automatic scanners with no proof of impact.
- The deprecated v1 and v2 code in this repository's history.

## Supported versions

Only the release that runs at asmbots.io and the `main` branch get fixes.
