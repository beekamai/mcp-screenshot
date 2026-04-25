import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

/**
 * Capture the entire virtual screen on Windows using GDI+ via PowerShell.
 * Returns the PNG bytes. Independent of screenshot-desktop's bundled exe so
 * Defender/SmartScreen doesn't quarantine our helper.
 */
export async function capturePngWindows(displayIndex?: number): Promise<Buffer> {
  const tmp = path.join(tmpdir(), `mcp-shot-${randomBytes(6).toString("hex")}.png`);

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
${
  displayIndex === undefined
    ? "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen"
    : `$idx = ${Number(displayIndex)}
if ($idx -lt 0 -or $idx -ge $screens.Length) { throw "display $idx out of range (0..$($screens.Length-1))" }
$bounds = $screens[$idx].Bounds`
}
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$bmp.Save("${tmp.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "OK"
`;

  await runPowerShell(ps);
  try {
    return await readFile(tmp);
  } finally {
    try {
      await unlink(tmp);
    } catch {
      /* leave the temp file if we can't unlink — Windows may still hold it */
    }
  }
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`PowerShell exit ${code}: ${err}`));
      resolve();
    });
  });
}
