/**
 * The non-code modules the Worker imports. Wrangler compiles a `.wasm` file into a
 * `WebAssembly.Module` (its default rule) and gives a `.ttf` file's bytes as an `ArrayBuffer`
 * (the `Data` rule in `wrangler.jsonc`).
 */
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare module '*.ttf' {
  const bytes: ArrayBuffer
  export default bytes
}
