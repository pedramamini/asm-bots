import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { SCHEMA, RankingRow, RankingQueries, QueryResult } from "./schema.ts";

export class SQLiteRankingQueries implements RankingQueries {
  constructor(private db: DB) {
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.execute(SCHEMA.RANKINGS);
    this.db.execute(SCHEMA.RANKING_HISTORY);
    SCHEMA.INDEXES.forEach(index => {
      if (index.includes('rankings') || index.includes('ranking_history')) {
        this.db.execute(index);
      }
    });
  }

  async getRanking(userId: string): Promise<RankingRow | null> {
    const result = await this.db.query<RankingRow>(
      "SELECT * FROM rankings WHERE user_id = ?",
      [userId]
    );
    return result[0] || null;
  }

  async getLeaderboard(limit = 100, offset = 0): Promise<(RankingRow & { username: string })[]> {
    return await this.db.query(
      `SELECT r.*, u.username
       FROM rankings r
       JOIN users u ON r.user_id = u.id
       ORDER BY r.score DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  async updateRanking(ranking: RankingRow): Promise<QueryResult> {
    const fields = Object.keys(ranking)
      .filter(key => key !== 'user_id')
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.entries(ranking)
      .filter(([key]) => key !== 'user_id')
      .map(([_, value]) => value);

    return await this.db.query(
      `INSERT INTO rankings (user_id, ${Object.keys(ranking).filter(k => k !== 'user_id').join(', ')})
       VALUES (?, ${Array(values.length).fill('?').join(', ')})
       ON CONFLICT(user_id) DO UPDATE SET ${fields}`,
      [ranking.user_id, ...values]
    ) as QueryResult;
  }

  async addRankingHistory(history: Omit<RankingHistoryRow, 'id'>): Promise<QueryResult> {
    return await this.db.query(
      `INSERT INTO ranking_history (user_id, timestamp, old_rank, new_rank, score_delta)
       VALUES (?, ?, ?, ?, ?)`,
      [
        history.user_id,
        history.timestamp,
        history.old_rank,
        history.new_rank,
        history.score_delta,
      ]
    ) as QueryResult;
  }

  async getRankingHistory(userId: string, limit = 10): Promise<RankingHistoryRow[]> {
    return await this.db.query<RankingHistoryRow>(
      `SELECT * FROM ranking_history
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [userId, limit]
    );
  }

  async getTopPerformers(
    orderBy: string,
    limit = 10
  ): Promise<(RankingRow & { username: string })[]> {
    const validOrderColumns = ['score', 'wins', 'total_battles'];
    if (!validOrderColumns.includes(orderBy)) {
      orderBy = 'score';
    }

    return await this.db.query(
      `SELECT r.*, u.username
       FROM rankings r
       JOIN users u ON r.user_id = u.id
       WHERE r.total_battles >= 10
       ORDER BY r.${orderBy} DESC
       LIMIT ?`,
      [limit]
    );
  }

  async getWinRate(userId: string): Promise<number> {
    const ranking = await this.getRanking(userId);
    if (!ranking || ranking.total_battles === 0) {
      return 0;
    }
    return ranking.wins / ranking.total_battles;
  }

  async getAverageScore(): Promise<number> {
    const result = await this.db.query<{ avg_score: number }>(
      `SELECT AVG(score) as avg_score FROM rankings
       WHERE total_battles >= 10`
    );
    return result[0]?.avg_score || 0;
  }

  async getRankPosition(userId: string): Promise<number> {
    const result = await this.db.query<{ rank: number }>(
      `SELECT COUNT(*) + 1 as rank
       FROM rankings
       WHERE score > (
         SELECT score FROM rankings WHERE user_id = ?
       )`,
      [userId]
    );
    return result[0]?.rank || 0;
  }

  async getRecentBattles(userId: string, limit = 5): Promise<{ wins: number; losses: number }> {
    const result = await this.db.query<{ wins: number; losses: number }>(
      `SELECT
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN winner_id != ? THEN 1 ELSE 0 END) as losses
       FROM (
         SELECT winner_id
         FROM battles
         WHERE ? IN (SELECT bot_id FROM battle_participants WHERE battle_id = battles.id)
         AND status = 'completed'
         ORDER BY end_time DESC
         LIMIT ?
       )`,
      [userId, userId, userId, limit]
    );
    return result[0] || { wins: 0, losses: 0 };
  }
}