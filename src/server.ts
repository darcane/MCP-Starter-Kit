import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Creates and configures a fully-wired McpServer instance.
 * Call this once per transport connection so each session gets its own server state.
 */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "mcp-starter-kit",
    version: "1.0.0",
  });

  // ─── Tools ───────────────────────────────────────────────────────────────

  server.tool(
    "ping",
    "Responds with pong, optionally echoing back a message.",
    { message: z.string().optional().describe("Optional message to include in the response") },
    async ({ message }) => ({
      content: [{ type: "text", text: message ? `pong: ${message}` : "pong" }],
    }),
  );

  server.tool(
    "echo",
    "Returns the exact text provided.",
    { text: z.string().describe("Text to echo back") },
    async ({ text }) => ({
      content: [{ type: "text", text }],
    }),
  );

  server.tool(
    "add",
    "Adds two numbers and returns the result.",
    {
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );

  // ─── Resources ───────────────────────────────────────────────────────────

  server.resource(
    "health-status",
    "health://status",
    { mimeType: "text/plain", description: "Server health status" },
    async () => ({
      contents: [{ uri: "health://status", text: "ok" }],
    }),
  );

  server.resource(
    "public-config",
    "config://public",
    { mimeType: "application/json", description: "Non-secret public server configuration" },
    async () => ({
      contents: [
        {
          uri: "config://public",
          text: JSON.stringify(
            {
              name: "mcp-starter-kit",
              version: "1.0.0",
              features: ["tools", "resources", "prompts"],
              transports: ["stdio", "streamable-http"],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // Dynamic resource: hello://{name}
  // ResourceTemplate uses RFC 6570 URI templates; extracted variables are passed to the handler.
  server.resource(
    "hello",
    new ResourceTemplate("hello://{name}", { list: undefined }),
    { mimeType: "text/plain", description: "A personalized greeting" },
    async (uri, { name }) => ({
      contents: [{ uri: uri.href, text: `Hello, ${name}!` }],
    }),
  );

  // ─── Prompts ─────────────────────────────────────────────────────────────

  server.prompt(
    "review-code",
    "Generates a prompt that asks a model to review the provided code.",
    { code: z.string().describe("Source code to review") },
    async ({ code }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Please review the following code.",
              "Look for: bugs, security issues, performance problems, and style improvements.",
              "Be concise and actionable.\n",
              "```",
              code,
              "```",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
