/**
 * GitHub's avatars (`User.avatarUrl`): the header shows the signed-in user's on every page, and a
 * profile page its user's. A connection opened ahead (`preconnect`) takes the DNS, TCP, and TLS
 * round trips off the picture, which waits on an API read for its URL anyway.
 */
import { preconnect } from 'react-dom'

/** Where GitHub serves avatars; the API's content policy lets pictures come from it. */
export const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com'

/** Opens a connection to the avatars' origin. React writes one hint an origin, however often. */
export function preconnectAvatars(): void {
  preconnect(AVATAR_ORIGIN)
}
