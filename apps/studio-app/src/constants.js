const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".js", ".lua", ".json", ".csv", ".log"]);

const SUPPORTED_CLAUDE_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
];

const SUPPORTED_CODEX_MODELS = [
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5-codex",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
];

const SUPPORTED_GEMINI_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const SUPPORTED_CLAUDE_PROVIDERS = ["code", "api", "codex", "openai-api", "gemini", "gemini-api"];
const SUPPORTED_LANGUAGES = ["en", "tr"];

const DEFAULT_AGENT_URL = "http://127.0.0.1:41117";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_CLAUDE_PROVIDER = "code";
const DEFAULT_CLAUDE_CODE_COMMAND = "claude";
const DEFAULT_CLAUDE_CODE_ARGS = "-p";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
const DEFAULT_CODEX_COMMAND = "codex";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_GEMINI_COMMAND = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-3-pro-preview";

const DEFAULT_CUSTOM_INSTRUCTIONS = `\
- Use task library (task.wait, task.spawn, task.delay, task.defer). Never deprecated wait()/spawn()/delay().
- Use game:GetService("ServiceName"), never game.ServiceName.
- Modern constraints (LinearVelocity, AlignPosition), not deprecated BodyVelocity/BodyForce.
- Scale positioning for GUIs (responsive). Offset only for pixel padding.
- Add UICorner to Frame/TextButton. TextScaled=true with UITextSizeConstraint.
- ScreenGui: ResetOnSpawn=false, ZIndexBehavior=Sibling. GUI LocalScripts inside their ScreenGui.
- Server authority: all state changes on server. Client fires RemoteEvent, server validates.
- Debounce Touched events with per-player cooldown tables.
- Cache services at script top. Always use "local" for variables.
- Server scripts in ServerScriptService, shared modules in ReplicatedStorage.
- RemoteEvents in ReplicatedStorage.
- CollectionService tags + sweep+doorbell pattern for tag-based systems.
- Leaderboard: "leaderstats" Folder with IntValue children in PlayerAdded.
- Clean up connections on Destroying. Use Debris:AddItem for temp objects.
- Instance.new second arg is deprecated. Set .Parent after configuring properties.
- math.random(m,n) args must be integers. For floats: math.random() * (max-min) + min.
- Static environment parts MUST be Anchored=true.`;

module.exports = {
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  SUPPORTED_CLAUDE_MODELS,
  SUPPORTED_CODEX_MODELS,
  SUPPORTED_GEMINI_MODELS,
  SUPPORTED_CLAUDE_PROVIDERS,
  SUPPORTED_LANGUAGES,
  DEFAULT_AGENT_URL,
  DEFAULT_LANGUAGE,
  DEFAULT_CLAUDE_PROVIDER,
  DEFAULT_CLAUDE_CODE_COMMAND,
  DEFAULT_CLAUDE_CODE_ARGS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_COMMAND,
  DEFAULT_CODEX_MODEL,
  DEFAULT_GEMINI_COMMAND,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CUSTOM_INSTRUCTIONS,
};
