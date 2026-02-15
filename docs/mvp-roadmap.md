# uxRoai Roadmap

## Completed

### v0.1 — MVP
- Local agent + Claude API
- Studio plugin widget
- Action apply engine (create, upsert, set_property, delete, query)
- `StudioTestService` based basic playtest
- Electron desktop app + studio queue

### v0.2 — Multi-Provider
- Claude Code CLI, Claude API, Codex CLI, OpenAI API, Gemini CLI, Gemini API (6 providers)
- Provider dispatcher with per-provider config
- Model selection per provider family

### v0.3 — Reliability
- Rewritten modular prompts (plan, playtest, ask, analyze)
- Script diff/merge strategy (edit_script, insert/delete lines)
- Roblox API documentation RAG injection
- Structured error reporting

### v0.4 — Self-Heal Loop
- Async plan API with job polling
- Auto-repair loop (AI analyzes failures, generates fix plans)
- Configurable retry count and playtest duration
- Plan preview and approval flow
- Long-polling task claim (25s)
- Batch progress reporting

### v0.5 — Desktop Experience
- Custom frameless titlebar with native window controls
- Native window effects (Mica/Acrylic/Vibrancy) with toggle
- Multi-chat threads per project with auto-titling
- Model selector in composer bar
- Message queue (queue messages while task runs)
- Working hints (tool call status labels)
- Guided setup wizard
- Enhanced keyboard shortcuts (Ctrl+T, Ctrl+Shift+S, Alt+Up/Down)
- Context menus for projects and tasks
- Modular plugin architecture (12 Lua modules)
- Safe spawn system for playtests (staging area at 0,500,0)
- LogService warning/error capture during playtests
- Configurable plan timeout (default 600s)
- Per-provider CLI timeouts
- Poll error handling (immediate break on 404/500)
- Visual diff cards with syntax highlighting
- Token usage display per task
- Image attachments (paste, drag-drop, file picker)
- Per-project persistent memory
- Folder organization with drag-drop
- Bilingual UI (English + Turkish)

## Planned

### v0.6 — Polish & Stability
- Inline diff with per-change rollback
- Message editing & conversation rewind
- Prompt stashing across chat/project switches
- Deterministic replay mode
- Regression scenario library

### v0.7 — Collaboration
- Session history export/import
- Prompt template library
- Shared project workspaces
- Team metrics (ship speed, failure rate)
