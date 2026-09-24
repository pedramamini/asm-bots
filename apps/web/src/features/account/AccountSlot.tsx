import type { Me } from '@asmbots/protocol'
import { Button, Menu, type TriggerProps, useToast } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { LogIn, LogOut, Settings, UserRound } from 'lucide-react'
import type { Ref } from 'react'
import { useMe } from '../../api/queries'
import { signInHref, signOut } from '../../api/writes'

/** Sends the browser to GitHub's sign-in, and back to this page after. */
export function SignInButton() {
  const signIn = () => {
    const { pathname, search, hash } = window.location
    window.location.assign(signInHref(`${pathname}${search}${hash}`))
  }
  return (
    <Button size="sm" icon={LogIn} onClick={signIn}>
      sign in with github
    </Button>
  )
}

/** Signs out here and on the server, then forgets the account in the query cache. */
export function useSignOut(): () => Promise<void> {
  const client = useQueryClient()
  const { toast } = useToast()
  return async () => {
    try {
      await signOut()
    } catch {
      toast('could not sign out: try again.', { variant: 'danger' })
      return
    }
    client.setQueryData(['me'], null)
    client.removeQueries({ queryKey: ['me', 'bots'] })
    await client.invalidateQueries({ queryKey: ['users'] })
    toast('signed out.')
  }
}

/**
 * The header's account slot (PRODUCT_SPEC §9): the signed-in user's avatar, which opens a menu
 * (profile, settings, sign out), or `sign in with github`.
 */
export function AccountSlot() {
  const { data: me } = useMe()
  const router = useRouter()
  const signOutHere = useSignOut()
  if (!me) return <SignInButton />
  const { handle } = me.user
  return (
    <Menu
      placement="bottom-end"
      trigger={<Avatar user={me.user} />}
      items={[
        {
          label: 'profile',
          icon: UserRound,
          onSelect: () => void router.navigate({ to: '/u/$handle', params: { handle } }),
        },
        {
          label: 'settings',
          icon: Settings,
          onSelect: () => void router.navigate({ to: '/settings' }),
        },
        'separator',
        { label: 'sign out', icon: LogOut, onSelect: () => void signOutHere() },
      ]}
    />
  )
}

/** The menu's trigger: the GitHub avatar, or a user glyph when there is none. */
function Avatar({ user, ref, ...trigger }: TriggerProps & { user: Me['user'] }) {
  return (
    <button
      type="button"
      aria-label={`account: ${user.handle}`}
      {...trigger}
      ref={ref as Ref<HTMLButtonElement>}
      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-border text-muted transition-colors duration-120 ease-out hover:border-border-strong focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {user.avatarUrl !== null ? (
        <img src={user.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <UserRound aria-hidden className="size-3" strokeWidth={1.75} />
      )}
    </button>
  )
}
