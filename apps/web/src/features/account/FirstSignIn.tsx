import { handleProblem, MAX_IMPORT, type Me, type NewBot } from '@asmbots/protocol'
import { Button, Input, Modal, useToast } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiRequestError } from '../../api/client'
import { importBots, updateMe } from '../../api/writes'
import {
  LOCAL_BOTS_KEY,
  type LocalBot,
  listLocalBots,
  markLocalBotsSynced,
} from '../../store/local-bots'

/** A local bot's name as the API takes one: one line, 1..64 characters. */
export function cloudBotName(name: string): string {
  return (
    name
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 64) || 'bot'
  )
}

/** What an import did: how many bots it kept, and why each of the rest stayed local. */
export interface ImportOutcome {
  imported: number
  refused: { name: string; message: string }[]
}

/**
 * Imports `bots` into the account, `MAX_IMPORT` a request, and marks each one the API made as
 * synced. A bot the API refuses (it does not assemble) stays local only.
 */
export async function importLocalBots(bots: readonly LocalBot[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, refused: [] }
  for (let at = 0; at < bots.length; at += MAX_IMPORT) {
    const batch = bots.slice(at, at + MAX_IMPORT)
    const request: NewBot[] = batch.map((b) => ({ name: cloudBotName(b.name), source: b.source }))
    const { results } = await importBots(request)
    const synced = new Map<string, string>()
    results.forEach((result, i) => {
      const bot = batch[i]
      if (bot === undefined) return
      if (result.ok) synced.set(bot.id, result.bot.id)
      else outcome.refused.push({ name: bot.name, message: result.message })
    })
    await markLocalBotsSynced(synced)
    outcome.imported += synced.size
  }
  return outcome
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The first sign-in (PRODUCT_SPEC §9): pick a handle (GitHub's login, prefilled), then, when this
 * browser has local bots not yet synced, "import them to your account?". `onDone` gets the user as
 * the dialog left them.
 */
export function FirstSignIn({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  /** Set once the handle is picked: the user then, and the local bots to offer. */
  const [picked, setPicked] = useState<{ me: Me; bots: LocalBot[] } | null>(null)

  if (picked === null) {
    return (
      <HandleStep
        me={me}
        onClose={() => onDone(me)}
        onPicked={async (next) => {
          const bots = (await listLocalBots()).filter((bot) => bot.cloudId === undefined)
          if (bots.length > 0) setPicked({ me: next, bots })
          else onDone(next)
        }}
      />
    )
  }
  return <ImportStep bots={picked.bots} onDone={() => onDone(picked.me)} />
}

function HandleStep({
  me,
  onClose,
  onPicked,
}: {
  me: Me
  onClose: () => void
  onPicked: (me: Me) => Promise<void>
}) {
  const [handle, setHandle] = useState(me.user.handle)
  const [refused, setRefused] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const problem = handleProblem(handle) ?? refused

  const submit = async () => {
    if (handleProblem(handle) !== null || saving) return
    setSaving(true)
    try {
      await onPicked(await updateMe({ handle }))
    } catch (error) {
      setRefused(error instanceof ApiRequestError ? error.message : 'could not save: try again')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="pick a handle"
      size="md"
      actions={
        <Button
          type="submit"
          form="first-sign-in-handle"
          variant="primary"
          loading={saving}
          disabled={handleProblem(handle) !== null}
        >
          continue
        </Button>
      }
    >
      <form
        id="first-sign-in-handle"
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="text-muted">
          signed in with github. your handle names your profile: <b>/u/{handle || '…'}</b>
        </p>
        <Input
          aria-label="handle"
          aria-invalid={problem !== null}
          aria-describedby="first-sign-in-problem"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={24}
          value={handle}
          onChange={(event) => {
            setHandle(event.currentTarget.value.toLowerCase())
            setRefused(null)
          }}
        />
        <p id="first-sign-in-problem" role="status" className="min-h-4 text-data text-danger">
          {problem ?? ''}
        </p>
      </form>
    </Modal>
  )
}

function ImportStep({ bots, onDone }: { bots: readonly LocalBot[]; onDone: () => void }) {
  const client = useQueryClient()
  const { toast } = useToast()
  const [importing, setImporting] = useState(false)
  const count = plural(bots.length, 'local bot')

  const run = async () => {
    setImporting(true)
    try {
      const { imported, refused } = await importLocalBots(bots)
      const kept = refused.length > 0 ? `; ${refused.length} did not assemble and stay local` : ''
      toast(`imported ${plural(imported, 'bot')}${kept}.`, {
        variant: refused.length > 0 ? 'warn' : 'accent',
      })
    } catch (error) {
      const why = error instanceof ApiRequestError ? error.message : 'the server did not answer'
      toast(`could not import: ${why}.`, { variant: 'danger' })
    }
    await client.invalidateQueries({ queryKey: LOCAL_BOTS_KEY })
    await client.invalidateQueries({ queryKey: ['users'] })
    await client.invalidateQueries({ queryKey: ['me', 'bots'] })
    onDone()
  }

  return (
    <Modal
      open
      onClose={onDone}
      title="import your bots"
      size="md"
      actions={
        <>
          <Button variant="ghost" onClick={onDone} disabled={importing}>
            not now
          </Button>
          <Button variant="primary" autoFocus loading={importing} onClick={() => void run()}>
            import {bots.length}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        import {count} to your account? they stay in this browser too, marked synced.
      </p>
    </Modal>
  )
}
