# uxRoai Architecture

## Components

### 1. Desktop App (Electron)

The user-facing application for managing prompts, reviewing plans, and monitoring task execution.

- Custom frameless titlebar with native window controls
- Native transparency effects (Mica/Acrylic on Windows, Vibrancy on macOS)
- Multi-chat threads per project with auto-titling
- SSE-based real-time progress with tool call status hints
- Visual diff cards for property and script changes
- Message queue for sequential task processing
- Model selector in composer bar
- Image attachments (paste, drag-drop, file picker)
- Per-project persistent memory
- Guided setup wizard for first-time users
- Bilingual UI (English + Turkish)

### 2. Agent (Node.js)

HTTP service on `127.0.0.1:41117` that orchestrates AI calls and manages the task queue.

- 6 AI providers: Claude CLI/API, Codex CLI, OpenAI API, Gemini CLI/API
- Async job system for non-blocking AI calls with polling
- Roblox API documentation RAG injection for accurate code generation
- Plan normalization and validation (22 action types)
- Playtest scenario generation with specialized prompts
- Long-polling task claim (25s wait) to reduce plugin overhead
- Batch progress reporting
- SSE event stream for Desktop App
- MCP stdio mode for IDE integration (Cursor, Claude Code, VS Code)

### 3. Studio Plugin (Luau)

Single-file Roblox Studio plugin built from 12 focused modules.

- Task execution with 22 action handlers
- Automated playtesting via `StudioTestService`
- Auto-repair loop: AI analyzes failures and retries with fixes
- Explorer context serialization (depth 6, max 4500 nodes, progressive trimming)
- Selection-aware context (selected objects + open script sources)
- Luau linting before script execution
- GUI button testing via BindableEvent hooks
- Creator Store asset insertion
- ChangeHistoryService waypoints for Ctrl+Z undo
- Safe spawn system (staging area during playtests)
- LogService warning/error capture for diagnostics

### 4. Playtest Harness (Luau scripts)

Server + client scripts injected into `StudioTestService` for automated testing.

- 11 step types: wait, move, teleport, touch, click UI, equip/activate tool, assertions
- Safe SpawnLocation system — players spawn at (0, 500, 0) to prevent false Touched events
- BindableEvent-based GUI click testing (bypasses Roblox VIM restrictions)
- Runtime warning capture via LogService.MessageOut
- Configurable minimum playtest duration

## Data Flow

```
 Desktop App (Electron)          Agent (Node.js :41117)          Studio Plugin (Luau)
 ========================       ========================       ========================
 |  Multi-Chat UI        | ---> |  POST /v1/studio/tasks | ---> |  Auto-claim from queue |
 |  Plan Preview         |      |  AI Planning (async)   |      |  Execute actions       |
 |  Task History         | <--- |  SSE /v1/events        | <--- |  Run playtests         |
 |  Settings Panel       |      |  Playtest Generation   |      |  Report results        |
 |  Live Progress        |      |  Token Usage Tracking  |      |  Auto-repair loop      |
 ========================       ========================       ========================
```

1. User enters a prompt in the Desktop App (with optional image attachments)
2. Plugin captures an Explorer snapshot (depth 6, max 4500 nodes) as context
3. Agent sends prompt + context + conversation history + custom instructions to the AI provider
4. AI returns a JSON action plan; agent normalizes and validates it
5. Plan is shown for user approval (approve / edit / reject)
6. Plugin executes approved actions on the game tree
7. If playtesting is requested, harness scripts are injected and `StudioTestService` runs
8. Results flow back through the agent to the Desktop App in real time via SSE
9. On failure, AI analyzes issues and generates a repair plan (up to N retries)

## API Endpoints

### Planning
- `POST /v1/plan` — Generate action plan (async job)
- `GET /v1/jobs/:id` — Poll job status
- `POST /v1/playtests` — Generate playtest scenario
- `POST /v1/ask` — Text-only question (no actions)

### Task Queue
- `POST /v1/studio/tasks` — Create task
- `GET /v1/studio/tasks` — List tasks
- `POST /v1/studio/tasks/claim` — Claim next pending (long-poll 25s)
- `GET /v1/studio/tasks/:id` — Get task
- `POST /v1/studio/tasks/:id/stop` — Stop task
- `POST /v1/studio/tasks/:id/progress` — Report progress (batch)
- `POST /v1/studio/tasks/:id/result` — Complete task

### Plan Approval
- `POST /v1/studio/tasks/:id/submit-plan` — Submit for approval
- `POST /v1/studio/tasks/:id/approve` — User decision
- `POST /v1/studio/tasks/:id/await-approval` — Long-poll for decision

### Real-Time
- `GET /v1/events` — SSE stream
- `GET /health` — Status & provider info

## Action Types (22)

`create_instance`, `upsert_script`, `edit_script`, `insert_script_lines`, `delete_script_lines`, `set_property`, `bulk_set_properties`, `set_relative_property`, `set_attribute`, `add_tag`, `remove_tag`, `delete_instance`, `clone_template_to_variants`, `smart_duplicate`, `mass_create`, `insert_asset`, `query_instances`, `get_instance_properties`, `get_class_info`, `run_code`, `ensure_playtest_harness`, `run_playtest`

## Playtest Steps (11)

`wait_seconds`, `move_to`, `teleport_to_target`, `touch_target`, `click_ui`, `equip_tool`, `activate_tool`, `assert_exists`, `assert_not_exists`, `assert_gui_text`, `capture_screenshot`

## Security

- Agent runs on localhost only by default
- Plugin only executes supported action types (no arbitrary code except sandboxed `run_code`)
- API keys stored in user's Electron config directory, never sent to the plugin
- No external network calls from the plugin (only `127.0.0.1:41117`)
