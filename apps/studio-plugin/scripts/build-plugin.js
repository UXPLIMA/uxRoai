#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(pluginRoot, "src");
const modulesDir = path.join(sourceDir, "modules");
const distDir = path.join(pluginRoot, "dist");

const mainPath = path.join(sourceDir, "Main.server.lua");
const harnessPath = path.join(sourceDir, "HarnessTemplates.lua");
export const outputPath = path.join(distDir, "uxRoai.plugin.lua");

// Fixed dependency order — each module can only reference modules above it.
// UI must come before ClassInspector/ScriptWriter/ActionHandlers/Playtest
// because those modules call UI.appendLog and UI.recordWaypoint.
// HarnessTemplates is injected after all modules but before Playtest references it.
const MODULE_ORDER = [
  "Constants",
  "I18N",
  "Utils",
  "PathResolver",
  "ValueDecoder",
  "Serialization",
  "UI",
  "ClassInspector",
  "ScriptWriter",
  "ActionHandlers",
  "Playtest",
  "Orchestration",
];

function mustRead(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function buildModuleBlock(moduleName, source) {
  return `local ${moduleName} = (function()\n${source}\nend)()\n`;
}

function buildPluginSource(mainSource, harnessSource) {
  // Build module blocks
  const moduleBlocks = [];

  for (const name of MODULE_ORDER) {
    // Inject HarnessTemplates before Playtest (Playtest references HarnessTemplates)
    if (name === "Playtest" && fs.existsSync(harnessPath)) {
      moduleBlocks.push(buildModuleBlock("HarnessTemplates", harnessSource));
    }
    const filePath = path.join(modulesDir, `${name}.lua`);
    if (!fs.existsSync(filePath)) {
      continue; // Module not yet extracted — skip
    }
    const source = fs.readFileSync(filePath, "utf8");
    moduleBlocks.push(buildModuleBlock(name, source));
  }

  const modulesCode = moduleBlocks.join("\n");

  // Replace --[[UXROAI_MODULES]] marker if present
  let output = mainSource;
  const modulesMarker = /--\[\[UXROAI_MODULES\]\]\s*/;
  if (modulesMarker.test(output)) {
    output = output.replace(modulesMarker, modulesCode + "\n");
  }

  // Replace legacy HarnessTemplates require line if still present
  const requireLine = /local HarnessTemplates = require\(script:WaitForChild\("HarnessTemplates"\)\)\s*/;
  if (requireLine.test(output)) {
    // If modules marker was not found, embed HarnessTemplates at the require line
    if (!modulesMarker.test(mainSource)) {
      const embeddedHarness = buildModuleBlock("HarnessTemplates", harnessSource);
      output = output.replace(requireLine, embeddedHarness);
    } else {
      // Modules marker handled it; just remove the require line
      output = output.replace(requireLine, "");
    }
  }

  const banner =
    "-- Generated file. Do not edit directly.\n" +
    "-- Source: apps/studio-plugin/src/Main.server.lua + modules\n\n";

  return banner + output;
}

export function buildPlugin() {
  const mainSource = mustRead(mainPath);
  const harnessSource = fs.existsSync(harnessPath) ? mustRead(harnessPath) : "";
  const pluginSource = buildPluginSource(mainSource, harnessSource);

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(outputPath, pluginSource, "utf8");

  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildPlugin();
  // eslint-disable-next-line no-console
  console.log(`[uxRoai] plugin built: ${built}`);
}
