# Workflow Engine

A visual workflow automation engine built in TypeScript — drag-and-drop step builder, background job queue with Redis + BullMQ, and AI step execution via the Anthropic API. Inspired by tools like n8n.

## Features

- **Visual builder** — drag step types onto a canvas, connect them with arrows, configure each step in a properties panel
- **Data-driven workflows** — workflows are JSON definitions stored in SQLite; no code changes needed to create new pipelines
- **Background job queue** — BullMQ + Redis processes steps asynchronously with concurrency and automatic retries
- **Two built-in step types**:
  - `ai_prompt` — calls Claude with a configurable prompt and `{{variable}}` interpolation
  - `http_request` — fetches data from any URL and passes the response to the next step
- **`{{variable}}` interpolation** — each step can reference the output of any previous step by its ID
- **Live output** — run status and step outputs stream into the UI automatically

## Architecture

```
Browser (drag-and-drop builder)
        │
        │ HTTP
        ▼
  Express Server  ──── SQLite (workflow definitions)
        │
        │ enqueue job
        ▼
      Redis
        │
        │ dequeue job
        ▼
     Worker(s)  ──── Anthropic API / HTTP
```

The server and worker are separate processes. Redis is the only thing they share — the server enqueues a job for each workflow step, and the worker picks it up, executes it, then enqueues the next step. Multiple workers can run in parallel.

## Quick Start (Docker)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd JobQueue
npm install

# 2. Set your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 3. Start everything
docker-compose up
```

Open `http://localhost:3000`.

## Manual Setup

```bash
# Start Redis
docker run -d -p 6379:6379 redis:alpine

# Terminal 1 — HTTP server
npm run server

# Terminal 2 — worker
npm run worker
```

## Building a Workflow

1. **Drag** step types from the left panel onto the canvas
2. **Connect** steps by clicking the blue port circle on a node's right side, then clicking the target node
3. **Configure** each step by clicking its body — edit the ID and config fields in the properties panel
4. **Add inputs** in the bottom-centre panel (e.g. `topic: black holes`)
5. **Run** — the workflow saves automatically and results stream in at the bottom right

### Example: AI Research Pipeline

Build three connected steps:

| Step ID  | Type       | Config |
|----------|------------|--------|
| research | ai_prompt  | `prompt`: `List 5 key facts about: {{topic}}` |
| draft    | ai_prompt  | `prompt`: `Write a report about {{topic}} using:\n{{research}}` |
| review   | ai_prompt  | `prompt`: `Polish this report:\n{{draft}}` |

Each step's output is available to later steps via `{{stepId}}`.

### Example: Fetch + Summarise

| Step ID | Type         | Config |
|---------|--------------|--------|
| fetch   | http_request | `url`: `https://api.chucknorris.io/jokes/random`, `method`: `GET` |
| story   | ai_prompt    | `prompt`: `Write a short story inspired by this joke JSON:\n{{fetch}}` |

No inputs needed — just hit Run.

## Project Structure

```
src/
├── types.ts      — WorkflowDefinition, Step, StepJobData interfaces
├── db.ts         — SQLite storage for workflow definitions
├── queue.ts      — BullMQ Queue instance (shared by server and worker)
├── executor.ts   — executes a single step by type + {{interpolation}}
├── worker.ts     — generic BullMQ worker (reads definition, runs step, enqueues next)
└── server.ts     — Express HTTP API + static file serving
public/
└── index.html    — drag-and-drop workflow builder UI (vanilla JS)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/definitions` | Save a workflow definition |
| `GET`  | `/definitions` | List all definitions |
| `GET`  | `/definitions/:id` | Get a definition by ID |
| `POST` | `/runs` | Start a workflow run `{ definitionId, input }` |
| `GET`  | `/runs/:id` | Get run status and step outputs |

## Tech Stack

- **TypeScript** — strict mode, NodeNext modules
- **Express** — HTTP API and static file serving
- **BullMQ** — job queue with concurrency, retries, and job lifecycle tracking
- **Redis** — backing store for the job queue
- **SQLite** — persistent storage for workflow definitions
- **Anthropic SDK** — Claude API for `ai_prompt` steps
- **Docker** — Redis container, full `docker-compose` setup