import {
  BookOpen,
  Camera,
  CodeXml,
  Copy,
  FileCode,
  Gauge,
  GitFork,
  Grid2x2,
  Keyboard,
  type LucideIcon,
  MapIcon,
  Mountain,
  Palette,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  StepBack,
  StepForward,
  Swords,
  Trash2,
  Trophy,
  Volume2,
  X,
} from 'lucide-react'
import { Fragment } from 'react'
import { Button, type ButtonVariant } from '../primitives/Button'
import { Chip } from '../primitives/Chip'
import { IconButton } from '../primitives/IconButton'
import { Input } from '../primitives/Input'
import { Kbd } from '../primitives/Kbd'
import { Menu } from '../primitives/Menu'
import { NavButton } from '../primitives/NavButton'
import { Segmented } from '../primitives/Segmented'
import { Select } from '../primitives/Select'
import { Slider } from '../primitives/Slider'
import { Toggle } from '../primitives/Toggle'
import { Tooltip } from '../primitives/Tooltip'
import { grouped } from './data'
import { Specimen, State, States, stay } from './specimen'

/** Each button variant with the label and icon it has in the app. */
const BUTTONS: readonly { variant: ButtonVariant; label: string; icon: LucideIcon }[] = [
  { variant: 'default', label: 'refresh', icon: RefreshCw },
  { variant: 'primary', label: 'fight', icon: Swords },
  { variant: 'ghost', label: 'clear', icon: X },
  { variant: 'danger', label: 'delete', icon: Trash2 },
]

/** The Button sheet's columns. */
const BUTTON_STATES = ['md', 'sm', 'icon', 'hover', 'focus', 'disabled', 'loading'] as const

/** What pressing a menu item does in the gallery: nothing. */
const none = () => {}

/**
 * NavButton, Button, IconButton, Segmented, Toggle, Input, Select, Slider, Chip, Kbd, Tooltip, and
 * Menu: each in each of its states.
 */
export function ControlSpecimens() {
  return (
    <>
      <Specimen name="Button" status="4 variants · sm md" className="col-span-8">
        <div className="grid grid-cols-[5.5rem_repeat(7,max-content)] items-center gap-x-3 gap-y-2.5">
          <span />
          {BUTTON_STATES.map((state) => (
            <span key={state} className="text-panel-status text-muted">
              {state}
            </span>
          ))}
          {BUTTONS.map(({ variant, label, icon }) => (
            <Fragment key={variant}>
              <span className="text-panel-status text-muted">{variant}</span>
              <Button variant={variant}>{label}</Button>
              <Button variant={variant} size="sm">
                {label}
              </Button>
              <Button variant={variant} icon={icon}>
                {label}
              </Button>
              <Button variant={variant} data-force="hover">
                {label}
              </Button>
              <Button variant={variant} data-force="focus focus-visible">
                {label}
              </Button>
              <Button variant={variant} disabled>
                {label}
              </Button>
              <Button variant={variant} loading>
                {label}
              </Button>
            </Fragment>
          ))}
        </div>
      </Specimen>

      <Specimen name="NavButton" status="idle · active" className="col-span-4">
        <States>
          <State label="idle">
            <NavButton href="#arena" icon={Grid2x2} onClick={stay}>
              arena
            </NavButton>
            <NavButton href="#editor" icon={CodeXml} onClick={stay}>
              editor
            </NavButton>
          </State>
          <State label="hover">
            <NavButton href="#hills" icon={Mountain} onClick={stay} data-force="hover">
              hills
            </NavButton>
          </State>
          <State label="active">
            <NavButton href="#tournaments" icon={Trophy} active onClick={stay}>
              tournaments
            </NavButton>
          </State>
          <State label="focus">
            <NavButton href="#docs" icon={BookOpen} onClick={stay} data-force="focus focus-visible">
              docs
            </NavButton>
          </State>
          <State label="no icon">
            <NavButton href="#settings" onClick={stay}>
              settings
            </NavButton>
          </State>
        </States>
      </Specimen>

      <Specimen name="IconButton" status="md · sm · pressed" className="col-span-4">
        <States>
          <State label="md">
            <IconButton icon={StepBack} label="step back" shortcut="," />
            <IconButton icon={Play} label="play" shortcut="space" />
            <IconButton icon={StepForward} label="step" shortcut="." />
            <IconButton icon={Gauge} label="seek" />
          </State>
          <State label="sm">
            <IconButton size="sm" icon={StepBack} label="step back" />
            <IconButton size="sm" icon={Play} label="play" />
            <IconButton size="sm" icon={StepForward} label="step" />
            <IconButton size="sm" icon={Gauge} label="seek" />
          </State>
          <State label="pressed">
            <IconButton icon={MapIcon} label="minimap" pressed />
            <IconButton icon={Volume2} label="sound" shortcut="m" pressed />
          </State>
          <State label="hover">
            <IconButton icon={Palette} label="theme" data-force="hover" />
          </State>
          <State label="focus">
            <IconButton icon={Keyboard} label="keys" data-force="focus focus-visible" />
          </State>
          <State label="disabled">
            <IconButton icon={Camera} label="screenshot" disabled />
          </State>
        </States>
      </Specimen>

      <Specimen name="Segmented" status="radio group" className="col-span-4">
        <States>
          <State label="chosen">
            <Segmented
              label="range"
              options={['week', 'month', 'quarter', 'year']}
              defaultValue="week"
            />
          </State>
          <State label="disabled">
            <Segmented
              label="view"
              options={['bracket', 'matrix', { value: 'melee', disabled: true }]}
              defaultValue="matrix"
            />
          </State>
          <State label="none">
            <Segmented label="preset" options={['duel', 'melee 8', 'melee 16', 'hill rules']} />
          </State>
          <State label="focus">
            <Segmented
              label="zoom"
              options={['1x', '2x', '4x', '8x', '16x']}
              defaultValue="4x"
              data-force="focus focus-visible"
              data-force-target="[aria-checked=true]"
            />
          </State>
        </States>
      </Specimen>

      <Specimen name="Toggle" status="aria-pressed" className="col-span-4">
        <States>
          <State label="off">
            <Toggle>verified</Toggle>
          </State>
          <State label="on">
            <Toggle defaultPressed>bloom</Toggle>
          </State>
          <State label="hover">
            <Toggle data-force="hover">scanlines</Toggle>
          </State>
          <State label="focus">
            <Toggle defaultPressed data-force="focus focus-visible">
              vignette
            </Toggle>
          </State>
          <State label="disabled">
            <Toggle disabled>alpr</Toggle>
            <Toggle disabled defaultPressed>
              sound
            </Toggle>
          </State>
        </States>
      </Specimen>

      <Specimen name="Input" status="text · hex" className="col-span-4">
        <States>
          <State label="empty">
            <Input className="w-full" placeholder="search bots..." aria-label="search bots" />
          </State>
          <State label="value">
            <Input className="w-full" defaultValue="dwarf" aria-label="bot name" />
          </State>
          <State label="hover">
            <Input
              className="w-full"
              placeholder="search or zip..."
              aria-label="hover"
              data-force="hover"
            />
          </State>
          <State label="focus">
            <Input
              className="w-full"
              defaultValue="vampire"
              aria-label="focus"
              data-force="focus"
            />
          </State>
          <State label="hex">
            <Input mono className="w-28" defaultValue="0x1A2F" aria-label="goto address" />
            <Input
              mono
              digits={2}
              prompt={null}
              className="w-12"
              defaultValue="FF"
              aria-label="byte"
            />
          </State>
          <State label="no prompt">
            <Input className="w-full" prompt={null} placeholder="note" aria-label="note" />
          </State>
          <State label="disabled">
            <Input className="w-full" disabled placeholder="signed out" aria-label="disabled" />
          </State>
        </States>
      </Specimen>

      <Specimen name="Select" status="native · lowercase" className="col-span-4">
        <States>
          <State label="idle">
            <Select aria-label="hill" className="w-40" defaultValue="all hills">
              <option>all hills</option>
              <option>main</option>
              <option>tiny</option>
            </Select>
          </State>
          <State label="long">
            <Select aria-label="template" className="w-40" defaultValue="replicator skeleton">
              <option>blank</option>
              <option>replicator skeleton</option>
            </Select>
          </State>
          <State label="hover">
            <Select aria-label="size" className="w-40" data-force="hover" defaultValue="any size">
              <option>any size</option>
            </Select>
          </State>
          <State label="focus">
            <Select
              aria-label="visibility"
              className="w-40"
              data-force="focus"
              defaultValue="public"
            >
              <option>public</option>
            </Select>
          </State>
          <State label="disabled">
            <Select aria-label="account" className="w-40" disabled defaultValue="signed out">
              <option>signed out</option>
            </Select>
          </State>
        </States>
      </Specimen>

      <Specimen name="Slider" status="linear · log" className="col-span-4">
        <States>
          <State label="linear">
            <Slider
              aria-label="volume"
              className="w-full"
              min={0}
              max={100}
              defaultValue={70}
              format={(n) => `${n}%`}
              showValue
            />
          </State>
          <State label="log">
            <Slider
              aria-label="speed"
              className="w-full"
              min={1}
              max={10_000}
              scale="log"
              defaultValue={240}
              format={(n) => `${grouped(n)}/f`}
              showValue
            />
          </State>
          <State label="focus">
            <Slider
              aria-label="rounds"
              className="w-full"
              min={1}
              max={10}
              defaultValue={3}
              showValue
              data-force="focus focus-visible"
            />
          </State>
          <State label="disabled">
            <Slider aria-label="process cap" className="w-full" min={1} max={64} disabled />
          </State>
        </States>
      </Specimen>

      <Specimen name="Chip" status="5 variants" className="col-span-3">
        <States>
          <State label="neutral">
            <Chip>3 active · 2 major</Chip>
            <Chip icon={Radio}>live</Chip>
          </State>
          <State label="accent">
            <Chip variant="accent">60 fps</Chip>
            <Chip variant="accent" icon={ShieldCheck}>
              verified
            </Chip>
          </State>
          <State label="warn">
            <Chip variant="warn">slow frame</Chip>
          </State>
          <State label="danger">
            <Chip variant="danger">dead @ 10,733</Chip>
          </State>
          <State label="info">
            <Chip variant="info">queued · 24 of 32</Chip>
          </State>
        </States>
      </Specimen>

      <Specimen name="Kbd" status="keycaps" className="col-span-3">
        <States>
          <State label="keys">
            <Kbd>space</Kbd>
            <Kbd>.</Kbd>
            <Kbd>,</Kbd>
            <Kbd>?</Kbd>
            <Kbd>esc</Kbd>
            <Kbd>f5</Kbd>
          </State>
          <State label="symbols">
            <Kbd>⌘</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>⌥</Kbd>
            <Kbd>⏎</Kbd>
            <Kbd>⌫</Kbd>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </State>
          <State label="chord">
            <span className="inline-flex items-center gap-1 text-data text-muted">
              <Kbd>g</Kbd> then <Kbd>a</Kbd> · go to arena
            </span>
          </State>
        </States>
      </Specimen>

      <Specimen name="Tooltip" status="400 ms · open" className="col-span-3">
        <States>
          <State label="open">
            <IconButton icon={StepBack} label="step back" shortcut="," tooltip="right" />
          </State>
          <State label="describes">
            <Tooltip content="the replay matches the recorded result hash">
              <Chip variant="accent" icon={ShieldCheck} tabIndex={0}>
                verified
              </Chip>
            </Tooltip>
          </State>
        </States>
        <p className="mt-3 text-data text-muted">
          it shows after 400 ms of hover or keyboard focus and hides on leave, press, or escape.
        </p>
      </Specimen>

      <Specimen name="Menu" status="open" className="col-span-3 min-h-66">
        <Menu
          trigger={<Button>templates ▾</Button>}
          items={[
            { label: 'blank', icon: FileCode, onSelect: none },
            { label: 'imp', icon: FileCode, onSelect: none },
            { label: 'dwarf', icon: FileCode, shortcut: 'd', onSelect: none },
            { label: 'scanner skeleton', icon: FileCode, disabled: true, onSelect: none },
            { label: 'fork', icon: GitFork, onSelect: none },
            { label: 'copy link', icon: Copy, shortcut: 'l', onSelect: none },
            'separator',
            { label: 'delete bot', icon: Trash2, danger: true, onSelect: none },
          ]}
        />
      </Specimen>
    </>
  )
}
