import { safeString, clampNumber } from "./helpers.js";

export function normalizePlaytest(raw) {
  if (typeof raw?.serverTest === "string" && raw.serverTest.trim()) {
    return {
      version: 2,
      goal: safeString(raw?.goal, "Generated playtest"),
      timeoutSeconds: clampNumber(raw?.timeoutSeconds, 10, 600, 120),
      serverTest: raw.serverTest.trim(),
      clientTest: typeof raw?.clientTest === "string" && raw.clientTest.trim() ? raw.clientTest.trim() : null,
    };
  }

  // Fallback: no serverTest provided — return a minimal V2 playtest
  return {
    version: 2,
    goal: safeString(raw?.goal, "Generated playtest"),
    timeoutSeconds: clampNumber(raw?.timeoutSeconds, 10, 600, 120),
    serverTest: 'task.wait(3)\nassert_exists("game.Workspace", "Workspace exists")',
    clientTest: null,
  };
}
