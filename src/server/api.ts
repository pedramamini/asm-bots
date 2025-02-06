import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";
import { WebSocketServer } from "./websocket.ts";
import type {
  RouterContext,
  Storage,
  Bot,
  Battle,
  BotCreateRequest,
  BattleCreateRequest,
  ApiResponse,
} from "./types.ts";

// Initialize storage
const storage: Storage = {
  bots: new Map<string, Bot>(),
  battles: new Map<string, Battle>(),
  clients: new Map(),
};

const router = new Router();
const wsServer = new WebSocketServer(storage);

// Bot Management Endpoints
router.get("/api/bots", (ctx: RouterContext) => {
  const response: ApiResponse<Bot[]> = {
    success: true,
    data: Array.from(storage.bots.values()),
  };
  ctx.response.body = response;
});

router.get("/api/bots/:id", (ctx: RouterContext) => {
  const bot = storage.bots.get(ctx.params.id);
  if (!bot) {
    ctx.response.status = 404;
    ctx.response.body = {
      success: false,
      error: "Bot not found",
    };
    return;
  }

  const response: ApiResponse<Bot> = {
    success: true,
    data: bot,
  };
  ctx.response.body = response;
});

router.post("/api/bots", async (ctx: RouterContext) => {
  const body = ctx.request.body();
  if (body.type !== "json") {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "Content-Type must be application/json",
    };
    return;
  }

  const botData = await body.value as BotCreateRequest;
  if (!botData.name || !botData.code) {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "Name and code are required",
    };
    return;
  }

  const bot: Bot = {
    id: crypto.randomUUID(),
    name: botData.name,
    code: botData.code,
    owner: botData.owner || "anonymous",
    created: new Date(),
    updated: new Date(),
  };

  storage.bots.set(bot.id, bot);

  const response: ApiResponse<Bot> = {
    success: true,
    data: bot,
  };
  ctx.response.status = 201;
  ctx.response.body = response;
});

router.delete("/api/bots/:id", (ctx: RouterContext) => {
  if (!storage.bots.delete(ctx.params.id)) {
    ctx.response.status = 404;
    ctx.response.body = {
      success: false,
      error: "Bot not found",
    };
    return;
  }
  ctx.response.status = 204;
});

// Battle Operations Endpoints
router.post("/api/battles", async (ctx: RouterContext) => {
  const body = ctx.request.body();
  if (body.type !== "json") {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "Content-Type must be application/json",
    };
    return;
  }

  const battleData = await body.value as BattleCreateRequest;
  if (!battleData.bots || !Array.isArray(battleData.bots) || battleData.bots.length < 2) {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "At least two bots are required",
    };
    return;
  }

  // Validate that all bots exist
  for (const botId of battleData.bots) {
    if (!storage.bots.has(botId)) {
      ctx.response.status = 400;
      ctx.response.body = {
        success: false,
        error: `Bot ${botId} not found`,
      };
      return;
    }
  }

  const battle: Battle = {
    id: crypto.randomUUID(),
    bots: battleData.bots,
    status: 'pending',
    events: [],
  };

  storage.battles.set(battle.id, battle);

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  ctx.response.status = 201;
  ctx.response.body = response;
});

router.get("/api/battles/:id", (ctx: RouterContext) => {
  const battle = storage.battles.get(ctx.params.id);
  if (!battle) {
    ctx.response.status = 404;
    ctx.response.body = {
      success: false,
      error: "Battle not found",
    };
    return;
  }

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  ctx.response.body = response;
});

router.post("/api/battles/:id/start", async (ctx: RouterContext) => {
  const battle = storage.battles.get(ctx.params.id);
  if (!battle) {
    ctx.response.status = 404;
    ctx.response.body = {
      success: false,
      error: "Battle not found",
    };
    return;
  }

  if (battle.status !== 'pending') {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "Battle is not in pending state",
    };
    return;
  }

  battle.status = 'running';
  battle.startTime = new Date();

  // Notify WebSocket clients about battle start
  await wsServer.broadcastBattleUpdate(battle.id);

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  ctx.response.body = response;
});

// WebSocket endpoint
router.get("/ws", async (ctx: RouterContext) => {
  if (!ctx.isUpgradable) {
    ctx.response.status = 400;
    ctx.response.body = {
      success: false,
      error: "WebSocket upgrade required",
    };
    return;
  }

  const socket = await ctx.upgrade();
  await wsServer.handleConnection(socket);
});

// Create the application
const app = new Application();

// Error handling
app.use(async (ctx: RouterContext, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
    ctx.response.status = 500;
    ctx.response.body = {
      success: false,
      error: "Internal server error",
    };
  }
});

// CORS middleware
app.use(oakCors());

// Router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Start the server
const port = 8080;
console.log(`API server running on http://localhost:${port}`);
await app.listen({ port });