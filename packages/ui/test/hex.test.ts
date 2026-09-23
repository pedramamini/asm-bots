import { describe, expect, it } from 'bun:test'
import { hexAddress, hexByte, maskHex } from '../src/index'

describe('hexAddress and hexByte', () => {
  it('write an address as 0x and 4 uppercase digits, and a byte as 2 (DESIGN_SYSTEM §1.2)', () => {
    expect(hexAddress(0x1a2f)).toBe('0x1A2F')
    expect(hexAddress(0x0a1f)).toBe('0x0A1F')
    expect(hexAddress(0)).toBe('0x0000')
    expect(hexByte(0xff)).toBe('FF')
    expect(hexByte(0x0f)).toBe('0F')
  })

  it('wrap as the core does: 16 bits for an address, 8 for a byte', () => {
    expect(hexAddress(0x1_0000)).toBe('0x0000')
    expect(hexAddress(-1)).toBe('0xFFFF')
    expect(hexByte(0x100)).toBe('00')
    expect(hexByte(-1)).toBe('FF')
  })

  it('round-trip through the hex field’s mask', () => {
    for (const n of [0, 0x41, 0x1a2f, 0xffff]) expect(maskHex(hexAddress(n), 4)).toBe(hexAddress(n))
    for (const n of [0, 0x7b, 0xff]) expect(maskHex(hexByte(n), 2)).toBe(hexByte(n))
  })
})

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
