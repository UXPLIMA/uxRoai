const { ipcMain } = require("electron");
const { getManagedAgentStatus, startManagedAgent, stopManagedAgent } = require("../agent-process.js");
const { connectSSE } = require("../sse.js");

function register() {
  ipcMain.handle("agent:status", () => {
    return getManagedAgentStatus();
  });

  ipcMain.handle("agent:start", async () => {
    const result = await startManagedAgent();
    connectSSE();
    return result;
  });

  ipcMain.handle("agent:stop", async () => {
    return stopManagedAgent();
  });
}

module.exports = { register };
