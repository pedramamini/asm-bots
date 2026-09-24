/**
 * `@asmbots/protocol`: what the web app, the API, and the CLI say to each other. Zod schemas and
 * their types for the API's records, replays, share links, `LiveRoom` messages, and errors. It
 * runs in the browser, the Worker, and Bun: no Node built-ins.
 */
export {
  AssembleRequest,
  AssembleResult,
  BotDetail,
  BotLabel,
  BotPlacement,
  BotVersionDetail,
  Diagnostic,
  HillDetail,
  HillList,
  HillStanding,
  HillSummary,
  MAX_SOURCE_TEXT,
  MAX_VERIFIED_CYCLES,
  MatchList,
  MatchSummary,
  ReplayUpload,
  StoredReplay,
  TournamentDetail,
  TournamentList,
  UserDetail,
} from './api'
export { fromBase64, fromBase64Url, sha256Hex, toBase64, toBase64Url } from './bytes'
export { canonicalJson } from './canonical'
export { ApiError, apiError, ERROR_STATUS, type ErrorCode } from './errors'
export {
  Hello,
  LIVE_PROTOCOL,
  LiveMessage,
  LiveRoomRef,
  MatchFinished,
  MatchStarted,
  Ping,
  parseLiveMessage,
  Standing,
  Standings,
} from './live'
export {
  Bot,
  BotVersion,
  Handle,
  Hill,
  HillEntry,
  Match,
  MatchOutcome,
  Tournament,
  TournamentConfig,
  TournamentKind,
  TournamentStatus,
  User,
  Visibility,
} from './models'
export {
  BotMetaSchema,
  type BuildReplayInput,
  buildReplay,
  bytesProblem,
  ISA,
  MAX_REPLAY_BOTS,
  MAX_REPLAY_CYCLES,
  MAX_REPLAY_ROUNDS,
  MIN_REPLAY_BOTS,
  matchResultHash,
  parseReplay,
  Replay,
  ReplayBot,
  ReplayConfig,
  type ReplayInputBot,
  ReplayResult,
  RoundResult,
  replayBots,
  replayConfig,
  replayKey,
  replayMatch,
  Seed,
  withoutSources,
} from './replay'
export { Id, ProtocolError, parse, SHA256, Slug } from './schema'
export {
  BotRef,
  decodeReplayFragment,
  decodeShare,
  decodeSources,
  encodeReplayFragment,
  encodeShare,
  encodeSources,
  MAX_REPLAY_FRAGMENT,
  MAX_SHARED_TEXT,
  REPLAY_KEY,
  SharedSource,
  ShareLink,
  SOURCES_KEY,
} from './share'
