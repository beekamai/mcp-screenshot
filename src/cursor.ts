import { spawn } from "node:child_process";

export interface CursorInfo {
  x: number;
  y: number;
  monitor?: number;
  foregroundWindow?: string;
  /** Title of the window under the cursor when available. */
  windowUnderCursor?: string;
}

/**
 * Get the current cursor position and the title of the foreground window
 * + the window directly under the cursor on Windows. Falls back gracefully
 * on other platforms where only the position is exposed.
 */
export async function getCursorInfo(): Promise<CursorInfo> {
  if (process.platform === "win32") {
    return getCursorInfoWindows();
  }
  /* On other platforms we keep a stub - position lookup needs platform-specific
   * code that is out of scope for the first release. Callers should treat the
   * absence of x/y as "unknown". */
  return { x: -1, y: -1 };
}

async function getCursorInfoWindows(): Promise<CursorInfo> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
}
"@
$pos = [System.Windows.Forms.Cursor]::Position
$fg = [W]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][W]::GetWindowText($fg, $sb, 512)
$fgTitle = $sb.ToString()
$pt = New-Object W+POINT
$pt.x = $pos.X
$pt.y = $pos.Y
$wnd = [W]::WindowFromPoint($pt)
$root = [W]::GetAncestor($wnd, 2)
$sb2 = New-Object System.Text.StringBuilder 512
[void][W]::GetWindowText($root, $sb2, 512)
$undTitle = $sb2.ToString()
$out = @{ x = $pos.X; y = $pos.Y; fg = $fgTitle; under = $undTitle }
$out | ConvertTo-Json -Compress
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`cursor probe failed: ${err}`));
      try {
        const j = JSON.parse(out.trim());
        resolve({
          x: j.x,
          y: j.y,
          foregroundWindow: j.fg || undefined,
          windowUnderCursor: j.under || undefined,
        });
      } catch (e) {
        reject(new Error(`cursor probe parse error: ${(e as Error).message} :: ${out}`));
      }
    });
  });
}
