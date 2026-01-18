import express, { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const apiIdRaw = process.env.TG_API_ID ?? "";
const apiHash = process.env.TG_API_HASH ?? "";

if (!apiIdRaw || !apiHash) {
  console.error("TG_API_ID and TG_API_HASH are required.");
  process.exit(1);
}

const apiId = Number(apiIdRaw);
if (!Number.isInteger(apiId)) {
  console.error("TG_API_ID must be an integer.");
  process.exit(1);
}

const sessionPath = process.env.TG_SESSION_PATH ?? "/data/tg_user.session";
const portRaw = process.env.HTTP_PORT;
const httpPort = portRaw ? Number(portRaw) : 3000;
const httpToken = process.env.HTTP_TOKEN ?? "";
const healthTelegramTtlMs = parsePositiveInt(
  process.env.HEALTH_TELEGRAM_TTL_MS,
  15000
);
const healthTelegramTimeoutMs = parsePositiveInt(
  process.env.HEALTH_TELEGRAM_TIMEOUT_MS,
  5000
);

if (!Number.isInteger(httpPort) || httpPort <= 0) {
  console.error("HTTP_PORT must be a positive integer.");
  process.exit(1);
}

let sessionString = loadSessionString(sessionPath);
let client: TelegramClient | null = null;
let connectPromise: Promise<void> | null = null;
let authorized = false;
let authError: Error | null = null;
let lastTelegramHealthCheckAt = 0;
let lastTelegramHealthCheckOk = false;
let lastTelegramHealthCheckError: string | null = null;
let lastTelegramHealthCheckLatencyMs: number | null = null;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function loadSessionString(path: string): string {
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error("Failed to read session file:", err);
    }
    return "";
  }
}

function initClientIfNeeded(): TelegramClient {
  if (!sessionString) {
    sessionString = loadSessionString(sessionPath);
  }

  if (!sessionString) {
    throw new Error(
      `Telegram session not found at ${sessionPath}. Run bootstrap to create it.`
    );
  }

  if (!client) {
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
    });
    connectPromise = null;
    authorized = false;
    authError = null;
  }

  return client;
}

function getClientOrThrow(): TelegramClient {
  if (!client) {
    throw new Error("Telegram client not initialized.");
  }
  return client;
}

async function ensureAuthorized(): Promise<void> {
  if (authorized) {
    return;
  }
  if (authError) {
    throw authError;
  }

  let tgClient: TelegramClient;
  try {
    tgClient = initClientIfNeeded();
  } catch (err) {
    authError = err as Error;
    throw authError;
  }

  if (!connectPromise) {
    connectPromise = (async () => {
      await tgClient.connect();
      try {
        await tgClient.getMe();
        authorized = true;
      } catch (err) {
        authError = new Error(
          "Telegram session is not authorized. Run bootstrap to create a valid session."
        );
        throw authError;
      }
    })();
  }

  await connectPromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Telegram health check timed out."));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function checkTelegramHealth(): Promise<{
  ok: boolean;
  error?: string;
  latencyMs?: number;
  cached: boolean;
}> {
  const now = Date.now();
  if (
    lastTelegramHealthCheckAt > 0 &&
    now - lastTelegramHealthCheckAt < healthTelegramTtlMs
  ) {
    return {
      ok: lastTelegramHealthCheckOk,
      error: lastTelegramHealthCheckError ?? undefined,
      latencyMs: lastTelegramHealthCheckLatencyMs ?? undefined,
      cached: true,
    };
  }

  const startedAt = Date.now();
  let ok = false;
  let error: string | null = null;

  try {
    await withTimeout(
      (async () => {
        await ensureAuthorized();
        const tgClient = getClientOrThrow();
        if (!tgClient.connected) {
          await tgClient.connect();
        }
        await tgClient.getMe();
      })(),
      healthTelegramTimeoutMs
    );
    ok = true;
  } catch (err) {
    error = (err as Error).message;
  }

  lastTelegramHealthCheckAt = Date.now();
  lastTelegramHealthCheckOk = ok;
  lastTelegramHealthCheckError = error;
  lastTelegramHealthCheckLatencyMs = Date.now() - startedAt;

  return {
    ok,
    error: error ?? undefined,
    latencyMs: lastTelegramHealthCheckLatencyMs ?? undefined,
    cached: false,
  };
}

function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  if (!httpToken) {
    next();
    return;
  }

  const authHeader = req.header("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  if (token !== httpToken) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  next();
}

function normalizeChatId(chatId: string | number): string | number {
  if (typeof chatId === "number") {
    return chatId;
  }

  const trimmed = chatId.trim();
  if (trimmed.startsWith("@")) {
    return trimmed;
  }

  if (/^-?\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isSafeInteger(asNumber)) {
      return asNumber;
    }
  }

  return trimmed;
}

const app = express();
app.use(express.json({ limit: "128kb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/health/telegram", async (_req: Request, res: Response) => {
  const health = await checkTelegramHealth();
  if (health.ok) {
    res.json({
      ok: true,
      cached: health.cached,
      latency_ms: health.latencyMs,
    });
    return;
  }

  res.status(503).json({
    ok: false,
    error: health.error ?? "Telegram health check failed.",
    cached: health.cached,
    latency_ms: health.latencyMs,
  });
});

app.post("/send", requireBearerToken, async (req: Request, res: Response) => {
  const { chat_id: chatId, message } = req.body ?? {};

  if (chatId === undefined || message === undefined) {
    res.status(400).json({ ok: false, error: "chat_id and message are required" });
    return;
  }

  if (typeof chatId !== "string" && typeof chatId !== "number") {
    res.status(400).json({ ok: false, error: "chat_id must be a string or number" });
    return;
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ ok: false, error: "message must be a non-empty string" });
    return;
  }

  try {
    await ensureAuthorized();
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
    return;
  }

  try {
    const entity = normalizeChatId(chatId);
    const tgClient = getClientOrThrow();
    await tgClient.sendMessage(entity, { message });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to send message:", err);
    res.status(500).json({ ok: false, error: "Failed to send message" });
  }
});

app.listen(httpPort, "0.0.0.0", () => {
  console.log(`telegram-bridge listening on 0.0.0.0:${httpPort}`);
  if (!sessionString) {
    console.warn("No session file found. Run bootstrap before calling /send.");
  }
});
