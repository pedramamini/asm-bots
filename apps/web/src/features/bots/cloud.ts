/**
 * Cloud bots from the web app (PRODUCT_SPEC §3, §9): a bot of this browser kept in the account.
 * This browser always keeps its copy; the account copy is linked by the local bot's `cloudId`.
 */
import type { Bot, BotVersion } from '@asmbots/protocol'
import { isNotFound } from '../../api/client'
import { addBotVersion, createBot, updateBot } from '../../api/writes'
import { addVersion } from '../../store/bot-versions'
import { type LocalBot, markLocalBotsSynced, saveLocalBot } from '../../store/local-bots'

/** The account's side of a save: its bot, and the version the source is there. */
export interface CloudSave {
  readonly bot: Bot
  readonly version: BotVersion
  /** False when the account had these bytes already as its latest version. */
  readonly created: boolean
}

/** The longest name the account takes (`NAME`). */
const MAX_NAME = 64

function accountName(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').slice(0, MAX_NAME)
}

/**
 * Saves a local bot in the account: the next version of its linked bot (renamed to match), or a
 * new bot that the local one is then linked to. A linked bot since deleted from the account is
 * made again. Throws the API's refusal (`ApiRequestError`), such as a source that does not
 * assemble.
 */
export async function saveToCloud(local: LocalBot): Promise<CloudSave> {
  const name = accountName(local.name)
  if (local.cloudId !== undefined) {
    try {
      const saved = await addBotVersion(local.cloudId, local.source)
      if (saved.bot.name === name) return saved
      return { ...saved, bot: (await updateBot(saved.bot.id, { name })).bot }
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }
  const made = await createBot({ name, source: local.source })
  await markLocalBotsSynced(new Map([[local.id, made.bot.id]]))
  return { ...made, created: true }
}

/**
 * The local bot that holds account bot `bot`: the one linked to it, else a new one made from
 * `readSource` (its latest version's source) and linked.
 */
export async function localCopyOf(
  bot: Bot,
  local: readonly LocalBot[],
  readSource: () => Promise<string>,
): Promise<LocalBot> {
  const linked = local.find((b) => b.cloudId === bot.id)
  if (linked !== undefined) return linked
  const source = await readSource()
  const copy = await saveLocalBot({ name: bot.name, source, cloudId: bot.id })
  await addVersion(copy.id, { name: bot.name, source })
  return copy
}

/**
 * A copy of someone's bot in my bots (`fork`): in this browser, and in the account too when
 * `signedIn`. Returns the local copy, and whether the account took it.
 */
export async function forkIntoMyBots(
  bot: { name: string; source: string },
  signedIn: boolean,
): Promise<{ local: LocalBot; cloud: boolean }> {
  const copy = await saveLocalBot(bot)
  await addVersion(copy.id, bot)
  if (!signedIn) return { local: copy, cloud: false }
  try {
    const made = await createBot({ name: accountName(bot.name), source: bot.source })
    await markLocalBotsSynced(new Map([[copy.id, made.bot.id]]))
    return { local: { ...copy, cloudId: made.bot.id }, cloud: true }
  } catch {
    return { local: copy, cloud: false }
  }
}
