param([ValidateSet('on', 'off', 'get')][string]$Action = 'get')
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
if (-not ('BigCatWin' -as [type])) { Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BigCatWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint fl);
  public struct RECT { public int L, T, R, B; }
}
"@
}
$pids = @(Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$script:windows = New-Object System.Collections.Generic.List[IntPtr]
$cb = [BigCatWin+EnumProc]{
  param($h, $l)
  $proc = 0
  [BigCatWin]::GetWindowThreadProcessId($h, [ref]$proc) | Out-Null
  if ($pids -notcontains [int]$proc) { return $true }
  if (-not [BigCatWin]::IsWindowVisible($h)) { return $true }
  $cn = New-Object System.Text.StringBuilder 256
  [BigCatWin]::GetClassName($h, $cn, 256) | Out-Null
  if ($cn.ToString() -ne 'Chrome_WidgetWin_1') { return $true }
  $r = New-Object BigCatWin+RECT
  [BigCatWin]::GetWindowRect($h, [ref]$r) | Out-Null
  $area = [Math]::Max(0, $r.R - $r.L) * [Math]::Max(0, $r.B - $r.T)
  if ($area -ge 40000) { $script:windows.Add($h) }
  return $true
}
[BigCatWin]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($script:windows.Count -eq 0) { Write-Output 'missing'; exit 0 }
$after = if ($Action -eq 'on') { [IntPtr](-1) } elseif ($Action -eq 'off') { [IntPtr](-2) } else { [IntPtr]::Zero }
if ($Action -ne 'get') {
  foreach ($hwnd in $script:windows) {
    [BigCatWin]::SetWindowPos($hwnd, $after, 0, 0, 0, 0, 0x0013) | Out-Null
  }
}
if ($Action -ne 'get') { Start-Sleep -Milliseconds 150 }
$on = $false
foreach ($hwnd in $script:windows) {
  $style = [BigCatWin]::GetWindowLong($hwnd, -20)
  if (($style -band 8) -ne 0) { $on = $true }
}
if ($on) { Write-Output 'on' } else { Write-Output 'off' }
