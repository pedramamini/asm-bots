import { DocsLink, type PageAbout } from '../PageIntro'
import { Steps, Terms } from './parts'

export const EDITOR_ABOUT: PageAbout = {
  name: 'the editor',
  docs: 'machine/debugger',
  lead: (
    <>
      The editor is where a bot is made: write 8086 assembly, see its bytes as you type, test it
      against the roster, and step it one instruction at a time in the debugger.
    </>
  ),
  details: (
    <>
      <p>
        The source assembles as you type. The gutter shows each line&rsquo;s address and bytes;
        errors and lint warnings mark the line and say how to fix it. A bot is 512 bytes at most,
        and its <code>%name</code> is the name the arena shows.
      </p>
      <Steps>
        <li>
          <b className="text-bright">Write</b>: start from <code>templates ▾</code> or open a roster
          bot from the library (<kbd>b</kbd>) and fork it.
        </li>
        <li>
          <b className="text-bright">Test</b>: <code>test vs ▾</code> fights 10 rounds against a
          roster bot in the background and counts wins, ties, and losses.
        </li>
        <li>
          <b className="text-bright">Debug</b>: <kbd>F5</kbd> runs, <kbd>F11</kbd> steps,{' '}
          <kbd>,</kbd> steps back. Watch the registers, the processes, and the memory change.
        </li>
        <li>
          <b className="text-bright">Save</b>: your bots stay in this browser; sign in to keep them
          in your account and submit them to a hill.
        </li>
      </Steps>
      <Terms
        items={[
          ['layout ▾', 'show, hide, and reset the panels. Drag a panel by its title to move it.'],
          ['listing', 'the bytes of every line, beside the source (l).'],
          ['arena strip', 'the debugger’s battle, drawn as the arena draws it.'],
        ]}
      />
      <p className="text-muted">
        New to assembly? <DocsLink to="start-here">start here</DocsLink> writes the imp line by
        line. Every instruction is in the <DocsLink to="reference/data">reference</DocsLink>.
      </p>
    </>
  ),
}
