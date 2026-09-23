import { type ComponentProps, Fragment } from 'react'
import { cx } from '../style'
import { Kbd } from './Kbd'

export interface KeyBinding {
  /** The keys, pressed one after another: `['g', 'a']`; one key: `['space']`. */
  keys: readonly string[]
  /** What they do, lowercase: `play or pause`. */
  description: string
  /** The group it lists under: `global`, `arena`. Bindings without one share an untitled group. */
  group?: string | undefined
}

export interface KeyHelpProps extends ComponentProps<'div'> {
  bindings: readonly KeyBinding[]
}

/**
 * The keymap (the `?` key's help): one table per group, in the order the groups first appear,
 * titled in muted UPPER. Each row shows the keys as keycaps, then what they do, over a hairline.
 * The groups flow into as many 256 px columns as fit.
 */
export function KeyHelp({ bindings, className, ...rest }: KeyHelpProps) {
  return (
    <div {...rest} className={cx('columns-[16rem] gap-6', className)}>
      {[...groupsOf(bindings)].map(([group, list]) => (
        <table
          key={group}
          className="mb-4 w-full break-inside-avoid border-separate border-spacing-0 text-data text-text last:mb-0"
        >
          {group !== '' && (
            <caption className="pb-1 text-left text-panel-status text-muted">{group}</caption>
          )}
          <tbody>
            {list.map((binding) => (
              <tr key={`${binding.keys.join(' ')}:${binding.description}`} className="group/row">
                <th
                  scope="row"
                  className="h-6 w-24 border-b border-border pr-2 text-left font-normal whitespace-nowrap group-last/row:border-b-0"
                >
                  {binding.keys.map((key, index) => (
                    // A key's place in the sequence is its identity: `g g` presses g twice.
                    <Fragment key={index}>
                      {index > 0 && ' '}
                      <Kbd>{key}</Kbd>
                    </Fragment>
                  ))}
                </th>
                <td className="h-6 truncate border-b border-border group-last/row:border-b-0">
                  {binding.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

/** The bindings by group, in the order each group first appears; no group is ''. */
function groupsOf(bindings: readonly KeyBinding[]): Map<string, KeyBinding[]> {
  const groups = new Map<string, KeyBinding[]>()
  for (const binding of bindings) {
    const group = binding.group ?? ''
    const list = groups.get(group)
    if (list) list.push(binding)
    else groups.set(group, [binding])
  }
  return groups
}
