/**
 * `submit` on a hill (PRODUCT_SPEC §5): pick one of my account's bots and a version of it, and the
 * server fights it against every entry with the bytes it assembled when the version was saved. A
 * signed-out reader gets `sign in to submit`; the melee hill takes no submissions yet.
 */
import type { Hill } from '@asmbots/protocol'
import { Button, EmptyState, type EmptyStateAction, Modal, Skeleton, useToast } from '@asmbots/ui'
import { useMutation } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useMe } from '../../api/queries'
import { submitToHill } from '../../api/writes'
import { LoadFailure } from '../../app/LoadFailure'
import { useLinkAction } from '../../app/link-action'
import { SignInButton, signIn } from '../account/AccountSlot'
import { useVersionPick, VersionFields } from '../account/VersionPicker'
import { count, plural } from './links'

export interface SubmitModalProps {
  open: boolean
  hill: Hill
  /** Entries on the hill now: the matches the submission will fight. */
  entrants: number
  onClose: () => void
  /** The submission was made; its job has started. */
  onSubmitted: (submissionId: string) => void
}

/**
 * The dialog. Its reads mount with it, so each opening reads my bots again (one saved in the
 * editor since shows) and starts on the first.
 */
export function SubmitModal(props: SubmitModalProps) {
  return props.open ? <SubmitDialog {...props} /> : null
}

function SubmitDialog({ open, hill, entrants, onClose, onSubmitted }: SubmitModalProps) {
  const { toast } = useToast()
  const link = useLinkAction()
  const pick = useVersionPick()
  const { mine, picked, version } = pick
  const cap = hill.config.maxBotBytes
  const over = version !== undefined && version.size > cap
  const submit = useMutation({
    mutationFn: (versionId: string) => submitToHill(hill.slug, versionId),
    onSuccess: ({ submissionId }) => {
      toast(`submitted ${picked?.bot.name} v${version?.version} to the ${hill.name} hill.`, {
        variant: 'accent',
      })
      onSubmitted(submissionId)
    },
  })
  const close = () => {
    submit.reset()
    onClose()
  }
  const ready = version !== undefined && !over && !submit.isPending
  return (
    <Modal
      open={open}
      onClose={close}
      title={`submit to ${hill.name}`}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            cancel
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            disabled={!ready}
            onClick={() => version && submit.mutate(version.id)}
          >
            {submit.isPending ? 'submitting…' : 'submit'}
          </Button>
        </>
      }
    >
      {mine.isPending ? (
        <Skeleton rows={3} />
      ) : mine.error !== null ? (
        <LoadFailure read={mine} what="your bots" />
      ) : picked === undefined ? (
        <EmptyState action={link('open the editor', '/editor')}>
          no bots in your account yet: the editor&rsquo;s save, signed in, keeps one there.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3 text-data">
          <VersionFields
            pick={{ ...pick, picked }}
            cap={cap}
            over={`: over the ${hill.name} hill's cap.`}
            onChange={() => submit.reset()}
          />
          <p className="text-muted">
            {`the server fights it against ${entrants === 1 ? '1 entry' : `${count(entrants)} entries`}, ${plural(hill.rounds, 'round')} a match, and ranks it by the points.`}
          </p>
          {submit.error !== null && (
            <p role="alert" className="text-danger">
              {submit.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

export interface SubmitButtonProps {
  /** Undefined while the hill loads. */
  hill: Hill | undefined
  entrants: number
  onSubmitted: (submissionId: string) => void
  /** The dialog is open: the page holds it, so its empty lists' `submit a bot` opens it too. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The standings panel's `submit`, or what stands in for it. */
export function SubmitButton({
  hill,
  entrants,
  onSubmitted,
  open,
  onOpenChange: setOpen,
}: SubmitButtonProps) {
  const me = useMe()
  if (hill?.scoring === 'melee') {
    return (
      <Button size="sm" icon={Upload} disabled title="the melee hill takes no submissions yet">
        submit
      </Button>
    )
  }
  if (me.data === null) return <SignInButton>sign in to submit</SignInButton>
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={Upload}
        disabled={hill === undefined || me.data === undefined}
        onClick={() => setOpen(true)}
      >
        submit
      </Button>
      {hill !== undefined && (
        <SubmitModal
          open={open}
          hill={hill}
          entrants={entrants}
          onClose={() => setOpen(false)}
          onSubmitted={(id) => {
            setOpen(false)
            onSubmitted(id)
          }}
        />
      )}
    </>
  )
}

/**
 * What a hill page's empty lists offer, as `submit` does: `submit a bot` opens the dialog
 * (`onOpen`), a signed-out reader signs in first, and the melee hill, which takes none, shows how
 * hills score.
 */
export function useSubmitAction(hill: Hill | undefined, onOpen: () => void): EmptyStateAction {
  const me = useMe()
  const link = useLinkAction()
  if (hill?.scoring === 'melee') return link('see how hills score', '/docs/tournaments/hills')
  if (me.data === null) return { label: 'sign in to submit a bot', onClick: signIn }
  return {
    label: 'submit a bot',
    onClick: onOpen,
    disabled: hill === undefined || me.data === undefined,
  }
}
