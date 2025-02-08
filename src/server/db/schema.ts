export const SCHEMA = {
  USERS: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created DATETIME NOT NULL,
      updated DATETIME NOT NULL
    )
  `,

  SESSIONS: `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires DATETIME NOT NULL,
      created DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,

  RANKINGS: `
    CREATE TABLE IF NOT EXISTS rankings (
      user_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      total_battles INTEGER NOT NULL DEFAULT 0,
      average_time INTEGER NOT NULL DEFAULT 0,
      last_battle_time DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,

  RANKING_HISTORY: `
    CREATE TABLE IF NOT EXISTS ranking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      old_rank INTEGER NOT NULL,
      new_rank INTEGER NOT NULL,
      score_delta INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,

  INDEXES: [
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)",
    "CREATE INDEX IF NOT EXISTS idx_rankings_score ON rankings(score DESC)",
    "CREATE INDEX IF NOT EXISTS idx_rankings_wins ON rankings(wins DESC)",
    "CREATE INDEX IF NOT EXISTS idx_rankings_battles ON rankings(total_battles DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ranking_history_user ON ranking_history(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ranking_history_timestamp ON ranking_history(timestamp DESC)",
  ],
};

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created: string;
  updated: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token: string;
  expires: string;
  created: string;
}

export interface RankingRow {
  user_id: string;
  score: number;
  wins: number;
  losses: number;
  total_battles: number;
  average_time: number;
  last_battle_time: string | null;
}

export interface RankingHistoryRow {
  id: number;
  user_id: string;
  timestamp: number;
  old_rank: number;
  new_rank: number;
  score_delta: number;
}

export interface QueryResult {
  lastInsertId: number | bigint;
  changes: number;
}

export interface AuthQueries {
  createUser(user: UserRow): QueryResult;
  getUserById(id: string): UserRow | null;
  getUserByUsername(username: string): UserRow | null;
  getUserByEmail(email: string): UserRow | null;
  updateUser(id: string, updates: Partial<UserRow>): QueryResult;
  deleteUser(id: string): QueryResult;

  createSession(session: SessionRow): QueryResult;
  getSessionByToken(token: string): SessionRow | null;
  getSessionsByUserId(userId: string): SessionRow[];
  updateSession(id: string, updates: Partial<SessionRow>): QueryResult;
  deleteSession(id: string): QueryResult;
  deleteExpiredSessions(): QueryResult;
}

export interface RankingQueries {
  getRanking(userId: string): RankingRow | null;
  getLeaderboard(limit?: number, offset?: number): (RankingRow & { username: string })[];
  updateRanking(ranking: RankingRow): QueryResult;
  addRankingHistory(history: Omit<RankingHistoryRow, 'id'>): QueryResult;
  getRankingHistory(userId: string, limit?: number): RankingHistoryRow[];
  getTopPerformers(orderBy: string, limit?: number): (RankingRow & { username: string })[];
  getWinRate(userId: string): number;
  getAverageScore(): number;
  getRankPosition(userId: string): number;
  getRecentBattles(userId: string, limit?: number): { wins: number; losses: number };
}

export interface DatabaseQueries extends AuthQueries, RankingQueries {
  query<T = unknown>(sql: string, params?: unknown[]): T[];
  execute(sql: string): void;
}