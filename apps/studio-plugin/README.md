# uxRoai Studio Plugin

Modular Roblox Studio plugin that executes AI-generated action plans and runs automated playtests. Built from 12 focused Lua modules into a single plugin file.

## What It Does

- Auto-claims tasks from the agent's task queue (long-polling, 25s wait)
- Executes 22 action types (create instances, write scripts, set properties, insert assets, etc.)
- Runs automated playtests via `StudioTestService` with 11 step types
- Auto-repairs failures using AI-driven diagnostics (configurable retry count)
- Creates `ChangeHistoryService` waypoints for Ctrl+Z undo support
- Lints Luau scripts before execution (bracket matching, block/end validation)
- Captures Explorer context (depth 6, max 4500 nodes) with progressive depth trimming
- Understands current Studio selection and open script sources
- Supports GUI button testing via BindableEvent test hooks (bypasses Roblox VIM restrictions)
- Inserts Creator Store assets via `InsertService:LoadAsset`
- Buffers and batches progress reports to minimize HTTP overhead
- Captures `LogService` warnings/errors during playtests for AI diagnostics
- Safe spawn system — players spawn at a staging area during playtests to prevent false failures
- Configurable plan timeout (default 600s, max 1200s)

## Build

```bash
cd apps/studio-plugin
node scripts/build-plugin.js
```

Output: `dist/uxRoai.plugin.lua`

The build script concatenates all source modules into a single file. **You must rebuild after editing any source file.**

## Install

### Option A: Script

```bash
node scripts/install-plugin.js "<ROBLOX_PLUGINS_DIR>"
```

### Option B: Manual

Copy `dist/uxRoai.plugin.lua` to your Roblox Plugins folder:

- **Windows**: `%LOCALAPPDATA%\Roblox\Plugins`
- **Linux (Wine)**: `<WINE_PREFIX>/drive_c/users/<USER>/AppData/Local/Roblox/Plugins`

## After Install

1. Restart Roblox Studio (or disable/enable plugin from Plugin Manager)
2. Enable **Game Settings > Security > Enable Studio Access to API Services**
3. Click **uxRoai** in the toolbar to open the panel

## Source Files

```
src/
  Main.server.lua              # Plugin entry point (HTTP comm, toolbar, task loop)
  HarnessTemplates.lua         # Server + client playtest harness scripts
  modules/
    Orchestration.lua          # Task execution & auto-repair loop
    ActionHandlers.lua         # 22 action type handlers
    Playtest.lua               # Playtest execution & StudioTestService
    ScriptWriter.lua           # Script creation, editing & linting
    Serialization.lua          # Explorer context serialization & depth trimming
    ClassInspector.lua         # Instance property discovery
    PathResolver.lua           # Game tree path resolution
    ValueDecoder.lua           # Property value encoding/decoding
    UI.lua                     # Plugin widget UI
    Constants.lua              # Shared constants
    Utils.lua                  # Utility functions
    I18N.lua                   # Plugin i18n strings (EN/TR)
scripts/
  build-plugin.js              # Multi-module build system
  install-plugin.js            # Copies built plugin to Roblox Plugins folder
```

## Action Types

| Action | Description |
|--------|-------------|
| `create_instance` | Create a new Roblox instance with properties |
| `upsert_script` | Create or replace a script |
| `edit_script` | Search-and-replace edits in existing scripts |
| `insert_script_lines` | Insert lines at a specific position |
| `delete_script_lines` | Remove lines by range |
| `set_property` | Set any instance property (supports path refs) |
| `bulk_set_properties` | Set properties on multiple instances at once |
| `set_relative_property` | Modify properties relative to current value |
| `set_attribute` | Set a custom attribute |
| `add_tag` / `remove_tag` | Manage CollectionService tags |
| `delete_instance` | Remove an instance from the game tree |
| `clone_template_to_variants` | Clone with property variations |
| `smart_duplicate` | Clone with offsets, naming patterns, cycling |
| `mass_create` | Batch creation of multiple instances |
| `insert_asset` | Insert from Creator Store via asset ID |
| `query_instances` | Search the game tree with filters |
| `get_instance_properties` | Read all properties of an instance |
| `get_class_info` | Discover supported properties of a class |
| `run_code` | Execute sandboxed Luau code |
| `run_playtest` | Run automated playtest scenario |

## Playtest Steps

| Step | Description |
|------|-------------|
| `wait_seconds` | Wait a specified duration |
| `move_to` | Walk player to a position |
| `teleport_to_target` | Teleport player to a named object |
| `touch_target` | Teleport into an object to trigger Touched events |
| `click_ui` | Click a GUI element |
| `equip_tool` | Equip a tool from backpack |
| `activate_tool` | Activate the equipped tool |
| `assert_exists` | Assert an instance exists |
| `assert_not_exists` | Assert an instance doesn't exist |
| `assert_gui_text` | Assert GUI text content |
| `capture_screenshot` | Capture a screenshot for debugging |
