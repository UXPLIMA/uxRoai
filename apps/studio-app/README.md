# uxRoai Studio App

Electron desktop interface for the uxRoai AI copilot.

## What It Does

- **Custom Frameless Titlebar** with native window controls and drag support
- **Native Window Effects** — Mica/Acrylic (Windows), Vibrancy (macOS) with transparency toggle
- **Multi-Chat Threads** — Multiple conversations per project with auto-titling
- **Real-Time Progress** — SSE-based live updates with tool call status hints
- **Visual Diff Cards** — Property before/after, script diffs with syntax highlighting
- **Token Usage Display** — Per-task input/output token count with hover detail
- **Quick Actions** — Retry with Fix, Undo (Ctrl+Z waypoint), Branch from any task
- **Message Queue** — Queue messages while a task is running
- **Model Selector** — Switch AI models from the composer bar
- **Question Mode** — `/ask` prefix for text-only AI answers without executing actions
- **Image Attachments** — Paste, drag-drop, or pick images to include with prompts
- **Persistent Memory** — Per-project memory that carries context across sessions
- **Folder Organization** — Group projects into folders via drag-drop
- **Guided Setup Wizard** — First-time setup flow for new users
- **Context Menus** — Right-click projects and tasks for quick actions
- **Bilingual** — English and Turkish UI support

## Requirements

- Node.js 20+ (22+ recommended)
- One of the supported AI providers configured (see below)

## Run

```bash
cd apps/studio-app
npm install
npm start
```

## Configuration

Open Settings (`Ctrl+Shift+S`) in the app and configure:

### AI Provider

Select from the dropdown:

| Provider | Config Key | What You Need |
|----------|-----------|---------------|
| Claude Code (subscription) | `code` | `claude` CLI installed + authenticated |
| Claude API Key | `api` | Anthropic API key |
| Codex CLI | `codex` | `codex` CLI installed + authenticated |
| OpenAI API Key | `openai-api` | OpenAI API key |
| Gemini CLI | `gemini` | `gemini` CLI installed |
| Gemini API Key | `gemini-api` | Google AI API key |

The settings UI shows only the relevant fields for your selected provider family (Claude / Codex / Gemini).

### Models

Each provider family has its own model dropdown:

**Claude:** claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5

**Codex/OpenAI:** gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex, gpt-5-codex, gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-4.1

**Gemini:** gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite

### Other Settings

- **Agent URL**: Default `http://127.0.0.1:41117`
- **Max Retries**: Auto-repair retry count (default 10)
- **Min Playtest Duration**: Minimum playtest seconds (default 10)
- **Plan Timeout**: AI plan generation timeout in seconds (default 600, max 1200)
- **CLI Timeouts**: Per-provider CLI timeout (Claude Code 90s, Codex 180s, Gemini 300s)
- **Language**: English or Turkish
- **Transparency**: Enable/disable native window transparency effects
- **Custom Instructions**: Per-project instructions injected into AI prompts

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send prompt (textarea focused) |
| `Ctrl+Enter` | Send prompt (global) |
| `Shift+Enter` | New line in prompt |
| `Ctrl+N` | New project |
| `Ctrl+T` | New chat |
| `Ctrl+.` | Stop running task |
| `Ctrl+Shift+S` | Open settings |
| `Alt+Up/Down` | Switch chat/project |
| `Escape` | Close modal |

## Quick Actions

On completed/failed tasks:

- **Retry with Fix** — Pre-fills composer with error context for a retry
- **Undo** — Sends undo command to Studio (reverts via ChangeHistoryService)
- **Branch** — Creates a new project forked from this task's conversation

## Source Files

```
main.js                      # Main process (window, IPC registration)
preload.js                   # IPC bridge (renderer <-> main)
src/
  config.js                  # Configuration management (read/write/normalize)
  constants.js               # Shared constants (models, providers, defaults)
  agent-process.js           # Agent subprocess lifecycle
  window-effects.js          # Native transparency effects (Mica/Acrylic/Vibrancy)
  sse.js                     # SSE client for agent events
  ipc/
    register.js              # IPC handler registration
    config-handlers.js       # Config get/set handlers
    task-handlers.js         # Task creation & management
    project-handlers.js      # Project CRUD, folders, chats
    history-handlers.js      # Task & chat history persistence
    image-handlers.js        # Image attachment handling
    agent-handlers.js        # Agent start/stop/status
renderer/
  index.html                 # Main UI structure
  styles.css                 # All CSS styles
  renderer.js                # Entry point
  modules/
    state.js                 # Central state & DOM refs
    polling.js               # SSE events, config, settings
    composer.js              # Message input, queue & attachments
    task-rendering.js        # Task card rendering
    projects-ui.js           # Sidebar projects, chats & folders
    changes-ui.js            # Diff card rendering
    playtest-ui.js           # Playtest result rendering
    config-ui.js             # Settings panel i18n
    setup-flow.js            # First-time setup wizard
    i18n.js                  # EN + TR translations
    tool-hints.js            # Action type labels for progress
    context-menu.js          # Right-click menus
    toast.js                 # Toast notifications
    agent-ui.js              # Agent status UI
    constants.js             # Renderer-side constants
    utils.js                 # Formatting helpers
```

## Platform

- **Windows**: Full support (Mica/Acrylic transparency)
- **macOS**: Supported (Vibrancy transparency)
- **Linux**: Supported (CSS blur fallback for transparency)
