import dotenv from "dotenv";
import WebSocket from "ws";
import { getEnabledSyncTasks, sendDiscordNotification, type CloudSyncTaskRaw } from "./utils.js";

dotenv.config();

const requiredEnv = ["TRUENAS_HOST", "TRUENAS_API_KEY", "DISCORD_WEBHOOK"] as const;

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

const TRUENAS_WS = `wss://${process.env.TRUENAS_HOST}/websocket`;

console.log(`Setting WebSocket URL to ${TRUENAS_WS}`);

const ws = new WebSocket(TRUENAS_WS);

console.log("Connecting to TrueNAS...");

ws.on("open", () => {
    ws.send(JSON.stringify({
        jsonrpc: "2.0",
        msg: "connect",
        version: "1",
        support: ["1"]
    }));
});

ws.on("error", (error) => {
    console.error("WebSocket error:", error);
});

ws.on("message", async (message) => {
    let parsedMessage: unknown;

    try {
        parsedMessage = JSON.parse(message.toString());
    } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
        return;
    }

    if (!isRecord(parsedMessage)) {
        return;
    }

    console.log(parsedMessage);

    if (parsedMessage.msg === "connected") {
        console.log("Connected to TrueNAS WebSocket.");
        authenticate();
    }

    if (parsedMessage.id === 1) {
        console.log("Authentication successful.");
        startChecking();
    }

    if (parsedMessage.id === 2 && Array.isArray(parsedMessage.result)) {
        const enabledTasks = getEnabledSyncTasks(parsedMessage.result as CloudSyncTaskRaw[]);

        console.log("Received cloud sync tasks:", enabledTasks);

        await sendDiscordNotification(
            process.env.DISCORD_WEBHOOK!,
            enabledTasks
                .map((task) => `**${task.description}**: ${task.job.state} (${JSON.stringify(task.job.progress)}%)`)
                .join("\n")
        );
    }

    console.log("End of message.");
});

function authenticate(): void {
    console.log("Authenticating with API key...");

    ws.send(JSON.stringify({
        jsonrpc: "2.0",
        msg: "method",
        method: "auth.login_with_api_key",
        params: [process.env.TRUENAS_API_KEY],
        id: 1
    }));
}

function startChecking(): void {
    console.log("Starting to check for cloud sync tasks every minute...");

    setInterval(() => {
        ws.send(JSON.stringify({
            jsonrpc: "2.0",
            msg: "method",
            method: "cloudsync.query",
            id: 2
        }));
    }, 60000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
