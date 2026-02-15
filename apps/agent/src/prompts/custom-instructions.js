export const DEFAULT_CUSTOM_INSTRUCTIONS = `\
LUAU FUNDAMENTALS:
- Use task library (task.wait, task.spawn, task.delay, task.defer). NEVER deprecated wait()/spawn()/delay().
- Use game:GetService("ServiceName"), NEVER game.ServiceName direct indexing.
- Cache services at top of script: local Players = game:GetService("Players")
- Always use "local" for variables. No globals.
- Instance.new second arg is DEPRECATED. Create instance, set all properties, THEN set .Parent last.
- math.random(m,n) args must be integers. For floats: math.random() * (max - min) + min.
- String patterns: use string.find(s, pattern, 1, true) for plain text search.
- Type annotations: use Luau type syntax for function signatures where helpful.

ARCHITECTURE:
- Server authority: ALL game state changes happen on server. Client fires RemoteEvent, server validates and applies.
- Server scripts in ServerScriptService. Client scripts in StarterPlayerScripts or inside their ScreenGui.
- Shared modules in ReplicatedStorage. Server-only modules in ServerScriptService.
- RemoteEvents and RemoteFunctions in ReplicatedStorage (or a "Remotes" folder inside it).
- CollectionService tags + sweep+doorbell pattern for tag-based systems.
- Clean up connections on instance.Destroying. Use Debris:AddItem for temporary objects.
- Debounce Touched events with per-player cooldown tables (never per-part booleans).

GUI DEVELOPMENT:
- ScreenGui: ResetOnSpawn=false, ZIndexBehavior=Sibling, IgnoreGuiInset=true for fullscreen overlays.
- Scale positioning (UDim2.fromScale) for responsive layouts. Offset only for pixel padding.
- Add UICorner (8px) to Frame and TextButton. Use UIStroke for borders.
- TextScaled=true with UITextSizeConstraint (MinTextSize=12, MaxTextSize=reasonable).
- GUI LocalScripts go INSIDE their ScreenGui (so they only run when the GUI exists).
- Use UIListLayout/UIGridLayout for dynamic lists. Set AutomaticSize on parent Frame.
- Tween GUI animations with TweenService (not loops). Use EasingStyle.Quint for smooth feel.

PHYSICS & MOVEMENT:
- Modern constraints: LinearVelocity, AlignPosition, AlignOrientation. NOT deprecated BodyVelocity/BodyForce.
- Static environment parts MUST be Anchored=true.
- Use workspace:Raycast() with RaycastParams (not deprecated Ray).
- Collision groups via PhysicsService for player-specific collision filtering.

COMMON PATTERNS:
- Leaderboard: "leaderstats" Folder with IntValue/NumberValue children, created in Players.PlayerAdded.
- Data persistence: DataStoreService with pcall wrapping, session locking, auto-save on PlayerRemoving + BindToClose.
- NPC dialogue/shops: ProximityPrompt for interaction trigger, RemoteEvent for purchases, server validates currency.
- Inventory: table on server, replicate via RemoteEvent or Attributes. Never trust client inventory state.

TEST HOOKS (CRITICAL FOR AUTOMATED TESTING):
- Every LocalScript with button handlers MUST register BindableEvent test hooks.
- Create hooks in ReplicatedStorage.UxRoaI.TestHooks folder.
- hook.Name = full GUI path including intermediate frames (e.g. "ShopHUD.ShopFrame.BuyButton").
- Extract button handlers into named local functions, then connect both the button AND the test hook to the same function.`;
