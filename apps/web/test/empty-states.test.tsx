/**
 * The lists that say they are empty (DESIGN_SYSTEM §4, §9: one sentence, one action), outside the
 * pages whose tests cover their own (`api-pages`, `arena-setup-view`, `tournaments-server`): the
 * debugger's watches and breakpoints, the editor's versions and library, and a failed read's
 * retry, online and off.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { MyBot } from '@asmbots/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { LoadFailure } from '../src/app/LoadFailure'
import { BreakpointsPanel } from '../src/features/editor/debug/BreakpointsPanel'
import type { DebugState } from '../src/features/editor/debug/session'
import { WatchPanel } from '../src/features/editor/debug/WatchPanel'
import { Library } from '../src/features/editor/Library'
import { VersionsModal } from '../src/features/editor/VersionsModal'
import { clearVersions } from '../src/store/bot-versions'
import { WithQueries } from './api-server'

useDom()

describe('the watch panel', () => {
  it('says nothing is watched, and watch ip adds the first', () => {
    render(<WatchPanel state={null} battle={null} image={null} />)
    const panel = screen.getByRole('region', { name: 'watch' })
    expect(panel.textContent).toContain('nothing watched yet')
    fireEvent.click(within(panel).getByRole('button', { name: 'watch ip' }))
    const watches = within(panel).getByRole('list', { name: 'watches' })
    expect(within(watches).getByText('ip')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'watch ip' })).toBeNull()
  })
})

describe('the breakpoints panel', () => {
  const props = {
    battle: null,
    image: null,
    names: [],
    lineOf: () => null,
    onSet: () => {},
    onRemove: () => {},
  }

  it("says there are none, and breaks on the cursor's line as F9 does", () => {
    const onBreakAtCursor = mock(() => {})
    const state = { breakpoints: [] } as unknown as DebugState
    render(<BreakpointsPanel {...props} state={state} onBreakAtCursor={onBreakAtCursor} />)
    const panel = screen.getByRole('region', { name: 'breakpoints' })
    expect(panel.textContent).toContain('no breakpoints yet: press the gutter left of a line, F9')
    fireEvent.click(within(panel).getByRole('button', { name: "break on the cursor's line" }))
    expect(onBreakAtCursor).toHaveBeenCalledTimes(1)
  })

  it('cannot break before the debugger has loaded the bot', () => {
    const onBreakAtCursor = mock(() => {})
    render(<BreakpointsPanel {...props} state={null} onBreakAtCursor={onBreakAtCursor} />)
    const action = screen.getByRole('button', { name: "break on the cursor's line" })
    expect(action.hasAttribute('disabled')).toBe(true)
    fireEvent.click(action)
    expect(onBreakAtCursor).not.toHaveBeenCalled()
  })
})

describe('versions', () => {
  beforeEach(() => clearVersions())

  it('says a bot never saved has no versions yet, and saves it now', async () => {
    const onSave = mock(() => {})
    const onClose = mock(() => {})
    render(
      <WithQueries>
        <VersionsModal
          open
          botId={null}
          cloudId={null}
          current="; mine"
          onClose={onClose}
          onRestore={() => {}}
          onSave={onSave}
        />
      </WithQueries>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'versions' })
    // Not waiting on a read that never runs.
    expect(dialog.textContent).not.toContain('reading')
    expect(dialog.textContent).toContain('no saves yet: each save keeps a version')
    fireEvent.click(within(dialog).getByRole('button', { name: 'save now' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('the library', () => {
  const props = {
    current: 'scratch',
    local: [],
    recent: [],
    onOpen: mock(() => {}),
    onFork: () => {},
    onOpenCloud: () => {},
  }

  it('saves the open bot from an empty my bots, or starts one when it cannot be saved', () => {
    const onSave = mock(() => {})
    const { rerender } = render(<Library {...props} onSave={onSave} />)
    const mine = () => screen.getByRole('region', { name: 'my bots' })
    expect(mine().textContent).toContain('none saved in this browser yet.')
    fireEvent.click(within(mine()).getByRole('button', { name: 'save this bot' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    // A roster bot open: read-only, so the way on is a new bot.
    rerender(<Library {...props} current="roster:dwarf" />)
    fireEvent.click(within(mine()).getByRole('button', { name: 'write a new bot' }))
    expect(props.onOpen).toHaveBeenCalledWith({ kind: 'scratch' })
  })

  it("retries the account's bots when their read failed, and says when there are none", () => {
    const refetch = mock(() => Promise.resolve())
    const failed = { error: new Error('the server did not answer.'), refetch }
    const { rerender } = render(<Library {...props} cloudRead={failed} />)
    const cloud = () => screen.getByRole('region', { name: 'mine (cloud)' })
    expect(cloud().textContent).toContain(
      "could not load your account's bots: the server did not answer.",
    )
    fireEvent.click(within(cloud()).getByRole('button', { name: 'retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    const none: MyBot[] = []
    rerender(<Library {...props} cloud={none} cloudRead={{ error: null, refetch }} />)
    expect(cloud().textContent).toContain('none in your account yet')
  })
})

describe('a failed read', () => {
  it('says what failed and retries; offline, says it comes back with the network', () => {
    const refetch = mock(() => Promise.resolve())
    render(<LoadFailure read={{ error: new Error('down'), refetch }} what="the hills" />)
    expect(screen.getByText('could not load the hills: down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    const onLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      act(() => void window.dispatchEvent(new window.Event('offline')))
      const offline = 'offline: the hills will load once the network is back.'
      expect(screen.getByText(offline)).toBeTruthy()
    } finally {
      if (onLine === undefined) delete (navigator as { onLine?: boolean }).onLine
      else Object.defineProperty(navigator, 'onLine', onLine)
      act(() => void window.dispatchEvent(new window.Event('online')))
    }
  })

  it('draws nothing while the read has no error', () => {
    const { container } = render(
      <LoadFailure read={{ error: null, refetch: () => Promise.resolve() }} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
