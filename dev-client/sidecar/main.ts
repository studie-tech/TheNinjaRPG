import { startServer } from "./server";

const port = Number(process.env.TNR_DEV_CLIENT_PORT ?? 49200);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("TNR_DEV_CLIENT_PORT must be an integer between 1 and 65535");
  process.exit(1);
}

const server = startServer(port, (line) => console.log(`[sidecar] ${line}`));

// The Tauri host watches stdout for this line before opening the UI.
console.log(`TNR_DEV_CLIENT_READY port=${server.port}`);

// Bound how long we wait for a wedged agent, so shutdown can never hang the
// desktop app; the Tauri host escalates to SIGKILL on the process group after
// its own grace period regardless.
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("TNR_DEV_CLIENT_SHUTDOWN");
  try {
    await Promise.race([
      server.stop(),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
  } catch {
    // Shutdown is best-effort; exit regardless.
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
