import { Input } from '@asmbots/ui'

/**
 * A handle input and the line under it that says what is wrong with it (`handleProblem`, or the
 * API's refusal). Lowercases as it is typed. `id` names the problem line for `aria-describedby`.
 */
export function HandleField({
  id,
  value,
  problem,
  onChange,
  autoFocus = false,
}: {
  id: string
  value: string
  problem: string | null
  onChange: (handle: string) => void
  autoFocus?: boolean
}) {
  return (
    <>
      <Input
        aria-label="handle"
        aria-invalid={problem !== null}
        aria-describedby={id}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        maxLength={24}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value.toLowerCase())}
      />
      <p id={id} role="status" className="min-h-4 text-data text-danger">
        {problem ?? ''}
      </p>
    </>
  )
}
