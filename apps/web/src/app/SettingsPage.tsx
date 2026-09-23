import {
  Button,
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
import { Download, LogIn, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { botsToZip, type LocalBot, useLocalBotActions, useLocalBots } from '../store/local-bots'
import {
  type ArenaEffects,
  MOTION_PREFERENCES,
  type MotionPreference,
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

/** `/settings` (PRODUCT_SPEC §8): theme, arena effects, sound, keys, account, and data. */
export function SettingsPage() {
  return (
    <PanelGrid className="p-3">
      <ThemePanel />
      <EffectsPanel />
      <SoundPanel />
      <AccountPanel />
      <DataPanel />
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
      <div role="radiogroup" aria-label="theme" className="grid grid-cols-5 gap-3">
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
          '--sw-accent': colors['--accent'] ?? 'var(--accent)',
        })}
      >
        <span className="text-panel-title text-(--sw-accent)">ASM BOTS</span>
        <span className="flex flex-1 flex-col justify-center gap-1 rounded-sm border border-(--sw-border) bg-(--sw-panel) px-1.5">
          <span className="h-0.5 w-3/4 bg-(--sw-text)" />
          <span className="h-0.5 w-1/2 bg-(--sw-muted)" />
        </span>
      </span>
      <span className={`text-nav ${chosen ? 'text-accent' : 'text-muted'}`}>{theme}</span>
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

function SoundPanel() {
  const sound = useSettings((state) => state.sound)
  const setSound = useSettings((state) => state.setSound)
  return (
    <Panel className="col-span-12 lg:col-span-6" title="sound" status={sound.on ? 'on' : 'off'}>
      <div className="flex items-center gap-3">
        <Toggle pressed={sound.on} onPressedChange={(on) => setSound({ on })}>
          sound
        </Toggle>
        <Slider
          aria-label="volume"
          className="w-48"
          min={0}
          max={100}
          value={Math.round(sound.volume * 100)}
          onValueChange={(volume) => setSound({ volume: volume / 100 })}
          format={(volume) => `${volume}%`}
          showValue
          disabled={!sound.on}
        />
      </div>
    </Panel>
  )
}

function AccountPanel() {
  return (
    <Panel className="col-span-12 lg:col-span-6" title="account" status="signed out">
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted">
          signed out. local bots stay in this browser; sign in to keep them in the cloud.
        </p>
        <Button icon={LogIn} disabled title="accounts arrive with the api">
          sign in with github
        </Button>
      </div>
    </Panel>
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
