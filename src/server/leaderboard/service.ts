import type { DatabaseService } from "../db/service.ts";
import type { Battle } from "../types.ts";

export interface RankingScore {
  userId: string;
  username: string;
  totalBattles: number;
  wins: number;
  losses: number;
  winRate: number;
  averageTime: number;
  score: number;
}

export interface RankingHistory {
  userId: string;
  timestamp: number;
  oldRank: number;
  newRank: number;
  scoreDelta: number;
}

export class LeaderboardService {
  // Scoring weights
  private readonly WIN_POINTS = 100;
  private readonly LOSS_POINTS = -50;
  private readonly TIME_BONUS_MULTIPLIER = 0.1; // Bonus points for quick wins
  private readonly CONSECUTIVE_WIN_MULTIPLIER = 1.5;

  constructor(private db: DatabaseService) {}

  private async calculateBattleScore(battle: Battle, winnerId: string): Promise<number> {
    if (!battle.startTime || !battle.endTime) {
      return 0;
    }

    const battleDuration = battle.endTime.getTime() - battle.startTime.getTime();
    const timeBonus = Math.max(0, 60000 - battleDuration) * this.TIME_BONUS_MULTIPLIER;

    // Check for consecutive wins
    const previousBattles = await this.db.listBattles('completed');
    const userPreviousBattles = previousBattles
      .filter(b => b.winner === winnerId)
      .sort((a, b) =>
        (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0)
      );

    let consecutiveWins = 0;
    for (const battle of userPreviousBattles) {
      if (battle.winner === winnerId) {
        consecutiveWins++;
      } else {
        break;
      }
    }

    const consecutiveBonus = Math.pow(this.CONSECUTIVE_WIN_MULTIPLIER, consecutiveWins);

    return (this.WIN_POINTS + timeBonus) * consecutiveBonus;
  }

  async updateRankings(battleId: string): Promise<void> {
    const battle = await this.db.getBattle(battleId);
    if (!battle.winner || battle.status !== 'completed') {
      throw new Error('Cannot update rankings for incomplete battle');
    }

    const winnerId = battle.winner;
    const loserId = battle.bots.find(id => id !== winnerId);
    if (!loserId) return;

    const battleScore = await this.calculateBattleScore(battle, winnerId);

    // Update winner's score
    await this.db.query(
      `INSERT INTO rankings (user_id, score, wins, losses, total_battles)
       VALUES (?, ?, 1, 0, 1)
       ON CONFLICT(user_id) DO UPDATE SET
       score = score + ?,
       wins = wins + 1,
       total_battles = total_battles + 1`,
      [winnerId, battleScore, battleScore]
    );

    // Update loser's score
    await this.db.query(
      `INSERT INTO rankings (user_id, score, wins, losses, total_battles)
       VALUES (?, ?, 0, 1, 1)
       ON CONFLICT(user_id) DO UPDATE SET
       score = GREATEST(0, score + ?),
       losses = losses + 1,
       total_battles = total_battles + 1`,
      [loserId, this.LOSS_POINTS, this.LOSS_POINTS]
    );

    // Record ranking history
    const timestamp = Date.now();
    const rankings = await this.getLeaderboard();
    const winnerOldRank = rankings.findIndex(r => r.userId === winnerId);
    const loserOldRank = rankings.findIndex(r => r.userId === loserId);

    // Re-fetch rankings after update
    const newRankings = await this.getLeaderboard();
    const winnerNewRank = newRankings.findIndex(r => r.userId === winnerId);
    const loserNewRank = newRankings.findIndex(r => r.userId === loserId);

    // Record history for winner
    await this.db.query(
      `INSERT INTO ranking_history (user_id, timestamp, old_rank, new_rank, score_delta)
       VALUES (?, ?, ?, ?, ?)`,
      [winnerId, timestamp, winnerOldRank, winnerNewRank, battleScore]
    );

    // Record history for loser
    await this.db.query(
      `INSERT INTO ranking_history (user_id, timestamp, old_rank, new_rank, score_delta)
       VALUES (?, ?, ?, ?, ?)`,
      [loserId, timestamp, loserOldRank, loserNewRank, this.LOSS_POINTS]
    );
  }

  async getLeaderboard(limit = 100, offset = 0): Promise<RankingScore[]> {
    const rankings = await this.db.query<RankingScore>(
      `SELECT
        r.user_id as userId,
        u.username,
        r.total_battles as totalBattles,
        r.wins,
        r.losses,
        CAST(r.wins AS FLOAT) / NULLIF(r.total_battles, 0) as winRate,
        r.average_time as averageTime,
        r.score
       FROM rankings r
       JOIN users u ON r.user_id = u.id
       ORDER BY r.score DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rankings.map(rank => ({
      ...rank,
      winRate: rank.winRate || 0,
    }));
  }

  async getUserRanking(userId: string): Promise<RankingScore | null> {
    const ranking = await this.db.query<RankingScore>(
      `SELECT
        r.user_id as userId,
        u.username,
        r.total_battles as totalBattles,
        r.wins,
        r.losses,
        CAST(r.wins AS FLOAT) / NULLIF(r.total_battles, 0) as winRate,
        r.average_time as averageTime,
        r.score
       FROM rankings r
       JOIN users u ON r.user_id = u.id
       WHERE r.user_id = ?`,
      [userId]
    );

    if (!ranking.length) return null;

    return {
      ...ranking[0],
      winRate: ranking[0].winRate || 0,
    };
  }

  async getRankingHistory(userId: string, limit = 10): Promise<RankingHistory[]> {
    return await this.db.query<RankingHistory>(
      `SELECT
        user_id as userId,
        timestamp,
        old_rank as oldRank,
        new_rank as newRank,
        score_delta as scoreDelta
       FROM ranking_history
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [userId, limit]
    );
  }

  async getTopPerformers(category: 'wins' | 'winRate' | 'score', limit = 10): Promise<RankingScore[]> {
    const orderBy = category === 'winRate'
      ? 'CAST(wins AS FLOAT) / NULLIF(total_battles, 0)'
      : category;

    const rankings = await this.db.query<RankingScore>(
      `SELECT
        r.user_id as userId,
        u.username,
        r.total_battles as totalBattles,
        r.wins,
        r.losses,
        CAST(r.wins AS FLOAT) / NULLIF(r.total_battles, 0) as winRate,
        r.average_time as averageTime,
        r.score
       FROM rankings r
       JOIN users u ON r.user_id = u.id
       WHERE r.total_battles >= 10
       ORDER BY ${orderBy} DESC
       LIMIT ?`,
      [limit]
    );

    return rankings.map(rank => ({
      ...rank,
      winRate: rank.winRate || 0,
    }));
  }
}