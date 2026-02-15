#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildPlugin, outputPath } from "./build-plugin.js";

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    "Usage: node apps/studio-plugin/scripts/install-plugin.js <roblox_plugins_dir>\n" +
      "Example: node apps/studio-plugin/scripts/install-plugin.js \"$LOCALAPPDATA/Roblox/Plugins\""
  );
}

function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedTargetDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedTargetDir)) {
    throw new Error(`Target directory does not exist: ${resolvedTargetDir}`);
  }

  const builtFile = buildPlugin();
  const destination = path.join(resolvedTargetDir, "uxRoai.plugin.lua");
  fs.copyFileSync(builtFile, destination);

  // eslint-disable-next-line no-console
  console.log(`[uxRoai] plugin installed: ${destination}`);
}

main();
