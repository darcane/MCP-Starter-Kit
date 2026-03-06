# MCP TypeScript Starter Kit

A minimal, production-sane [Model Context Protocol](https://modelcontextprotocol.io) server in TypeScript that supports **both stdio and Streamable HTTP** transports out of the box.

Clone it, rename it, extend it.

---

## Why both stdio and Streamable HTTP?

- **stdio is the universal local transport.** Every MCP client (Claude Desktop, Cursor, VS Code, custom scripts) can spawn your server as a subprocess and talk over stdin/stdout with zero network configuration.
- **Docker MCP Toolkit / Gateway speaks stdio.** The Docker Gateway runs containerised MCP servers via `docker run -i`, making stdio the natural integration point for Docker-native deployments.
- **Streamable HTTP is the recommended remote transport.** For servers hosted in the cloud, behind a reverse proxy, or accessed by multiple concurrent clients, Streamable HTTP is the current MCP-spec-recommended approach (superseding the older SSE-only transport).
- **One codebase, one Docker image, two modes.** The same build artefact handles both transports; you pick the mode at runtime via the `MCP_MODE` environment variable.
- **Future-proof.** Starting with both transports means you can serve local tooling today and scale to a hosted service tomorrow without rewriting transport code.

---

## What's included

| Category | Name | Description |
|----------|------|-------------|
| Tool | `ping` | Returns `"pong"` or `"pong: <message>"` |
| Tool | `echo` | Echoes back the provided text |
| Tool | `add` | Returns the sum of two numbers |
| Resource | `health://status` | Plain-text `"ok"` status |
| Resource | `config://public` | JSON blob with non-secret server config |
| Resource | `hello://{name}` | Dynamic resource – returns `"Hello, <name>!"` |
| Prompt | `review-code` | Produces a code-review prompt for a model |

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20 or later |
| npm | 10 or later (ships with Node 20) |
| Docker | 24+ (optional, for container usage) |
| Docker Desktop with MCP Toolkit | 4.62+ (optional, for gateway usage) |

---

## Quick start – local development

### 1. Install dependencies

```bash
npm install
```

### 2. Run in stdio mode (default)

```bash
npm run dev
```

The server starts and waits on stdin. You will not see any output in the terminal because stdout is reserved for the MCP protocol. Diagnostics are written to stderr.

To verify it is alive, pipe a raw JSON-RPC initialize message:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}' | npm run dev
```

### 3. Run in Streamable HTTP mode

```bash
npm run dev:http
```

The server starts on `http://localhost:3000`.

Verify the health endpoint:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Send an MCP initialize request:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-test","version":"0.0.1"}}}' \
  -D -
```

The response headers will include `Mcp-Session-Id: <uuid>`. Use that value in all subsequent requests:

```bash
SESSION_ID="<uuid-from-above>"

# Call the ping tool
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{"message":"hello"}}}'
```

#### With Bearer token auth

Set `MCP_AUTH_TOKEN` before starting the server:

```bash
MCP_AUTH_TOKEN=secret123 npm run dev:http
```

All `/mcp` requests must now include the header:

```
Authorization: Bearer secret123
```

---

## Build and run compiled output

```bash
npm run build          # compiles TypeScript → dist/

npm start              # stdio mode
npm run start:http     # HTTP mode  (sets MCP_MODE=http)
```

---

## Testing with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the official interactive testing tool.

### stdio mode

```bash
# Build first (Inspector spawns the compiled server)
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

Or use the shortcut:

```bash
npm run inspect
```

### HTTP mode

Start the HTTP server in one terminal:

```bash
npm run dev:http
```

Then launch the Inspector pointing at it:

```bash
npx @modelcontextprotocol/inspector --transport streamablehttp --url http://localhost:3000/mcp
```

Or:

```bash
npm run inspect:http
```

Open the Inspector UI in your browser (default: `http://localhost:5173`), explore tools, call resources, and render prompts interactively.

---

## Docker

### Build the image

```bash
docker build -t mcp-starter-kit .
```

The multi-stage build:
1. **Builder stage** – installs all deps (including dev tools) and runs `tsc`.
2. **Runtime stage** – installs production deps only; the `dist/` folder is copied in. Final image is a slim `node:20-alpine`.

### Run in stdio mode

```bash
docker run -i --rm mcp-starter-kit
```

> **`-i` is required.** Without it Docker closes stdin immediately and the server exits.

### Run in HTTP mode

```bash
docker run --rm -p 3000:3000 -e MCP_MODE=http mcp-starter-kit
```

With auth:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_MODE=http \
  -e MCP_AUTH_TOKEN=secret123 \
  mcp-starter-kit
```

### Docker health check

In HTTP mode the `/health` endpoint is suitable for a `HEALTHCHECK` instruction:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

---

## Docker MCP Toolkit / Gateway

Docker MCP Toolkit (available in Docker Desktop 4.62+) lets you manage a collection of MCP servers as a _profile_ and expose them all through a single `docker mcp gateway` process that clients talk to over stdio.

### Step 1 – Build the image

```bash
docker build -t mcp-starter-kit:latest .
```

### Step 2 – Create a profile (if you don't have one)

```bash
docker mcp profile create --name my-profile
```

### Step 3 – Add the server to the profile

**From the local `server.yaml` file** (useful during development):

```bash
docker mcp profile server add my-profile --server file://./server.yaml
```

**From the Docker image directly** (useful after pushing to a registry):

```bash
docker mcp profile server add my-profile --server docker://mcp-starter-kit:latest
```

### Step 4 – (Optional) Configure environment variables

```bash
# Enable Bearer token auth inside the gateway container
docker mcp profile config my-profile \
  --set mcp-starter-kit.MCP_AUTH_TOKEN=my-secret
```

### Step 5 – Run the gateway

```bash
docker mcp gateway run --profile my-profile
```

The gateway exposes all servers in the profile over a single stdio connection. Your MCP client connects to the gateway instead of each server individually.

### Step 6 – Connect a client

In any JSON-based client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "my-profile"]
    }
  }
}
```

For VS Code:

```bash
docker mcp client connect vscode --profile my-profile
```

---

## Environment variable reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_MODE` | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | `3000` | HTTP listen port (ignored in stdio mode) |
| `MCP_AUTH_TOKEN` | _(unset)_ | When set, Bearer token required on all `/mcp` HTTP routes |

---

## Project structure

```
mcp-starter-kit/
├── src/
│   ├── server.ts      # buildServer() – tools, resources, prompts
│   ├── index.ts       # Entry point: branches on MCP_MODE
│   └── http.ts        # Streamable HTTP server (Express + session management)
├── dist/              # Compiled output (after npm run build)
├── Dockerfile         # Multi-stage build
├── .dockerignore
├── server.yaml        # Docker MCP Toolkit profile definition
├── package.json
├── tsconfig.json
└── README.md
```

---

## Extending the starter kit

### Add a new tool

In `src/server.ts`, inside `buildServer()`:

```typescript
server.tool(
  "my-tool",
  "Short description shown to models.",
  { input: z.string() },
  async ({ input }) => ({
    content: [{ type: "text", text: `You said: ${input}` }],
  }),
);
```

### Add a new static resource

```typescript
server.resource(
  "my-resource",
  "myscheme://some-path",
  { mimeType: "text/plain" },
  async () => ({
    contents: [{ uri: "myscheme://some-path", text: "resource content" }],
  }),
);
```

### Add a new dynamic resource

```typescript
server.resource(
  "user-profile",
  new ResourceTemplate("users://{userId}/profile", { list: undefined }),
  { mimeType: "application/json" },
  async (uri, { userId }) => ({
    contents: [{ uri: uri.href, text: JSON.stringify({ id: userId }) }],
  }),
);
```

---

## Troubleshooting

### `stdout` logging breaks the stdio protocol

**Symptom:** The MCP client receives garbled data or immediately disconnects.

**Cause:** `console.log()` and anything else that writes to stdout corrupts the JSON-RPC framing that the protocol uses.

**Fix:** Always write diagnostics to stderr:

```typescript
// ✗ WRONG – breaks protocol
console.log("server started");

// ✓ CORRECT
process.stderr.write("server started\n");
```

### Node.js ESM import errors (`ERR_REQUIRE_ESM`, missing `.js` extension)

**Cause:** The project uses `"type": "module"` and `"module": "Node16"` in `tsconfig.json`. TypeScript requires explicit `.js` extensions in relative imports even though the source files are `.ts`.

**Fix:** All relative imports in `src/` must end with `.js`:

```typescript
import { buildServer } from "./server.js"; // ✓
import { buildServer } from "./server";    // ✗ – breaks at runtime
```

### Docker stdio mode exits immediately

**Symptom:** `docker run --rm mcp-starter-kit` exits at once with no output.

**Cause:** Without the `-i` flag, Docker closes stdin before the process starts, which causes `StdioServerTransport` to see EOF and shut down.

**Fix:** Always pass `-i`:

```bash
docker run -i --rm mcp-starter-kit
```

### HTTP mode: `401 Unauthorized`

**Cause:** `MCP_AUTH_TOKEN` is set but the client is not sending the header.

**Fix:** Include the header in every `/mcp` request:

```
Authorization: Bearer <your-token>
```

### HTTP mode: `400 Bad Request – include Mcp-Session-Id…`

**Cause:** The client is sending a non-initialize request without the session ID header, or it skipped the `initialize` handshake.

**Fix:** Always start a session with an `initialize` request (method `"initialize"`). Subsequent requests must include the `Mcp-Session-Id` header returned by the server in the initialize response.

### MCP Inspector doesn't connect in HTTP mode

Make sure the server is already running before launching the Inspector, and that the URL matches:

```bash
# Start server
npm run dev:http

# In a second terminal
npx @modelcontextprotocol/inspector --transport streamablehttp --url http://localhost:3000/mcp
```

---

## License

MIT
