import { capture, CaptureOptions, CaptureResult } from "./capture.js";

interface StreamSession {
  id: string;
  startedAt: number;
  intervalMs: number;
  durationMs: number;
  /* Frames are kept in a bounded ring so a long stream doesn't bloat memory. */
  frames: CaptureResult[];
  capacity: number;
  options: Omit<CaptureOptions, "outDir">;
  outDir: string;
  ticker?: NodeJS.Timeout;
  stopAt: number;
  done: boolean;
  error?: string;
}

const sessions = new Map<string, StreamSession>();

export interface StartStreamArgs {
  intervalSeconds: number;
  durationSeconds: number;
  cursorRadius?: number;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  maxEdge?: number;
  ringCapacity?: number;
  outDir: string;
}

export function startStream(args: StartStreamArgs): { id: string; expectedFrames: number } {
  const intervalMs = Math.max(250, Math.floor(args.intervalSeconds * 1000));
  const durationMs = Math.max(intervalMs, Math.floor(args.durationSeconds * 1000));
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sess: StreamSession = {
    id,
    startedAt: Date.now(),
    intervalMs,
    durationMs,
    frames: [],
    capacity: Math.max(1, args.ringCapacity ?? 60),
    options: {
      cursorRadius: args.cursorRadius,
      format: args.format,
      quality: args.quality,
      maxEdge: args.maxEdge,
      includeBase64: false /* streams default to disk-only; pull frames on demand */,
    },
    outDir: args.outDir,
    stopAt: Date.now() + durationMs,
    done: false,
  };

  const tick = async () => {
    if (sess.done) return;
    if (Date.now() >= sess.stopAt) {
      stopStream(id);
      return;
    }
    try {
      const frame = await capture({ ...sess.options, outDir: sess.outDir });
      sess.frames.push(frame);
      while (sess.frames.length > sess.capacity) sess.frames.shift();
    } catch (e) {
      sess.error = (e as Error).message;
    }
  };

  /* Fire one immediately so the first frame is available right away, then keep
   * ticking on interval. */
  void tick();
  sess.ticker = setInterval(tick, sess.intervalMs);
  sessions.set(id, sess);

  const expectedFrames = Math.max(1, Math.floor(durationMs / intervalMs));
  return { id, expectedFrames };
}

export function stopStream(id: string): { id: string; frameCount: number; stopped: boolean } {
  const sess = sessions.get(id);
  if (!sess) return { id, frameCount: 0, stopped: false };
  if (sess.ticker) clearInterval(sess.ticker);
  sess.ticker = undefined;
  sess.done = true;
  return { id, frameCount: sess.frames.length, stopped: true };
}

export interface StreamSnapshot {
  id: string;
  startedAt: number;
  done: boolean;
  remainingMs: number;
  frameCount: number;
  capacity: number;
  intervalMs: number;
  error?: string;
  frames: Array<Omit<CaptureResult, "base64">>;
}

export function snapshotStream(
  id: string,
  options: { withBase64?: boolean; lastN?: number } = {}
): (StreamSnapshot & { latestBase64?: string }) | null {
  const sess = sessions.get(id);
  if (!sess) return null;
  const lastN = options.lastN ?? Math.min(8, sess.frames.length);
  const slice = sess.frames.slice(-lastN);
  const summary: StreamSnapshot = {
    id: sess.id,
    startedAt: sess.startedAt,
    done: sess.done,
    remainingMs: Math.max(0, sess.stopAt - Date.now()),
    frameCount: sess.frames.length,
    capacity: sess.capacity,
    intervalMs: sess.intervalMs,
    error: sess.error,
    frames: slice.map(({ base64, ...rest }) => rest),
  };
  if (options.withBase64 && slice.length > 0) {
    /* Most recent frame only - re-reading from disk avoids holding base64 in
     * the session object itself. */
    return { ...summary, latestBase64: undefined };
  }
  return summary;
}

export function listStreams(): Array<{ id: string; done: boolean; frameCount: number; remainingMs: number }> {
  const out: Array<{ id: string; done: boolean; frameCount: number; remainingMs: number }> = [];
  for (const s of sessions.values()) {
    out.push({
      id: s.id,
      done: s.done,
      frameCount: s.frames.length,
      remainingMs: Math.max(0, s.stopAt - Date.now()),
    });
  }
  return out;
}

export function dropStream(id: string): boolean {
  stopStream(id);
  return sessions.delete(id);
}
