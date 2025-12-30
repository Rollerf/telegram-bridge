import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
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

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (question: string): Promise<string> => {
  const answer = await rl.question(question);
  return answer.trim();
};

async function main(): Promise<void> {
  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 3,
  });

  try {
    await client.start({
      phoneNumber: async () => await ask("Phone number (international format): "),
      phoneCode: async () => await ask("Code (from Telegram): "),
      password: async () => await ask("2FA password (if enabled, else press Enter): "),
      onError: (err) => console.error("Login error:", err),
    });

    const sessionString = stringSession.save();
    if (!sessionString) {
      throw new Error("Failed to serialize the Telegram session.");
    }
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, sessionString, "utf8");
    console.log(`Session saved to ${sessionPath}`);
  } catch (err) {
    console.error("Bootstrap failed:", err);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
    rl.close();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
