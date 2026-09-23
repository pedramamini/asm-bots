import { describe, expect, it } from 'bun:test'
import { maskHex } from '../src/index'

describe('maskHex', () => {
  it('accepts 0x1A2F and rejects xyz', () => {
    expect(maskHex('0x1A2F', 4)).toBe('0x1A2F')
    expect(maskHex('xyz', 4)).toBeNull()
  })

  it('writes a lowercase 0x and uppercase digits', () => {
    expect(maskHex('0X1a2f', 4)).toBe('0x1A2F')
    expect(maskHex('ff', 2)).toBe('FF')
  })

  it('passes each step of typing an address', () => {
    for (const partial of ['', '0', '0x', '0x1', '0x1A', '0x1A2', '0x1A2F']) {
      expect({ partial, masked: maskHex(partial, 4) }).toEqual({ partial, masked: partial })
    }
  })

  it('takes digits with or without the prefix, up to `digits`', () => {
    expect(maskHex('1A2F', 4)).toBe('1A2F')
    expect(maskHex('1A2F0', 4)).toBeNull()
    expect(maskHex('0x1A2F0', 4)).toBeNull()
    expect(maskHex('FF', 2)).toBe('FF')
    expect(maskHex('FFF', 2)).toBeNull()
  })

  it('rejects what cannot become hex', () => {
    for (const bad of ['x', 'x1', '0xx', '00x', '0x0x', '0xG', '-1', '1 2', ' 0x1', '$1A', '1Ah']) {
      expect({ bad, masked: maskHex(bad, 4) }).toEqual({ bad, masked: null })
    }
  })
})
