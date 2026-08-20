import { startServer } from "./server";

const port = Number(process.env.TNR_DEV_CLIENT_PORT ?? 49200);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("TNR_DEV_CLIENT_PORT must be an integer between 1 and 65535");
  process.exit(1);
}

const server = startServer(port, (line) => console.log(`[sidecar] ${line}`));

// The Tauri host watches stdout for this line before opening the UI.
console.log(`TNR_DEV_CLIENT_READY port=${server.port}`);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("TNR_DEV_CLIENT_SHUTDOWN");
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
