import { Input, Segmented, Slider, Toggle } from '@asmbots/ui'
import { type ReactNode, useId, useState } from 'react'
import type { ArenaConfig } from '../../../store/settings'
import {
  CYCLES,
  type Limits,
  PRESET_NAMES,
  PROCS,
  type PresetName,
  presetOf,
  ROUNDS,
  randomSeed,
  SEED,
  SPACING,
} from './config'

export interface ConfigFormProps {
  config: ArenaConfig
  /** A field changed: the form's parent clamps it and updates the preset. */
  onChange: (change: Partial<ArenaConfig>) => void
  /** A preset chip was chosen. */
  onPreset: (preset: PresetName) => void
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The battle config (PRODUCT_SPEC §2): the preset chips, then rounds, max cycles, the seed (fixed
 * or random), the process cap, and the spacing. A preset lights up while the values are its own.
 */
export function ConfigForm({ config, onChange, onPreset }: ConfigFormProps) {
  const preset = presetOf(config)
  return (
    <div className="flex flex-col gap-3">
      <Segmented<PresetName | 'custom'>
        label="preset"
        options={PRESET_NAMES}
        // No preset matches a hand-made config: `custom` checks no pill.
        value={preset ?? 'custom'}
        onValueChange={(value) => {
          if (value !== 'custom') onPreset(value)
        }}
        className="flex-wrap"
      />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <Field label="rounds">
          {(id) => (
            <Slider
              id={id}
              {...range(ROUNDS)}
              value={config.rounds}
              onValueChange={(rounds) => onChange({ rounds })}
              format={count}
              showValue
            />
          )}
        </Field>
        <Field label="cycles">
          {(id) => (
            <Slider
              id={id}
              {...range(CYCLES)}
              scale="log"
              value={config.maxCycles}
              onValueChange={(maxCycles) => onChange({ maxCycles })}
              format={count}
              showValue
            />
          )}
        </Field>
        <Field label="seed">
          {(id) => <SeedField id={id} seed={config.seed} onSeed={(seed) => onChange({ seed })} />}
        </Field>
        <Field label="procs">
          {(id) => (
            <Slider
              id={id}
              {...range(PROCS)}
              scale="log"
              value={config.maxProcesses}
              onValueChange={(maxProcesses) => onChange({ maxProcesses })}
              format={count}
              showValue
            />
          )}
        </Field>
        <Field label="spacing">
          {(id) => (
            <Slider
              id={id}
              {...range(SPACING)}
              value={config.minSpacing}
              onValueChange={(minSpacing) => onChange({ minSpacing })}
              format={(n) => `${count(n)} B`}
              showValue
            />
          )}
        </Field>
      </dl>
    </div>
  )
}

/** A slider's range from a field's limits, at the row's full width. */
function range({ min, max, step }: Limits) {
  return { min, max, step, className: 'flex-1' }
}

/** A row of the form: the muted UPPER label, and the control it names. */
function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <>
      <dt>
        <label htmlFor={id} className="text-panel-status text-muted">
          {label}
        </label>
      </dt>
      <dd className="flex min-w-0 items-center">{children(id)}</dd>
    </>
  )
}

/**
 * The seed: a uint32 typed in, or `random`, a new seed each battle. Turning `random` off fixes a
 * fresh random seed, which the field shows and the user can change.
 */
function SeedField({
  id,
  seed,
  onSeed,
}: {
  id: string
  seed: number | null
  onSeed: (seed: number | null) => void
}) {
  // What the user is typing: it may be empty, which is no seed yet, until the field loses focus.
  const [draft, setDraft] = useState<string | null>(null)
  const random = seed === null
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        className="min-w-0 flex-1"
        placeholder={random ? 'random' : undefined}
        disabled={random}
        value={random ? '' : (draft ?? String(seed))}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 10)
          setDraft(digits)
          if (digits !== '') onSeed(Math.min(Number(digits), SEED.max))
        }}
        onBlur={() => setDraft(null)}
      />
      <Toggle pressed={random} onPressedChange={(on) => onSeed(on ? null : randomSeed())}>
        random
      </Toggle>
    </span>
  )
}
