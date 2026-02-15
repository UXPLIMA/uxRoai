export const DEFAULT_MODEL = "claude-sonnet-4-5";
export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_PROVIDER = "code";
export const DEFAULT_CODE_COMMAND = "claude";
export const DEFAULT_CODE_ARGS = "-p";
export const DEFAULT_CUSTOM_INSTRUCTIONS = `\
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

export const COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
export const SCRIPT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
