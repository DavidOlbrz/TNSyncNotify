const dotenv = require("dotenv");
const WebSocket = require("ws");
const utils = require("./utils.mjs");

dotenv.config();

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
    }))
});

ws.on("error", (error) => {
    console.error("WebSocket error:", error);
});

ws.on("message", (message) => {
    msg = JSON.parse(message.toString());

    console.log(msg);

    if (msg.msg === "connected") {
        console.log("Connected to TrueNAS WebSocket.");
        authenticate();
    }

    if (msg.id === 1) {
        console.log("Authentication successful.");
        startChecking();
    }

    if (msg.id === 2) {
        console.log("Received cloud sync tasks:", utils.getEnabledSyncTasks(msg.result));
        utils.sendDiscordNotification(
            process.env.DISCORD_WEBHOOK,
            utils.getEnabledSyncTasks(msg.result).map(task => `**${task.description}**: ${task.job.state} (${JSON.stringify(task.job.progress)}%)`).join("\n").toString()
        );
    }

    console.log("End of message.");
});

function authenticate() {
    console.log("Authenticating with API key...");
    
    ws.send(JSON.stringify({
        jsonrpc: "2.0",
        msg: "method",
        method: "auth.login_with_api_key",
        params: [process.env.TRUENAS_API_KEY],
        id: 1
    }));
}

function startChecking() {
    //console.log("Starting to check for cloud sync tasks every second...");
    //setInterval(() => {
        ws.send(JSON.stringify({
            jsonrpc: "2.0",
            msg: "method",
            method: "cloudsync.query",
            id: 2
        }))
    //},
    //1000
    //);
}