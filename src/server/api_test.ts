import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Bot, Battle } from "./types.ts";

// Mock data for testing
const testBot: Omit<Bot, "id" | "created" | "updated"> = {
  name: "Test Bot",
  code: "MOV A, B",
  owner: "test-user",
};

const testBattle: Omit<Battle, "id" | "events"> = {
  bots: [],
  status: "pending",
};

// Helper function to make API requests
async function makeRequest(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const url = `http://localhost:8080${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

Deno.test("API - Bot Management", async (t) => {
  await t.step("Create Bot", async () => {
    const response = await makeRequest("/api/bots", "POST", testBot);
    assertEquals(response.status, 201);

    const bot = await response.json();
    assertExists(bot.id);
    assertEquals(bot.name, testBot.name);
    assertEquals(bot.code, testBot.code);

    // Store bot ID for subsequent tests
    testBattle.bots = [bot.id];
  });

  await t.step("Get Bot", async () => {
    const response = await makeRequest(`/api/bots/${testBattle.bots[0]}`);
    assertEquals(response.status, 200);

    const bot = await response.json();
    assertEquals(bot.name, testBot.name);
  });

  await t.step("List Bots", async () => {
    const response = await makeRequest("/api/bots");
    assertEquals(response.status, 200);

    const bots = await response.json();
    assertEquals(Array.isArray(bots), true);
    assertEquals(bots.length >= 1, true);
  });
});

Deno.test("API - Battle Operations", async (t) => {
  let battleId: string;

  await t.step("Create Battle", async () => {
    // Create another bot for the battle
    const response1 = await makeRequest("/api/bots", "POST", {
      ...testBot,
      name: "Test Bot 2",
    });
    const bot2 = await response1.json();
    testBattle.bots.push(bot2.id);

    // Create battle with both bots
    const response2 = await makeRequest("/api/battles", "POST", testBattle);
    assertEquals(response2.status, 201);

    const battle = await response2.json();
    assertExists(battle.id);
    assertEquals(battle.status, "pending");
    assertEquals(battle.bots.length, 2);

    battleId = battle.id;
  });

  await t.step("Start Battle", async () => {
    const response = await makeRequest(`/api/battles/${battleId}/start`, "POST");
    assertEquals(response.status, 200);

    const battle = await response.json();
    assertEquals(battle.status, "running");
    assertExists(battle.startTime);
  });

  await t.step("Get Battle", async () => {
    const response = await makeRequest(`/api/battles/${battleId}`);
    assertEquals(response.status, 200);

    const battle = await response.json();
    assertEquals(battle.id, battleId);
    assertEquals(battle.status, "running");
  });
});

// Cleanup test data after all tests
Deno.test("API - Cleanup", async () => {
  for (const botId of testBattle.bots) {
    await makeRequest(`/api/bots/${botId}`, "DELETE");
  }
});