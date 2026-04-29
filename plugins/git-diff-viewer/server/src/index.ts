import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "git-diff-viewer",
  version: "0.1.0"
});

server.tool(
  "ping",
  "Health check for the Git Diff Viewer MCP server scaffold.",
  {
    message: z.string().optional()
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: message ?? "git-diff-viewer server is running"
      }
    ]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
