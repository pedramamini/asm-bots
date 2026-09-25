import { IconButton } from '@asmbots/ui'
import { Volume2, VolumeX } from 'lucide-react'
import { ARENA_KEYS } from '../../app/keymaps'
import { useSettings } from '../../store/settings'
import { toggleSound } from './engine'

/** The arena's sound switch (`m`): pressed while sound is on. */
export function SoundButton({ size }: { size?: 'sm' | 'md' | undefined }) {
  const on = useSettings((state) => state.sound.on)
  return (
    <IconButton
      size={size}
      icon={on ? Volume2 : VolumeX}
      label="sound"
      shortcut={ARENA_KEYS.mute.keys[0]}
      pressed={on}
      onClick={toggleSound}
    />
  )
}
