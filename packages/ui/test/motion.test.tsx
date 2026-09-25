import { afterEach, describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import {
  applyMotion,
  MOTION_ATTRIBUTE,
  reducedMotion,
  subscribeMotion,
  useReducedMotion,
} from '../src/index'
import { useDom } from './dom'

useDom()

/** The system's answer to `(prefers-reduced-motion: reduce)`, and who listens to it. */
let systemReduced = false
const mediaListeners = new Set<() => void>()

afterEach(() => {
  applyMotion('system')
  systemReduced = false
  mediaListeners.clear()
  delete (globalThis as Record<string, unknown>).matchMedia
})

function stubSystem(): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query === '(prefers-reduced-motion: reduce)' && systemReduced
      },
      addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
    }),
  })
}

function Probe() {
  return <p>{useReducedMotion() ? 'reduced' : 'full'}</p>
}

describe('reduced motion', () => {
  it('puts the override on <html> and takes it off for system', () => {
    const root = document.documentElement
    applyMotion('reduce')
    expect(root.getAttribute(MOTION_ATTRIBUTE)).toBe('reduce')
    applyMotion('full')
    expect(root.getAttribute(MOTION_ATTRIBUTE)).toBe('full')
    applyMotion('system')
    expect(root.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
  })

  it('follows the system under system, and the override over it', () => {
    stubSystem()
    expect(reducedMotion()).toBe(false)
    systemReduced = true
    expect(reducedMotion()).toBe(true)
    applyMotion('full')
    expect(reducedMotion()).toBe(false)
    systemReduced = false
    applyMotion('reduce')
    expect(reducedMotion()).toBe(true)
  })

  it('is false with no matchMedia and no override', () => {
    expect(reducedMotion()).toBe(false)
    applyMotion('reduce')
    expect(reducedMotion()).toBe(true)
  })

  it('tells its subscribers of an override and of the system, until they leave', () => {
    stubSystem()
    let calls = 0
    const off = subscribeMotion(() => calls++)
    applyMotion('reduce')
    expect(calls).toBe(1)
    for (const listener of mediaListeners) listener()
    expect(calls).toBe(2)
    off()
    applyMotion('full')
    expect(calls).toBe(2)
    expect(mediaListeners.size).toBe(0)
  })

  it('redraws a component that reads it, for either change', () => {
    stubSystem()
    render(<Probe />)
    expect(screen.getByText('full')).toBeTruthy()
    act(() => applyMotion('reduce'))
    expect(screen.getByText('reduced')).toBeTruthy()
    act(() => applyMotion('system'))
    expect(screen.getByText('full')).toBeTruthy()
    systemReduced = true
    act(() => {
      for (const listener of mediaListeners) listener()
    })
    expect(screen.getByText('reduced')).toBeTruthy()
  })
})
