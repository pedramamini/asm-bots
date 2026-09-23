/** A byte as two uppercase hex digits: `0F`. */
export const hexByte = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')

/** Bytes as uppercase hex pairs, as the listing and the disassembly show them: `C7 07 00 00`. */
export const bytesHex = (bytes: ArrayLike<number>) => Array.from(bytes, hexByte).join(' ')
