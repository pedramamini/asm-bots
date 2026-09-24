/**
 * `submit` on a hill (PRODUCT_SPEC §5): pick one of my account's bots and a version of it, and the
 * server fights it against every entry with the bytes it assembled when the version was saved. A
 * signed-out reader gets `sign in to submit`; the melee hill takes no submissions yet.
 */
import type { Hill } from '@asmbots/protocol'
import { Button, Modal, Select, Skeleton, useToast } from '@asmbots/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Upload } from 'lucide-react'
import { useState } from 'react'
import { botQuery, useMe, useMyBots } from '../../api/queries'
import { submitToHill } from '../../api/writes'
import { SignInButton } from '../account/AccountSlot'
import { CELL_LINK, count, plural } from './links'

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
  const mine = useMyBots()
  const bots = (mine.data?.bots ?? []).filter((b) => b.latest !== null)
  const [botId, setBotId] = useState<string | null>(null)
  const picked = bots.find((b) => b.bot.id === botId) ?? bots[0]
  const detail = useQuery({ ...botQuery(picked?.bot.id ?? ''), enabled: !!picked })
  const versions = detail.data?.versions ?? (picked?.latest ? [picked.latest] : [])
  const [number, setNumber] = useState<number | null>(null)
  const version = versions.find((v) => v.version === number) ?? versions[0]
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
        <p className="text-data text-danger">could not load your bots: {mine.error.message}</p>
      ) : picked === undefined ? (
        <p className="text-data">
          the hill takes bots kept in your account.{' '}
          <Link to="/editor" className={CELL_LINK}>
            open the editor
          </Link>{' '}
          and press save: a bot in your account can come here.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-data">
          <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
            <span className="text-muted">bot</span>
            <Select
              aria-label="bot"
              value={picked.bot.id}
              onChange={(event) => {
                setBotId(event.target.value)
                setNumber(null)
                submit.reset()
              }}
            >
              {bots.map((b) => (
                <option key={b.bot.id} value={b.bot.id}>
                  {b.bot.name}
                </option>
              ))}
            </Select>
            <span className="text-muted">version</span>
            <Select
              aria-label="version"
              value={version?.version ?? ''}
              onChange={(event) => {
                setNumber(Number(event.target.value))
                submit.reset()
              }}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version} · {count(v.size)} B
                </option>
              ))}
            </Select>
          </div>
          {version !== undefined && (
            <p className={over ? 'text-danger' : 'text-muted'}>
              {count(version.size)} / {count(cap)} B
              {over ? `: over the ${hill.name} hill's cap.` : ''}
            </p>
          )}
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
}

/** The standings panel's `submit`, or what stands in for it. */
export function SubmitButton({ hill, entrants, onSubmitted }: SubmitButtonProps) {
  const me = useMe()
  const [open, setOpen] = useState(false)
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
