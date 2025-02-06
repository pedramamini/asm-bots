import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Database } from "./database.ts";
import type { Bot, Battle } from "../types.ts";

const TEST_DB = ":memory:"; // Use in-memory SQLite for testing

Deno.test("Database - Bot Operations", async (t) => {
  const db = new Database(TEST_DB);

  const testBot: Bot = {
    id: crypto.randomUUID(),
    name: "Test Bot",
    code: "MOV A, B",
    owner: "test-user",
    created: new Date(),
    updated: new Date(),
  };

  await t.step("Save Bot", async () => {
    await db.saveBot(testBot);
    const savedBot = await db.getBot(testBot.id);
    assertExists(savedBot);
    assertEquals(savedBot.name, testBot.name);
    assertEquals(savedBot.code, testBot.code);
  });

  await t.step("List Bots", async () => {
    const bots = await db.listBots();
    assertEquals(bots.length >= 1, true);
    assertEquals(bots[0].name, testBot.name);
  });

  await t.step("List Bots by Owner", async () => {
    const bots = await db.listBots("test-user");
    assertEquals(bots.length, 1);
    assertEquals(bots[0].owner, "test-user");
  });

  await t.step("Delete Bot", async () => {
    const result = await db.deleteBot(testBot.id);
    assertEquals(result, true);
    const deletedBot = await db.getBot(testBot.id);
    assertEquals(deletedBot, null);
  });

  db.close();
});

Deno.test("Database - Battle Operations", async (t) => {
  const db = new Database(TEST_DB);

  // Create test bots first
  const bot1: Bot = {
    id: crypto.randomUUID(),
    name: "Bot 1",
    code: "MOV A, B",
    owner: "test-user",
    created: new Date(),
    updated: new Date(),
  };

  const bot2: Bot = {
    id: crypto.randomUUID(),
    name: "Bot 2",
    code: "MOV B, A",
    owner: "test-user",
    created: new Date(),
    updated: new Date(),
  };

  await db.saveBot(bot1);
  await db.saveBot(bot2);

  const testBattle: Battle = {
    id: crypto.randomUUID(),
    bots: [bot1.id, bot2.id],
    status: "pending",
    events: [
      {
        timestamp: Date.now(),
        type: "instruction",
        botId: bot1.id,
        data: {
          instruction: "MOV A, B",
        },
      },
    ],
  };

  await t.step("Save Battle", async () => {
    await db.saveBattle(testBattle);
    const savedBattle = await db.getBattle(testBattle.id);
    assertExists(savedBattle);
    assertEquals(savedBattle.status, testBattle.status);
    assertEquals(savedBattle.bots.length, 2);
    assertEquals(savedBattle.events.length, 1);
  });

  await t.step("Update Battle Status", async () => {
    testBattle.status = "running";
    testBattle.startTime = new Date();
    await db.saveBattle(testBattle);

    const updatedBattle = await db.getBattle(testBattle.id);
    assertExists(updatedBattle);
    assertEquals(updatedBattle.status, "running");
    assertExists(updatedBattle.startTime);
  });

  await t.step("List Battles", async () => {
    const battles = await db.listBattles();
    assertEquals(battles.length >= 1, true);
    assertEquals(battles[0].id, testBattle.id);
  });

  await t.step("List Battles by Status", async () => {
    const battles = await db.listBattles("running");
    assertEquals(battles.length, 1);
    assertEquals(battles[0].status, "running");
  });

  await t.step("Complete Battle", async () => {
    testBattle.status = "completed";
    testBattle.endTime = new Date();
    testBattle.winner = bot1.id;
    await db.saveBattle(testBattle);

    const completedBattle = await db.getBattle(testBattle.id);
    assertExists(completedBattle);
    assertEquals(completedBattle.status, "completed");
    assertEquals(completedBattle.winner, bot1.id);
    assertExists(completedBattle.endTime);
  });

  db.close();
});

Deno.test("Database - Transaction Handling", async (t) => {
  const db = new Database(TEST_DB);

  await t.step("Rollback on Error", async () => {
    const bot: Bot = {
      id: crypto.randomUUID(),
      name: "Test Bot",
      code: "MOV A, B",
      owner: "test-user",
      created: new Date(),
      updated: new Date(),
    };

    const battle: Battle = {
      id: crypto.randomUUID(),
      bots: [bot.id], // This should fail as bot doesn't exist
      status: "pending",
      events: [],
    };

    try {
      await db.saveBattle(battle);
      throw new Error("Should have failed due to foreign key constraint");
    } catch (error) {
      // Verify the battle wasn't saved
      const savedBattle = await db.getBattle(battle.id);
      assertEquals(savedBattle, null);
    }
  });

  db.close();
});