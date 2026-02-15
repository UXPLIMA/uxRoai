// Exploration tools that Claude can call during planning to inspect the studio context

export const EXPLORATION_TOOL_DEFINITIONS = [
  {
    name: "search_scripts",
    description: "Search all script sources in the game for a keyword or pattern. Returns matching script paths and the lines containing the match.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "The keyword or text to search for in script sources" },
        caseSensitive: { type: "boolean", description: "Whether to do case-sensitive search. Default false." },
      },
      required: ["keyword"],
    },
  },
  {
    name: "read_script_source",
    description: "Read the full source code of a specific script by its path (e.g. 'game.ServerScriptService.CoinServer').",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The full dot-separated path to the script instance" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_children",
    description: "List all direct children of an instance at a given path. Shows name, className, and child count.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The full dot-separated path (e.g. 'game.Workspace' or 'game.ServerScriptService')" },
      },
      required: ["path"],
    },
  },
];

function findNodeByPath(rootNodes, targetPath) {
  if (!Array.isArray(rootNodes) || !targetPath) return null;
  const segments = targetPath.replace(/^game\./, "").split(".");

  function search(nodes, depth) {
    if (depth >= segments.length) return null;
    for (const node of nodes) {
      const nodeName = node.Name || node.name || "";
      if (nodeName === segments[depth]) {
        if (depth === segments.length - 1) return node;
        const children = node.Children || node.children || [];
        return search(children, depth + 1);
      }
    }
    return null;
  }

  return search(rootNodes, 0);
}

function collectScripts(nodes, parentPath, results) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const name = node.Name || node.name || "";
    const className = node.ClassName || node.className || "";
    const fullPath = parentPath ? `${parentPath}.${name}` : name;
    if ((className === "Script" || className === "LocalScript" || className === "ModuleScript") && node.Source) {
      results.push({ path: `game.${fullPath}`, source: node.Source, className });
    }
    const children = node.Children || node.children || [];
    collectScripts(children, fullPath, results);
  }
}

export function executeExplorationTool(toolName, toolInput, studioContext) {
  const rootNodes = studioContext?.explorer?.rootNodes || studioContext?.rootNodes || [];

  if (toolName === "search_scripts") {
    const keyword = toolInput.keyword || "";
    if (!keyword) return JSON.stringify({ error: "keyword required" });
    const scripts = [];
    collectScripts(rootNodes, "", scripts);
    const caseSensitive = toolInput.caseSensitive === true;
    const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
    const results = [];
    for (const script of scripts) {
      const source = caseSensitive ? script.source : script.source.toLowerCase();
      if (source.includes(searchTerm)) {
        const lines = script.source.split("\n");
        const matchingLines = [];
        for (let i = 0; i < lines.length; i++) {
          const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (line.includes(searchTerm)) {
            matchingLines.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
          }
        }
        results.push({
          path: script.path,
          className: script.className,
          matchCount: matchingLines.length,
          matches: matchingLines.slice(0, 10),
        });
      }
    }
    if (results.length === 0) {
      return JSON.stringify({ found: false, message: `No scripts contain "${keyword}"` });
    }
    return JSON.stringify({ found: true, resultCount: results.length, results: results.slice(0, 20) });
  }

  if (toolName === "read_script_source") {
    const targetPath = toolInput.path || "";
    if (!targetPath) return JSON.stringify({ error: "path required" });
    const scripts = [];
    collectScripts(rootNodes, "", scripts);
    const match = scripts.find(s => s.path === targetPath);
    if (!match) {
      return JSON.stringify({ error: `Script not found at path: ${targetPath}` });
    }
    return JSON.stringify({
      path: match.path,
      className: match.className,
      lineCount: match.source.split("\n").length,
      source: match.source.slice(0, 30000),
    });
  }

  if (toolName === "list_children") {
    const targetPath = toolInput.path || "";
    if (!targetPath) return JSON.stringify({ error: "path required" });
    const node = findNodeByPath(rootNodes, targetPath);
    if (!node) {
      return JSON.stringify({ error: `Instance not found at path: ${targetPath}` });
    }
    const children = (node.Children || node.children || []).map(child => ({
      name: child.Name || child.name || "",
      className: child.ClassName || child.className || "",
      childCount: (child.Children || child.children || []).length,
    }));
    return JSON.stringify({ path: targetPath, childCount: children.length, children: children.slice(0, 100) });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
