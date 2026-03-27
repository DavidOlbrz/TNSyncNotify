import dotenv from "dotenv";
import WebSocket from "ws";
import { buildTaskStatusMessage, getEnabledSyncTasks, sendDiscordNotification, type CloudSyncTaskRaw } from "./utils.js";

dotenv.config();

const requiredEnv = ["TRUENAS_HOST", "TRUENAS_API_KEY", "DISCORD_WEBHOOK"] as const;

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

const TRUENAS_WS = `wss://${process.env.TRUENAS_HOST}/websocket`;

const CHECK_INTERVAL_MS = getEnvInt("CHECK_INTERVAL_MS", 1 * 60_000);
const RUNNING_UPDATE_INTERVAL_MS = getEnvInt("RUNNING_UPDATE_INTERVAL_MS", 5 * 60_000);
const RECONNECT_DELAY_MS = getEnvInt("RECONNECT_DELAY_MS", 5_000);
const KEEPALIVE_INTERVAL_MS = getEnvInt("KEEPALIVE_INTERVAL_MS", 30_000);

type TaskNotificationState = {
    state: string;
    lastRunningNotificationAt: number;
};

const lastNotifiedByTaskId = new Map<number, TaskNotificationState>();
let checkInterval: NodeJS.Timeout | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let ws: WebSocket | null = null;
let shutdownRequested = false;

console.log(`Setting WebSocket URL to ${TRUENAS_WS}`);

connectWebSocket();

process.once("SIGINT", () => {
    shutdownRequested = true;
    cleanupTimers();
    ws?.close();
});

process.once("SIGTERM", () => {
    shutdownRequested = true;
    cleanupTimers();
    ws?.close();
});

function connectWebSocket(): void {
    console.log("Connecting to TrueNAS...");

    ws = new WebSocket(TRUENAS_WS);

    ws.on("open", () => {
        console.log("WebSocket opened.");

        ws?.send(JSON.stringify({
            jsonrpc: "2.0",
            msg: "connect",
            version: "1",
            support: ["1"]
        }));
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });

    ws.on("close", (code, reason) => {
        console.warn(`WebSocket closed (code=${code}, reason=${reason.toString() || "n/a"}).`);
        cleanupTimers();
        scheduleReconnect();
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
            startKeepAlive();
            authenticate();
        }

        const isAuthResponse = parsedMessage.id === 1 || parsedMessage.id === "1";

        if (isAuthResponse) {
            console.log("Authentication successful.");
            subscribeRealtimeEvents();
            startChecking();
        }

        if (isRealtimeCloudsyncEvent(parsedMessage)) {
            console.log("Realtime cloud sync event received. Triggering immediate query.");
            queryCloudSyncTasks();
        }

        if (parsedMessage.id === 2 && Array.isArray(parsedMessage.result)) {
            const enabledTasks = getEnabledSyncTasks(parsedMessage.result as CloudSyncTaskRaw[]);
            const now = Date.now();
            const notifyLines: string[] = [];
            const currentTaskIds = new Set<number>();

            console.log("Received cloud sync tasks:", enabledTasks);

            for (const task of enabledTasks) {
                currentTaskIds.add(task.id);

                const currentState = task.state;
                const previous = lastNotifiedByTaskId.get(task.id);

                const isStatusChange = !previous || previous.state !== currentState;
                const isRunningProgressUpdate = currentState === "RUNNING"
                    && !!previous
                    && now - previous.lastRunningNotificationAt >= RUNNING_UPDATE_INTERVAL_MS;

                if (!isStatusChange && !isRunningProgressUpdate) {
                    continue;
                }

                notifyLines.push(
                    ...buildTaskStatusMessage(task)
                );

                lastNotifiedByTaskId.set(task.id, {
                    state: currentState,
                    lastRunningNotificationAt: currentState === "RUNNING"
                        ? now
                        : previous?.lastRunningNotificationAt ?? 0
                });
            }

            for (const taskId of lastNotifiedByTaskId.keys()) {
                if (!currentTaskIds.has(taskId)) {
                    lastNotifiedByTaskId.delete(taskId);
                }
            }

            await sendDiscordNotification(
                process.env.DISCORD_WEBHOOK!,
                notifyLines.join("\n")
            );
        }

        console.log("End of message.");
    });
}

function authenticate(): void {
    console.log("Authenticating with API key...");

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket is not open. Skipping authentication send.");
        return;
    }

    ws.send(JSON.stringify({
        jsonrpc: "2.0",
        msg: "method",
        method: "auth.login_with_api_key",
        params: [process.env.TRUENAS_API_KEY],
        id: 1
    }));
}

function subscribeRealtimeEvents(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    ws.send(JSON.stringify({
        msg: "sub",
        id: "cloudsync-sub",
        name: "cloudsync.query"
    }));

    ws.send(JSON.stringify({
        msg: "sub",
        id: "jobs-sub",
        name: "core.get_jobs"
    }));
}

function queryCloudSyncTasks(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket is not open. Skipping cloud sync query.");
        return;
    }

    ws.send(JSON.stringify({
        jsonrpc: "2.0",
        msg: "method",
        method: "cloudsync.query",
        id: 2
    }));
}

function startChecking(): void {
    if (checkInterval) {
        return;
    }

    console.log("Starting to check for cloud sync tasks every minute...");

    // Trigger first check immediately instead of waiting one full interval.
    queryCloudSyncTasks();
    checkInterval = setInterval(queryCloudSyncTasks, CHECK_INTERVAL_MS);
}

function startKeepAlive(): void {
    if (keepAliveInterval) {
        return;
    }

    keepAliveInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }

        ws.ping();
    }, KEEPALIVE_INTERVAL_MS);
}

function cleanupTimers(): void {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }

    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

function scheduleReconnect(): void {
    if (shutdownRequested || reconnectTimeout) {
        return;
    }

    console.log(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);

    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connectWebSocket();
    }, RECONNECT_DELAY_MS);
}

function isRealtimeCloudsyncEvent(value: Record<string, unknown>): boolean {
    if (typeof value.msg !== "string") {
        return false;
    }

    if (!["added", "changed", "removed"].includes(value.msg)) {
        return false;
    }

    if (value.collection === "cloudsync.query") {
        return true;
    }

    if (value.collection !== "core.get_jobs") {
        return false;
    }

    const fields = isRecord(value.fields) ? value.fields : null;

    if (!fields || typeof fields.method !== "string") {
        return false;
    }

    return fields.method.startsWith("cloudsync.");
}

function getEnvInt(name: string, fallback: number): number {
    const value = process.env[name];

    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        console.warn(`Invalid ${name} value: ${value}. Falling back to ${fallback}.`);
        return fallback;
    }

    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
