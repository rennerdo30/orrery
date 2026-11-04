# Captures the client area of a real orrery.exe window (overlay, controls and banners included)
# with PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT) and saves it as PNG. The window is
# visible while it runs, so use it when nobody is working at the PC. It starts one orrery.exe,
# records its PID and closes only that process. Used for docs/images (see docs/SCREENSHOTS.md).
param(
  [Parameter(Mandatory)] [string]$Exe,
  [Parameter(Mandatory)] [string[]]$ArgList,
  [Parameter(Mandatory)] [string]$Out,
  [int]$SettleMs = 3500, [int]$TimeoutMs = 30000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][W]::SetProcessDPIAware()
$p = Start-Process -FilePath $Exe -ArgumentList $ArgList -PassThru
"PID $($p.Id)"
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($p.MainWindowHandle -eq 0 -and $sw.ElapsedMilliseconds -lt $TimeoutMs) { Start-Sleep -Milliseconds 100; $p.Refresh() }
  if ($p.MainWindowHandle -eq 0) { throw 'no window' }
  $h = $p.MainWindowHandle
  Start-Sleep -Milliseconds $SettleMs
  $cr = New-Object W+RECT; [void][W]::GetClientRect($h, [ref]$cr)
  $bmp = New-Object Drawing.Bitmap ($cr.R - $cr.L), ($cr.B - $cr.T)
  $g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  # PW_CLIENTONLY | PW_RENDERFULLCONTENT: the client area including the WebView2 composition
  [void][W]::PrintWindow($h, $dc, 3); $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  "saved $Out"
} finally {
  if (-not $p.HasExited) { [void]$p.CloseMainWindow(); if (-not $p.WaitForExit(3000)) { $p.Kill() } }
}
