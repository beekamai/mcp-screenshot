#!/usr/bin/env node
/**
 * mcp-screenshot — desktop screen capture and timed-streaming MCP server.
 *
 * Designed for LLM workflows where the model needs eyes on the user's screen
 * without flooding the context window: full captures are persisted to disk,
 * streaming sessions keep only the last N frames in memory, and base64
 * payloads are opt-in.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { capture, CaptureResult } from "./capture.js";
import { getCursorInfo } from "./cursor.js";
import {
  startStream,
  stopStream,
  snapshotStream,
  listStreams,
  dropStream,
} from "./stream.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(here, "..", "captures");

const server = new Server(
  { name: "mcp-screenshot", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "screenshot",
      description:
        "Capture a single screenshot of the desktop. Persists the file to disk and " +
        "optionally returns a base64 payload. Set cursorRadius>0 to crop a square " +
        "region around the mouse cursor instead of the full screen.",
      inputSchema: {
        type: "object",
        properties: {
          cursorRadius: {
            type: "integer",
            description: "If >0, crop a square of (2*radius)x(2*radius) px centered on the cursor. 0 = full screen.",
            default: 0,
          },
          format: { type: "string", enum: ["png", "jpeg", "webp"], default: "jpeg" },
          quality: { type: "integer", minimum: 1, maximum: 100, default: 70 },
          maxEdge: {
            type: "integer",
            description: "Resize the longest edge to this many pixels. 0 disables resizing. Default 1600.",
            default: 1600,
          },
          display: {
            type: "integer",
            description: "Optional display index for multi-monitor setups (omit for primary).",
          },
          includeBase64: {
            type: "boolean",
            description: "If true, include the image bytes inline in the response. Default true.",
            default: true,
          },
        },
      },
    },
    {
      name: "cursor_info",
      description:
        "Return the current mouse cursor position, the foreground window title, and the " +
        "title of the window directly under the cursor (Windows only; other platforms " +
        "report position only when available).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "stream_start",
      description:
        "Start a periodic capture session. Saves frames to disk every intervalSeconds " +
        "for at most durationSeconds, keeping the last ringCapacity frames in memory. " +
        "Returns a session id used by stream_status / stream_latest / stream_stop. " +
        "Streams default to disk-only to keep LLM context lean - call stream_latest " +
        "with includeBase64=true when you actually want to look at a frame.",
      inputSchema: {
        type: "object",
        required: ["intervalSeconds", "durationSeconds"],
        properties: {
          intervalSeconds: {
            type: "number",
            minimum: 0.25,
            description: "Seconds between frames. Minimum 0.25.",
          },
          durationSeconds: {
            type: "number",
            minimum: 0.25,
            description: "Total duration of the stream in seconds.",
          },
          cursorRadius: { type: "integer", default: 0 },
          format: { type: "string", enum: ["png", "jpeg", "webp"], default: "jpeg" },
          quality: { type: "integer", minimum: 1, maximum: 100, default: 60 },
          maxEdge: { type: "integer", default: 1280 },
          ringCapacity: {
            type: "integer",
            description: "Maximum number of recent frames kept in memory. Older frames are evicted (still on disk).",
            default: 60,
          },
        },
      },
    },
    {
      name: "stream_status",
      description: "Snapshot of a running or finished stream session - frame count, time remaining, last frames metadata.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          lastN: { type: "integer", default: 8 },
        },
      },
    },
    {
      name: "stream_latest",
      description:
        "Read the most recent frame of a stream from disk and return it as base64. Use sparingly - this is the path that actually puts pixels into the LLM context.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
    },
    {
      name: "stream_stop",
      description: "Stop a running stream early. Frames already on disk remain.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    {
      name: "stream_list",
      description: "List active and completed stream sessions known to this process.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "stream_drop",
      description: "Forget a finished stream session (frees its in-memory ring; on-disk files are preserved).",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      case "screenshot": {
        const r = await capture({
          outDir: DEFAULT_OUT_DIR,
          cursorRadius: numArg(args, "cursorRadius", 0),
          format: strEnum(args, "format", ["png", "jpeg", "webp"] as const, "jpeg"),
          quality: numArg(args, "quality", 70),
          maxEdge: numArg(args, "maxEdge", 1600),
          display: args.display === undefined ? undefined : Number(args.display),
          includeBase64: args.includeBase64 !== false,
        });
        return jsonAndImage(r);
      }

      case "cursor_info": {
        const ci = await getCursorInfo();
        return text(ci);
      }

      case "stream_start": {
        const r = startStream({
          intervalSeconds: numArg(args, "intervalSeconds", 1),
          durationSeconds: numArg(args, "durationSeconds", 10),
          cursorRadius: numArg(args, "cursorRadius", 0),
          format: strEnum(args, "format", ["png", "jpeg", "webp"] as const, "jpeg"),
          quality: numArg(args, "quality", 60),
          maxEdge: numArg(args, "maxEdge", 1280),
          ringCapacity: numArg(args, "ringCapacity", 60),
          outDir: DEFAULT_OUT_DIR,
        });
        return text(r);
      }

      case "stream_status": {
        const id = strArg(args, "id");
        const lastN = numArg(args, "lastN", 8);
        const snap = snapshotStream(id, { lastN });
        if (!snap) return text({ error: `Unknown stream id: ${id}` });
        return text(snap);
      }

      case "stream_latest": {
        const id = strArg(args, "id");
        const snap = snapshotStream(id, { lastN: 1 });
        if (!snap) return text({ error: `Unknown stream id: ${id}` });
        const last = snap.frames.at(-1);
        if (!last) return text({ id, message: "no frames yet" });
        const buf = await readFile(last.filePath);
        const base64 = buf.toString("base64");
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: mimeFor(last.format),
            },
            { type: "text", text: JSON.stringify({ id, frame: last }, null, 2) },
          ],
        };
      }

      case "stream_stop":
        return text(stopStream(strArg(args, "id")));

      case "stream_list":
        return text(listStreams());

      case "stream_drop":
        return text({ id: strArg(args, "id"), dropped: dropStream(strArg(args, "id")) });

      default:
        return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
    }
  } catch (e) {
    return {
      content: [{ type: "text", text: `error: ${(e as Error).message}` }],
      isError: true,
    };
  }
});

function jsonAndImage(r: CaptureResult) {
  const content: Array<unknown> = [];
  if (r.base64) {
    content.push({ type: "image", data: r.base64, mimeType: mimeFor(r.format) });
  }
  const meta = { ...r };
  delete meta.base64;
  content.push({ type: "text", text: JSON.stringify(meta, null, 2) });
  return { content };
}

function text(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing string argument: ${key}`);
  }
  return v;
}

function numArg(args: Record<string, unknown>, key: string, def: number): number {
  const v = args[key];
  if (v === undefined || v === null) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`bad number for ${key}: ${v}`);
  return n;
}

function strEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  def: T
): T {
  const v = args[key];
  if (v === undefined || v === null) return def;
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new Error(`invalid ${key}: ${v}`);
  }
  return v as T;
}

function mimeFor(format: string): string {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

const transport = new StdioServerTransport();
await server.connect(transport);
