# koipond wallpaper for Windows 10/11. In PowerShell:
#   irm https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.ps1 | iex
# Downloads the app from the latest GitHub release into %LOCALAPPDATA%\koipond and opens it. No admin needed.
# Uninstall: quit it from the tray fish, then delete %LOCALAPPDATA%\koipond.
$ErrorActionPreference = "Stop"
$url = if ($env:KOI_URL) { $env:KOI_URL } else { "https://github.com/Himanshu-Sangshetti/koipond/releases/latest/download/koipond-windows.zip" }
$dest = if ($env:KOI_DEST) { $env:KOI_DEST } else { Join-Path $env:LOCALAPPDATA "koipond" }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("koipond-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Write-Host "Downloading koipond..."
  $zip = Join-Path $tmp "koipond.zip"
  if ($url -like "file://*") { Copy-Item ([uri]$url).LocalPath $zip } else { Invoke-WebRequest $url -OutFile $zip -UseBasicParsing }
  Get-Process koipond -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Expand-Archive $zip $dest
  if ($env:KOI_NO_OPEN -ne "1") { Start-Process (Join-Path $dest "koipond.exe") }
  Write-Host "koipond is running. Right-click the fish in the tray for settings. Installed to $dest"
  Write-Host ""
  Write-Host 'koipond is free. If you like it, pay what you want (from $3) and get the new wallpapers as they come out:'
  Write-Host "  https://koipond-demo.vercel.app/?get"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
