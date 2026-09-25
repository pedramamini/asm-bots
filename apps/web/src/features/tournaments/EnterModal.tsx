/**
 * `enter` on an open server tournament (PRODUCT_SPEC §1, §4): pick one of my account's bots and a
 * version of it until the tournament's deadline. One entry a user: entering again swaps my entry
 * for the version picked. A signed-out reader gets `sign in to enter`.
 */
import type { BotLabel, Tournament } from '@asmbots/protocol'
import { Button, EmptyState, Modal, Skeleton, useToast } from '@asmbots/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../../api/queries'
import { enterTournament } from '../../api/writes'
import { LoadFailure } from '../../app/LoadFailure'
import { useLinkAction } from '../../app/link-action'
import { SignInButton } from '../account/AccountSlot'
import { useVersionPick, VersionFields } from '../account/VersionPicker'
import { takesEntries, utcTime } from './entry'

export interface EnterModalProps {
  open: boolean
  tournament: Tournament
  /** My entry, when I have one: entering replaces it. */
  mine: BotLabel | null
  onClose: () => void
}

/** The dialog. Its reads mount with it, so each opening reads my bots again. */
export function EnterModal(props: EnterModalProps) {
  return props.open ? <EnterDialog {...props} /> : null
}

function EnterDialog({ open, tournament: t, mine, onClose }: EnterModalProps) {
  const { toast } = useToast()
  const link = useLinkAction()
  const client = useQueryClient()
  const pick = useVersionPick()
  const { mine: bots, picked, version } = pick
  const cap = t.config.battle.maxBotBytes
  const over = version !== undefined && version.size > cap
  const enter = useMutation({
    mutationFn: (versionId: string) => enterTournament(t.id, versionId),
    onSuccess: ({ replaced }) => {
      const what = `${picked?.bot.name} v${version?.version}`
      toast(replaced === null ? `entered ${what} in ${t.name}.` : `${what} is your entry now.`, {
        variant: 'accent',
      })
      void client.invalidateQueries({ queryKey: ['tournaments'] })
      onClose()
    },
  })
  const close = () => {
    enter.reset()
    onClose()
  }
  const ready = version !== undefined && !over && !enter.isPending
  return (
    <Modal
      open={open}
      onClose={close}
      title={`enter ${t.name}`}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            cancel
          </Button>
          <Button
            variant="primary"
            icon={LogIn}
            disabled={!ready}
            onClick={() => version && enter.mutate(version.id)}
          >
            {enter.isPending ? 'entering…' : 'enter'}
          </Button>
        </>
      }
    >
      {bots.isPending ? (
        <Skeleton rows={3} />
      ) : bots.error !== null ? (
        <LoadFailure read={bots} what="your bots" />
      ) : picked === undefined ? (
        <EmptyState action={link('open the editor', '/editor')}>
          no bots in your account yet: the editor&rsquo;s save, signed in, keeps one there.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3 text-data">
          <VersionFields
            pick={{ ...pick, picked }}
            cap={cap}
            over={`: over ${t.name}'s cap.`}
            onChange={() => enter.reset()}
          />
          <p className="text-muted">
            {mine === null
              ? 'one entry each: enter again before the deadline to swap it.'
              : `your entry is ${mine.name} v${mine.version}: this one takes its place.`}{' '}
            entries close {utcTime(t.entryClosesAt ?? '')}.
          </p>
          {enter.error !== null && (
            <p role="alert" className="text-danger">
              {enter.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

export interface EnterButtonProps {
  /** Undefined while it loads. */
  tournament: Tournament | undefined
  /** The tournament's entrants: mine among them, when I entered. */
  entrants?: readonly BotLabel[] | undefined
  className?: string | undefined
}

/**
 * `enter`, while the tournament takes entries (`enter again` once I have); `sign in to enter` for
 * a signed-out reader; disabled, and saying why, once entries have closed.
 */
export function EnterButton({ tournament: t, entrants = [], className }: EnterButtonProps) {
  const me = useMe()
  const [open, setOpen] = useState(false)
  const handle = me.data?.user.handle
  const mine = entrants.find((e) => e.owner === handle) ?? null
  if (t !== undefined && !takesEntries(t)) {
    return (
      <Button className={className} icon={LogIn} disabled title="entries have closed">
        enter
      </Button>
    )
  }
  if (me.data === null) return <SignInButton>sign in to enter</SignInButton>
  return (
    <>
      <Button
        className={className}
        variant="primary"
        icon={LogIn}
        disabled={t === undefined || me.data === undefined}
        onClick={() => setOpen(true)}
      >
        {mine === null ? 'enter' : 'enter again'}
      </Button>
      {t !== undefined && (
        <EnterModal open={open} tournament={t} mine={mine} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
