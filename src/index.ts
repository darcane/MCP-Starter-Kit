import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

const mode = (process.env.MCP_MODE ?? "stdio").toLowerCase();

async function main(): Promise<void> {
  if (mode === "http") {
    // Dynamically import so the http module (and Express) are only loaded when needed.
    const { startHttpServer } = await import("./http.js");
    await startHttpServer();
    return;
  }

  // Default: stdio transport.
  // IMPORTANT: stdout is reserved exclusively for MCP protocol messages.
  //            Never use console.log() here – it will corrupt the protocol stream.
  //            Always write diagnostics to stderr.
  const server = buildServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.stderr.write("[mcp-starter-kit] Server running on stdio. Waiting for messages…\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[mcp-starter-kit] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
