# uxRoai Agent

Node.js HTTP service that bridges AI providers with the Roblox Studio plugin. Receives prompts and game context, calls AI to generate action plans and playtest scenarios, returns validated JSON.

## Run

```bash
cd apps/agent
npm start
```

Listens on `http://127.0.0.1:41117` by default. No external npm dependencies.

Alternatively, use MCP mode for integration with Cursor, Claude Code, or VS Code:

```bash
npm run mcp
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `41117` | HTTP server port |
| `CLAUDE_PROVIDER` | `code` | AI provider: `code`, `api`, `codex`, `openai-api`, `gemini`, `gemini-api` |
| `CLAUDE_CODE_COMMAND` | `claude` | Path to Claude CLI |
| `CLAUDE_CODE_ARGS` | `-p` | CLI arguments |
| `CLAUDE_CODE_TIMEOUT_MS` | `90000` | CLI timeout in ms |
| `CLAUDE_API_KEY` | | Anthropic API key (for `api` provider) |
| `CLAUDE_MODEL` | `claude-sonnet-4-5` | Claude model |
| `CODEX_COMMAND` | `codex` | Path to Codex CLI |
| `CODEX_MODEL` | `gpt-5.3-codex` | Codex/OpenAI model |
| `OPENAI_API_KEY` | | OpenAI API key (for `openai-api` provider) |
| `GEMINI_COMMAND` | `gemini` | Path to Gemini CLI |
| `GEMINI_MODEL` | `gemini-3-pro-preview` | Gemini model |
| `GEMINI_API_KEY` | | Google AI API key (for `gemini-api` provider) |

## API Endpoints

### Health
- `GET /health` - Status, provider info, configuration check

### Planning
- `POST /v1/plan` - Generate action plan from prompt + Studio context (async job)
- `POST /v1/playtests` - Generate playtest scenario from goal
- `POST /v1/ask` - Text-only question answering (no actions)

### Async Jobs
- `GET /v1/jobs/:id` - Poll job status (pending/done/error)

### Task Queue
- `POST /v1/studio/tasks` - Create a new task
- `GET /v1/studio/tasks` - List tasks
- `POST /v1/studio/tasks/claim` - Claim next pending task (supports long-polling)
- `GET /v1/studio/tasks/:id` - Get single task
- `POST /v1/studio/tasks/:id/stop` - Stop a task
- `POST /v1/studio/tasks/:id/progress` - Report progress (supports batch)
- `POST /v1/studio/tasks/:id/result` - Complete a task with result
- `GET /v1/studio/tasks/version` - Monotonic version counter for change detection

### Plan Approval
- `POST /v1/studio/tasks/:id/submit-plan` - Submit plan for user approval
- `POST /v1/studio/tasks/:id/approve` - Approve or reject a plan
- `POST /v1/studio/tasks/:id/await-approval` - Long-poll for approval decision

### Real-Time
- `GET /v1/events` - SSE stream for task events (created, claimed, completed, progress)

## Source Files

```
src/
  server.js                  # HTTP server, request routing
  ai.js                      # Core AI call orchestration (plan, playtest, ask, analyze)
  jobs.js                    # Async job queue for non-blocking AI calls
  task-queue.js              # In-memory task queue with SSE event system
  utils.js                   # JSON parsing, HTTP helpers
  mcp-server.js              # MCP stdio server (JSON-RPC 2.0)
  providers/
    dispatcher.js            # Provider selection & routing
    base.js                  # Shared provider utilities
    claude-code.js           # Claude CLI provider
    claude-api.js            # Claude HTTP API provider
    codex-cli.js             # Codex CLI provider
    openai-api.js            # OpenAI HTTP API provider
    gemini-cli.js            # Gemini CLI provider
    gemini-api.js            # Gemini HTTP API provider
    usage.js                 # Token usage tracking
  prompts/
    plan-prompt.js           # Plan generation system prompt
    playtest-prompt.js       # Playtest scenario system prompt
    ask-prompt.js            # Question mode system prompt
    analyze-prompt.js        # Failure analysis system prompt
    custom-instructions.js   # Per-project custom instruction injection
  routes/
    plan.js                  # /v1/plan endpoints
    tasks.js                 # /v1/studio/tasks endpoints
    approval.js              # Plan approval endpoints
    events.js                # SSE /v1/events stream
    playtest.js              # /v1/playtests endpoint
    ask.js                   # /v1/ask endpoint
    health.js                # /health endpoint
  schemas/
    normalize-plan.js        # Plan normalization & defaults
    normalize-action.js      # Per-action type normalization
    normalize-playtest.js    # Playtest scenario normalization
    validators.js            # Request validation (timeout, retries, etc.)
    helpers.js               # Shared schema utilities
  data/
    roblox-api-index.js      # Roblox API snippets for RAG injection
```
