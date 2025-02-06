import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { LeaderboardService } from "./service.ts";
import { SQLiteDatabaseService } from "../db/service.ts";
import { AuthService } from "../auth/service.ts";
import type { Battle } from "../types.ts";

const TEST_DB = ":memory:";
const TEST_JWT_SECRET = "test-secret-key";

async function setupTestEnvironment() {
  const db = new SQLiteDatabaseService(TEST_DB);
  const auth = new AuthService(db, TEST_JWT_SECRET);
  const leaderboard = new LeaderboardService(db);

  // Create test users
  const user1 = await auth.registerUser({
    username: "player1",
    email: "player1@test.com",
    password: "password123",
  });

  const user2 = await auth.registerUser({
    username: "player2",
    email: "player2@test.com",
    password: "password123",
  });

  return { db, leaderboard, user1, user2 };
}

Deno.test("LeaderboardService - Battle Scoring", async (t) => {
  const { db, leaderboard, user1, user2 } = await setupTestEnvironment();

  const battle: Battle = {
    id: crypto.randomUUID(),
    bots: [user1.id, user2.id],
    status: "completed",
    winner: user1.id,
    startTime: new Date(Date.now() - 30000), // 30 seconds ago
    endTime: new Date(),
    events: [],
  };

  await db.createBattle(battle.bots);
  await db.updateBattle(battle.id, battle);

  await t.step("Update Rankings After Battle", async () => {
    await leaderboard.updateRankings(battle.id);

    const winner = await leaderboard.getUserRanking(user1.id);
    const loser = await leaderboard.getUserRanking(user2.id);

    assertExists(winner);
    assertExists(loser);
    assertEquals(winner.wins, 1);
    assertEquals(winner.losses, 0);
    assertEquals(loser.wins, 0);
    assertEquals(loser.losses, 1);
  });

  await t.step("Calculate Time Bonus", async () => {
    const quickBattle: Battle = {
      ...battle,
      id: crypto.randomUUID(),
      startTime: new Date(Date.now() - 5000), // 5 seconds ago
      endTime: new Date(),
    };

    await db.createBattle(quickBattle.bots);
    await db.updateBattle(quickBattle.id, quickBattle);
    await leaderboard.updateRankings(quickBattle.id);

    const winner = await leaderboard.getUserRanking(user1.id);
    assertExists(winner);
    assertEquals(winner.wins, 2);
    // Quick battle should give more points
    assertEquals(winner.score > 200, true);
  });
});

Deno.test("LeaderboardService - Leaderboard Rankings", async (t) => {
  const { leaderboard, user1, user2 } = await setupTestEnvironment();

  await t.step("Get Leaderboard", async () => {
    const rankings = await leaderboard.getLeaderboard(10);
    assertEquals(rankings.length > 0, true);
    assertEquals(rankings[0].username, "player1"); // Winner should be first
  });

  await t.step("Get User Ranking", async () => {
    const ranking = await leaderboard.getUserRanking(user1.id);
    assertExists(ranking);
    assertEquals(ranking.username, "player1");
    assertEquals(ranking.wins > 0, true);
  });

  await t.step("Get Ranking History", async () => {
    const history = await leaderboard.getRankingHistory(user1.id);
    assertEquals(history.length > 0, true);
    assertEquals(history[0].userId, user1.id);
    assertEquals(history[0].scoreDelta > 0, true);
  });
});

Deno.test("LeaderboardService - Top Performers", async (t) => {
  const { leaderboard } = await setupTestEnvironment();

  await t.step("Get Top Winners", async () => {
    const topWinners = await leaderboard.getTopPerformers('wins');
    assertEquals(topWinners.length > 0, true);
    assertEquals(topWinners[0].wins > 0, true);
  });

  await t.step("Get Top Win Rates", async () => {
    const topWinRates = await leaderboard.getTopPerformers('winRate');
    assertEquals(topWinRates.length > 0, true);
    assertEquals(topWinRates[0].winRate > 0, true);
  });

  await t.step("Get Top Scores", async () => {
    const topScores = await leaderboard.getTopPerformers('score');
    assertEquals(topScores.length > 0, true);
    assertEquals(topScores[0].score > 0, true);
  });
});

Deno.test("LeaderboardService - Consecutive Wins Bonus", async (t) => {
  const { db, leaderboard, user1, user2 } = await setupTestEnvironment();

  const createWinningBattle = async () => {
    const battle: Battle = {
      id: crypto.randomUUID(),
      bots: [user1.id, user2.id],
      status: "completed",
      winner: user1.id,
      startTime: new Date(Date.now() - 30000),
      endTime: new Date(),
      events: [],
    };

    await db.createBattle(battle.bots);
    await db.updateBattle(battle.id, battle);
    await leaderboard.updateRankings(battle.id);
  };

  await t.step("Consecutive Wins Increase Score", async () => {
    const initialRanking = await leaderboard.getUserRanking(user1.id);

    // Win three battles in a row
    await createWinningBattle();
    await createWinningBattle();
    await createWinningBattle();

    const finalRanking = await leaderboard.getUserRanking(user1.id);
    assertExists(initialRanking);
    assertExists(finalRanking);

    // Each consecutive win should give more points
    const avgPointsPerWin = finalRanking.score / finalRanking.wins;
    assertEquals(avgPointsPerWin > 100, true);
  });
});