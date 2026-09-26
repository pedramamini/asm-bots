import {
  type ApiToken,
  type CreatedApiToken,
  handleProblem,
  MAX_API_TOKENS,
  type Me,
} from '@asmbots/protocol'
import {
  Button,
  EmptyState,
  Input,
  Kbd,
  KeyHelp,
  Modal,
  Panel,
  PanelGrid,
  Segmented,
  Slider,
  Toggle,
  useToast,
  vars,
} from '@asmbots/ui'
import { applyTheme, THEMES, type Theme } from '@asmbots/ui/themes'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Copy, Download, KeyRound, LogOut, Trash2, Upload, UserX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '../api/client'
import {
  useApiTokens,
  useCreateApiToken,
  useMe,
  useMyBots,
  useRevokeApiToken,
} from '../api/queries'
import { deleteAccount, updateMe } from '../api/writes'
import { forgetAccount, SignInButton, useSignOut } from '../features/account/AccountSlot'
import { HandleField } from '../features/account/HandleField'
import { ago, day, plural, UserLink } from '../features/hills/links'
import { appSound, toggleSound } from '../features/sound/engine'
import {
  botsToZip,
  LOCAL_BOTS_KEY,
  type LocalBot,
  unlinkLocalBots,
  useLocalBotActions,
  useLocalBots,
} from '../store/local-bots'
import {
  type ArenaEffects,
  MOTION_PREFERENCES,
  type MotionPreference,
  SOUND_CUES,
  type SoundCue,
  useSettings,
} from '../store/settings'
import { useKeyBindings } from './keys'

/** Each theme's swatch colors from tokens.css; none under bun test, where Vite defines nothing. */
const SWATCHES: Record<string, Record<string, string>> = typeof __THEME_SWATCHES__ === 'object'
  ? __THEME_SWATCHES__
  : {}

const EFFECTS: readonly (keyof ArenaEffects)[] = ['bloom', 'scanlines', 'vignette']

/** The export's file name: `asmbots-bots-2026-09-23.zip`. */
export function exportFileName(now = new Date()): string {
  return `asmbots-bots-${now.toISOString().slice(0, 10)}.zip`
}

/**
 * `/settings` (PRODUCT_SPEC §8): theme, arena effects, sound, keys, account, data, and, signed in,
 * the API tokens.
 */
export function SettingsPage() {
  return (
    <PanelGrid className="p-3">
      <ThemePanel />
      <EffectsPanel />
      <SoundPanel />
      <AccountPanel />
      <DataPanel />
      <ApiTokensPanel />
      <KeysPanel />
    </PanelGrid>
  )
}

function ThemePanel() {
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  // A hovered or focused swatch shows its theme on the page; leaving puts the chosen one back.
  const preview = (name: Theme | null) =>
    applyTheme(name ?? useSettings.getState().theme, { persist: false })
  useEffect(() => () => preview(null), [])
  return (
    <Panel className="col-span-12" title="theme" status={theme}>
      <div
        role="radiogroup"
        aria-label="theme"
        className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-9"
      >
        {THEMES.map((name) => (
          <ThemeSwatch
            key={name}
            theme={name}
            chosen={name === theme}
            onChoose={() => setTheme(name)}
            onPreview={(on) => preview(on ? name : null)}
          />
        ))}
      </div>
    </Panel>
  )
}

function ThemeSwatch({
  theme,
  chosen,
  onChoose,
  onPreview,
}: {
  theme: Theme
  chosen: boolean
  onChoose: () => void
  onPreview: (on: boolean) => void
}) {
  const colors = SWATCHES[theme] ?? {}
  return (
    // biome-ignore lint/a11y/useSemanticElements: a picture of the theme, not a form field.
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={theme}
      onClick={onChoose}
      onPointerEnter={() => onPreview(true)}
      onPointerLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      className={`flex flex-col gap-2 rounded-md border p-2 text-left transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        chosen ? 'border-accent bg-accent-10' : 'border-border hover:border-border-strong'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-16 flex-col gap-1 rounded-sm border border-(--sw-border) bg-(--sw-bg) p-1.5"
        style={vars({
          '--sw-bg': colors['--bg'] ?? 'var(--bg)',
          '--sw-panel': colors['--panel'] ?? 'var(--panel)',
          '--sw-border': colors['--border'] ?? 'var(--border)',
          '--sw-text': colors['--text'] ?? 'var(--text)',
          '--sw-muted': colors['--text-muted'] ?? 'var(--text-muted)',
          '--sw-accent-fg': colors['--accent-fg'] ?? 'var(--accent-fg)',
        })}
      >
        <span className="text-panel-title text-(--sw-accent-fg)">ASM BOTS</span>
        <span className="flex flex-1 flex-col justify-center gap-1 rounded-sm border border-(--sw-border) bg-(--sw-panel) px-1.5">
          <span className="h-0.5 w-3/4 bg-(--sw-text)" />
          <span className="h-0.5 w-1/2 bg-(--sw-muted)" />
        </span>
      </span>
      <span className={`text-nav ${chosen ? 'text-accent-fg' : 'text-muted'}`}>{theme}</span>
    </button>
  )
}

function EffectsPanel() {
  const effects = useSettings((state) => state.effects)
  const setEffect = useSettings((state) => state.setEffect)
  const motion = useSettings((state) => state.motion)
  const setMotion = useSettings((state) => state.setMotion)
  return (
    <Panel className="col-span-12 lg:col-span-6" title="arena effects">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {EFFECTS.map((effect) => (
            <Toggle
              key={effect}
              pressed={effects[effect]}
              onPressedChange={(on) => setEffect(effect, on)}
            >
              {effect}
            </Toggle>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-panel-status text-muted">reduced motion</span>
          <Segmented<MotionPreference>
            label="reduced motion"
            options={MOTION_PREFERENCES}
            value={motion}
            onValueChange={setMotion}
          />
        </div>
      </div>
    </Panel>
  )
}

/** Each cue's toggle, and what it sounds for: its tooltip. */
const CUE_WORDS: Readonly<Record<SoundCue, { label: string; hint: string }>> = {
  tick: { label: 'tick', hint: 'a tick for a step, and at the slowest speeds' },
  write: { label: 'writes', hint: 'a soft click for a burst of writes' },
  death: { label: 'proc death', hint: 'a low thud when a process dies' },
  botDeath: { label: 'bot death', hint: 'a falling tone when a bot dies, at its own pitch' },
  victory: { label: 'victory', hint: 'three rising notes when a match ends with one winner' },
  click: { label: 'clicks', hint: 'a click when the battle plays, pauses, or changes speed' },
}

/** Sound on or off, the volume, and each cue: a change plays what it changed, once sound is on. */
function SoundPanel() {
  const sound = useSettings((state) => state.sound)
  const setSound = useSettings((state) => state.setSound)
  const setCue = useSettings((state) => state.setCue)
  return (
    <Panel className="col-span-12 lg:col-span-6" title="sound" status={sound.on ? 'on' : 'off'}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Toggle pressed={sound.on} onPressedChange={() => toggleSound()}>
            sound
          </Toggle>
          <Slider
            aria-label="volume"
            className="w-48"
            min={0}
            max={100}
            value={Math.round(sound.volume * 100)}
            onValueChange={(volume) => {
              setSound({ volume: volume / 100 })
              appSound().preview('click')
            }}
            format={(volume) => `${volume}%`}
            showValue
            disabled={!sound.on}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-panel-status text-muted">cues</span>
          {SOUND_CUES.map((cue) => (
            <Toggle
              key={cue}
              pressed={sound.cues[cue]}
              disabled={!sound.on}
              title={CUE_WORDS[cue].hint}
              onPressedChange={(on) => {
                setCue(cue, on)
                if (on) appSound().preview(cue)
              }}
            >
              {CUE_WORDS[cue].label}
            </Toggle>
          ))}
        </div>
        <p className="text-muted">
          the cues play in the arena and its replays. <Kbd>m</Kbd> in a battle turns sound on or
          off.
        </p>
      </div>
    </Panel>
  )
}

function AccountPanel() {
  const { data: me } = useMe()
  const signOut = useSignOut()
  const [deleting, setDeleting] = useState(false)
  return (
    <Panel
      className="col-span-12 lg:col-span-6"
      title="account"
      status={me ? `signed in: ${me.user.handle}` : 'signed out'}
    >
      {me ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">
            github: <span className="text-accent-fg">linked</span>. signed in as{' '}
            <UserLink handle={me.user.handle} />. local bots stay in this browser too.
          </p>
          <HandleForm key={me.user.handle} me={me} />
          <div className="flex flex-wrap gap-2">
            <Button icon={LogOut} onClick={() => void signOut()}>
              sign out
            </Button>
            <Button icon={UserX} variant="danger" onClick={() => setDeleting(true)}>
              delete account
            </Button>
          </div>
          {deleting && <DeleteAccount me={me} onClose={() => setDeleting(false)} />}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">
            signed out. local bots stay in this browser; sign in to keep them in the cloud.
          </p>
          <SignInButton />
        </div>
      )}
    </Panel>
  )
}

/** The handle, editable: `PATCH /api/me`, checked as it is typed and refused by the API if taken. */
function HandleForm({ me }: { me: Me }) {
  const client = useQueryClient()
  const { toast } = useToast()
  const [handle, setHandle] = useState(me.user.handle)
  const [refused, setRefused] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changed = handle !== me.user.handle
  const problem = changed ? (handleProblem(handle) ?? refused) : null

  const save = async () => {
    if (!changed || handleProblem(handle) !== null || saving) return
    setSaving(true)
    try {
      const next = await updateMe({ handle })
      client.setQueryData(['me'], next)
      await client.invalidateQueries({ queryKey: ['users'] })
      toast(`your handle is ${next.user.handle}.`)
    } catch (error) {
      setRefused(error instanceof ApiRequestError ? error.message : 'could not save: try again')
    }
    setSaving(false)
  }

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <span className="text-panel-status text-muted">handle</span>
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <HandleField
            id="settings-handle-problem"
            value={handle}
            problem={problem}
            onChange={(next) => {
              setHandle(next)
              setRefused(null)
            }}
          />
        </div>
        <Button
          type="submit"
          loading={saving}
          disabled={!changed || handleProblem(handle) !== null}
        >
          save
        </Button>
      </div>
    </form>
  )
}

/**
 * The confirm step of `delete account`: the user types their handle. The API deletes the account,
 * its cloud bots (those on hills stay there as `[deleted]`), and every session; the local bots
 * stay, no longer linked.
 */
function DeleteAccount({ me, onClose }: { me: Me; onClose: () => void }) {
  const client = useQueryClient()
  const { toast } = useToast()
  const { data: bots } = useMyBots()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const { handle } = me.user
  const cloud = bots === undefined ? 'your cloud bots' : plural(bots.bots.length, 'cloud bot')

  const run = async () => {
    if (typed !== handle || busy) return
    setBusy(true)
    try {
      await deleteAccount()
    } catch (error) {
      const why = error instanceof ApiRequestError ? error.message : 'the server did not answer'
      toast(`could not delete the account: ${why}.`, { variant: 'danger' })
      setBusy(false)
      return
    }
    await unlinkLocalBots()
    await client.invalidateQueries({ queryKey: LOCAL_BOTS_KEY })
    await forgetAccount(client)
    toast('account deleted.')
    onClose()
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="delete account"
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            cancel
          </Button>
          <Button
            type="submit"
            form="delete-account"
            variant="danger"
            loading={busy}
            disabled={typed !== handle}
          >
            delete
          </Button>
        </>
      }
    >
      <form
        id="delete-account"
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        <p>
          deletes <b>{handle}</b>, {cloud}, and every session. bots on a hill stay there as
          [deleted]. local bots stay in this browser.
        </p>
        <p className="text-muted">
          type <b>{handle}</b> to confirm.
        </p>
        <Input
          aria-label="your handle"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
      </form>
    </Modal>
  )
}

function DataPanel() {
  const { data: bots = [] } = useLocalBots()
  const { importZip, clear } = useLocalBotActions()
  const reset = useSettings((state) => state.reset)
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const count = `${bots.length} local ${bots.length === 1 ? 'bot' : 'bots'}`

  const onImport = async (file: File | undefined) => {
    if (file === undefined) return
    try {
      const saved = await importZip.mutateAsync(new Uint8Array(await file.arrayBuffer()))
      toast(saved.length === 0 ? 'no .asm files in that zip.' : `imported ${saved.length}.`, {
        variant: saved.length === 0 ? 'warn' : 'accent',
      })
    } catch {
      toast('not a zip file.', { variant: 'danger' })
    }
  }

  const onClear = async () => {
    await clear.mutateAsync()
    reset()
    setConfirming(false)
    toast('local data cleared.')
  }

  return (
    <Panel className="col-span-12 lg:col-span-6" title="data" status={count}>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Download} disabled={bots.length === 0} onClick={() => downloadZip(bots)}>
          export zip
        </Button>
        <Button icon={Upload} loading={importZip.isPending} onClick={() => picker.current?.click()}>
          import zip
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".zip,application/zip"
          aria-label="import zip"
          className="hidden"
          onChange={(event) => {
            void onImport(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }}
        />
        <Button icon={Trash2} variant="danger" onClick={() => setConfirming(true)}>
          clear local data
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="clear local data"
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              cancel
            </Button>
            <Button variant="danger" loading={clear.isPending} onClick={() => void onClear()}>
              clear
            </Button>
          </>
        }
      >
        <p>
          deletes {count} and resets every setting, the theme included. export first to keep them.
        </p>
      </Modal>
    </Panel>
  )
}

/** A link in running text: underlined, as DESIGN_SYSTEM §8 asks. */
const TEXT_LINK =
  'rounded-sm text-accent-fg underline underline-offset-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

/**
 * The signed-in user's API tokens (`/api/me/tokens`): what a token is for, the list (name, prefix,
 * when made and last used) with a revoke each, confirmed in a dialog, and a form that makes one.
 * A new token's secret shows once, here, in a box to copy, with a warning that it will not show
 * again. Signed out, there is no panel.
 */
function ApiTokensPanel() {
  const { data: me } = useMe()
  const tokens = useApiTokens()
  const create = useCreateApiToken()
  const [name, setName] = useState('')
  const [made, setMade] = useState<CreatedApiToken | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  if (!me) return null
  const list = tokens.data?.tokens
  const full = list !== undefined && list.length >= MAX_API_TOKENS
  const trimmed = name.trim()

  const submit = async () => {
    if (trimmed === '' || full || create.isPending) return
    try {
      setMade(await create.mutateAsync(trimmed))
      setName('')
    } catch {
      // `create.error` says why, under the form.
    }
  }

  return (
    <Panel
      className="col-span-12"
      title="api tokens"
      status={list === undefined ? undefined : `${list.length} of ${MAX_API_TOKENS}`}
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          a token lets a script or an AI agent push bots and submit them to hills as you. see the{' '}
          <Link to="/docs/$" params={{ _splat: 'tools/agents' }} className={TEXT_LINK}>
            agents page
          </Link>{' '}
          in the docs.
        </p>
        {made && <NewTokenSecret made={made} onDone={() => setMade(null)} />}
        {tokens.isError ? (
          <p role="alert" className="text-danger">
            could not load your tokens: {tokens.error.message}
          </p>
        ) : list === undefined ? (
          <p className="text-muted">loading your tokens…</p>
        ) : list.length === 0 ? (
          <EmptyState
            dense
            action={{ label: 'name one below', onClick: () => nameInput.current?.focus() }}
          >
            no api tokens yet.
          </EmptyState>
        ) : (
          <ul aria-label="your api tokens" className="flex flex-col divide-y divide-border">
            {list.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                <span className="min-w-32 font-medium text-text">{token.name}</span>
                <code className="text-code text-muted">{token.prefix}…</code>
                <span className="text-muted">created {day(token.createdAt)}</span>
                <span className="text-muted">
                  last used {token.lastUsedAt === null ? 'never' : ago(token.lastUsedAt)}
                </span>
                <span className="ml-auto">
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`revoke ${token.name}`}
                    onClick={() => setRevoking(token)}
                  >
                    revoke
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          aria-label="new api token"
          className="flex w-full max-w-md flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex items-start gap-2">
            <Input
              ref={nameInput}
              aria-label="token name"
              aria-describedby={create.isError ? 'api-token-problem' : undefined}
              className="flex-1"
              placeholder="my agent"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value)
                create.reset()
              }}
            />
            <Button
              type="submit"
              icon={KeyRound}
              loading={create.isPending}
              disabled={trimmed === '' || full}
            >
              create token
            </Button>
          </div>
          {full && (
            <p className="text-muted">
              you have {MAX_API_TOKENS} tokens: revoke one to make another.
            </p>
          )}
          {create.isError && (
            <p id="api-token-problem" role="alert" className="text-danger">
              {create.error instanceof ApiRequestError
                ? create.error.message
                : 'could not make the token: try again'}
            </p>
          )}
        </form>
      </div>
      {revoking && <RevokeToken token={revoking} onClose={() => setRevoking(null)} />}
    </Panel>
  )
}

/** A new token's secret, once: a box to copy it from, and the warning that it is not shown again. */
function NewTokenSecret({ made, onDone }: { made: CreatedApiToken; onDone: () => void }) {
  const { toast } = useToast()
  const copy = () => {
    navigator.clipboard.writeText(made.secret).then(
      () => toast('copied.', { variant: 'accent' }),
      () => toast('could not copy the token: select it and copy.', { variant: 'danger' }),
    )
  }
  return (
    <div
      role="note"
      aria-label="new token"
      className="flex flex-col gap-2 border-l-2 border-warn bg-panel-2 px-3 py-2"
    >
      <p className="text-warn">copy it now: it is not shown again.</p>
      <p className="text-muted">
        {made.token.name}: use it as <code className="text-code">ASMBOTS_TOKEN</code>, or with{' '}
        <code className="text-code">asmbots login</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          aria-label="the token"
          className="min-w-0 flex-1"
          spellCheck={false}
          value={made.secret}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button icon={Copy} onClick={copy}>
          copy
        </Button>
        <Button variant="ghost" onClick={onDone}>
          done
        </Button>
      </div>
    </div>
  )
}

/** The confirm step of `revoke`: the token stops working at once. */
function RevokeToken({ token, onClose }: { token: ApiToken; onClose: () => void }) {
  const revoke = useRevokeApiToken()
  const { toast } = useToast()
  const run = async () => {
    try {
      await revoke.mutateAsync(token.id)
    } catch (error) {
      const why = error instanceof ApiRequestError ? error.message : 'the server did not answer'
      toast(`could not revoke the token: ${why}.`, { variant: 'danger' })
      return
    }
    toast(`revoked ${token.name}.`)
    onClose()
  }
  return (
    <Modal
      open
      onClose={revoke.isPending ? () => {} : onClose}
      title="revoke api token"
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={revoke.isPending}>
            cancel
          </Button>
          <Button variant="danger" loading={revoke.isPending} onClick={() => void run()}>
            revoke
          </Button>
        </>
      }
    >
      <p>
        revokes <b>{token.name}</b> ({token.prefix}…) now. a script or an agent that uses it gets
        401 from then on.
      </p>
    </Modal>
  )
}

function KeysPanel() {
  const bindings = useKeyBindings()
  return (
    <Panel className="col-span-12" title="keyboard" status={`${bindings.length} keys`}>
      <KeyHelp bindings={bindings} />
    </Panel>
  )
}

/** Saves the bots as a zip through the browser's download. */
function downloadZip(bots: readonly LocalBot[]): void {
  const zip = botsToZip(bots)
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName()
  document.body.append(link)
  link.click()
  link.remove()
  // Chrome reads the blob after the click returns: a URL revoked at once downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
