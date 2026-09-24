/** The king's card (PRODUCT_SPEC §5): rank 1 on the hill, its score, rating, record, and age. */
import type { HillStanding } from '@asmbots/protocol'
import { Identicon, Panel, Skeleton, Stat } from '@asmbots/ui'
import { authorOf, BotLink, count, plural } from './links'

export interface KingCardProps {
  /** Undefined while the hill loads; null when nobody holds it. */
  king: HillStanding | null | undefined
  className?: string | undefined
}

export function KingCard({ king, className }: KingCardProps) {
  return (
    <Panel
      className={className}
      title="king"
      status={king ? `age ${count(king.entry.age)}` : king === null ? 'vacant' : 'loading'}
    >
      {king === undefined ? (
        <Skeleton rows={3} />
      ) : king === null ? (
        <p className="text-data text-muted">nobody holds this hill yet: the first bot takes it.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Identicon value={king.bot.versionId} size={40} />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-modal-title text-accent">
                <BotLink bot={king.bot} />
              </p>
              <p className="truncate text-data text-muted">
                v{king.bot.version} · by {authorOf(king.bot)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Stat label="score" value={count(king.entry.score)} className="min-w-24 flex-1" />
            <Stat
              label="rating"
              value={count(Math.round(king.entry.rating))}
              note={king.rd === null ? undefined : `± ${count(Math.round(king.rd))}`}
              className="min-w-24 flex-1"
            />
            <Stat
              label="w/t/l"
              value={`${king.entry.wins}/${king.entry.ties}/${king.entry.losses}`}
              className="min-w-24 flex-1"
            />
          </div>
          <p className="text-data text-muted">
            on the hill through {plural(king.entry.age, 'challenge')}.
          </p>
        </div>
      )}
    </Panel>
  )
}
