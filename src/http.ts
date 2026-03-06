import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";

import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);

/**
 * When MCP_AUTH_TOKEN is set, all /mcp routes require:
 *   Authorization: Bearer <token>
 * Leave unset to run without authentication (e.g. local dev).
 */
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// One transport (and server instance) per active session.
const transports = new Map<string, StreamableHTTPServerTransport>();

/** Returns false and sends a 401 when auth is enabled and the token is wrong. */
function checkAuth(req: Request, res: Response): boolean {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized: provide a valid Authorization: Bearer <token> header" });
    return false;
  }
  return true;
}

/**
 * Minimal inline check – avoids a potentially-missing SDK helper import.
 * An MCP initialize request is a JSON-RPC object with method === "initialize".
 */
function isInitialize(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>)["method"] === "initialize"
  );
}

export async function startHttpServer(): Promise<void> {
  const app = express();

  // Parse JSON bodies before any route handler sees them.
  app.use(express.json());

  // ── Non-MCP health endpoint (useful for Docker HEALTHCHECK / load balancers) ──
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // ── POST /mcp ─ JSON-RPC messages from client ──────────────────────────────
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        // Subsequent request: route to the existing session's transport.
        const transport = transports.get(sessionId);
        if (!transport) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: `Session not found: ${sessionId}` },
            id: null,
          });
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // No session ID – must be an initialize request to start a new session.
      if (!isInitialize(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: include Mcp-Session-Id for existing sessions, or send initialize to start a new one",
          },
          id: null,
        });
        return;
      }

      // Create a fresh transport + server instance for this session.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
          process.stderr.write(`[mcp-starter-kit] Session created: ${id}\n`);
        },
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) {
          transports.delete(id);
          process.stderr.write(`[mcp-starter-kit] Session closed: ${id}\n`);
        }
      };

      // Each session owns its own McpServer so state is fully isolated.
      const server = buildServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      process.stderr.write(`[mcp-starter-kit] Error in POST /mcp: ${String(err)}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // ── GET /mcp ─ SSE stream for server-to-client notifications ───────────────
  app.get("/mcp", async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("Bad Request: missing or unknown Mcp-Session-Id");
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      process.stderr.write(`[mcp-starter-kit] Error in GET /mcp: ${String(err)}\n`);
    }
  });

  // ── DELETE /mcp ─ explicit session termination ─────────────────────────────
  app.delete("/mcp", async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("Bad Request: missing or unknown Mcp-Session-Id");
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      process.stderr.write(`[mcp-starter-kit] Error in DELETE /mcp: ${String(err)}\n`);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  const httpServer = createServer(app);

  httpServer.listen(PORT, () => {
    process.stderr.write(`[mcp-starter-kit] Streamable HTTP server listening on http://0.0.0.0:${PORT}\n`);
    process.stderr.write(`[mcp-starter-kit] MCP endpoint: POST|GET|DELETE http://localhost:${PORT}/mcp\n`);
    process.stderr.write(`[mcp-starter-kit] Health check:  GET http://localhost:${PORT}/health\n`);
    if (AUTH_TOKEN) {
      process.stderr.write(`[mcp-starter-kit] Auth enabled – Bearer token required on /mcp routes\n`);
    } else {
      process.stderr.write(`[mcp-starter-kit] Auth disabled – set MCP_AUTH_TOKEN to enable Bearer auth\n`);
    }
  });

  // Graceful shutdown: close all open transports before exiting.
  const shutdown = async (signal: string) => {
    process.stderr.write(`\n[mcp-starter-kit] Received ${signal}, shutting down…\n`);
    for (const [id, transport] of transports) {
      try {
        await transport.close();
      } catch (err) {
        process.stderr.write(`[mcp-starter-kit] Error closing session ${id}: ${String(err)}\n`);
      }
      transports.delete(id);
    }
    httpServer.close(() => {
      process.stderr.write("[mcp-starter-kit] Server stopped.\n");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
