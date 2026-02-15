import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DOCS = JSON.parse(readFileSync(join(__dirname, "roblox-api-docs.json"), "utf-8"));

/**
 * Find relevant Roblox API docs based on prompt keywords.
 * Returns a string to inject into the user prompt.
 */
export function findRelevantDocs(prompt, maxDocs = 5) {
  if (!prompt || typeof prompt !== "string") return "";

  const lower = prompt.toLowerCase();
  const scored = [];

  for (const entry of API_DOCS) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        score += kw.length;
      }
    }
    if (score > 0) {
      scored.push({ doc: entry.doc, score });
    }
  }

  if (scored.length === 0) return "";

  scored.sort((a, b) => b.score - a.score);
  const topDocs = scored.slice(0, maxDocs).map((s) => s.doc);

  return [
    "",
    "=== RELEVANT ROBLOX API REFERENCE ===",
    ...topDocs,
    "=== END API REFERENCE ===",
    "",
  ].join("\n");
}
