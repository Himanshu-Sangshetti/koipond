# koipond wallpaper for Windows: irm https://koipond-demo.vercel.app/install.ps1 | iex
# Downloads the app from the latest GitHub release into %LOCALAPPDATA%\koipond and starts it.
# Uninstall: quit it from the tray fish, then delete %LOCALAPPDATA%\koipond.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$url = "https://github.com/Himanshu-Sangshetti/koipond/releases/latest/download/koipond-windows.zip"
$dest = Join-Path $env:LOCALAPPDATA "koipond"
$zip = Join-Path $env:TEMP "koipond-windows.zip"
Write-Host "Downloading koipond..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Get-Process koipond -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip
# Start menu shortcut
$lnk = Join-Path ([Environment]::GetFolderPath("Programs")) "koipond.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest "koipond.exe"; $s.Save()
Start-Process (Join-Path $dest "koipond.exe")
Write-Host "koipond is running: it lives in the tray (the fish). Installed to $dest"
