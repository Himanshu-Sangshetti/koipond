# koipond wallpaper (Mac, Windows, Linux)

**[Pay what you want (from $3)](https://koipond-demo.vercel.app/?get)** or install it free below.

The koi pond as your desktop wallpaper. It sits under your desktop icons, and the koi still notice you:
glide over empty desktop to leave a wake, click to splash, double-click to drop food, scroll to stir the water.
Your clicks still go to the desktop as usual.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.sh | sh
```

It puts `koipond.app` in Applications and opens it. Or download `koipond-mac.zip` from the
[latest release](https://github.com/Himanshu-Sangshetti/koipond/releases/latest), unzip it and move the app to
Applications. A downloaded app isn't signed with a paid Apple developer account, so the first time macOS will
say it can't check it: open **System Settings → Privacy & Security** and click **Open Anyway**. The one-line
install above doesn't hit this.

Needs macOS 13 or newer, Apple silicon or Intel.

### Windows 10/11

In PowerShell (no admin needed):

```powershell
irm https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.ps1 | iex
```

It installs into `%LOCALAPPDATA%\koipond` and starts it. Right-click the fish in the tray for the looks, koi,
rain, lilies, sakura, pause and open at login. Uses Edge WebView2, which Windows 10/11 already has.

### Linux

The same one-liner as the Mac. It needs GTK and WebKitGTK for Python (the installer tells you the package
names if they are missing; on Ubuntu: `sudo apt install python3-gi gir1.2-webkit2-4.1`). Right-click the pond for
settings. Works on X11 desktops and on GNOME under Wayland (through XWayland); KDE Plasma, Sway and Hyprland on
Wayland use the background layer when `gtk-layer-shell` is installed. Desktop icon extensions may sit under
the pond.

## Using it

- **Click the fish** in the menu bar: looks (Natural, Ink, Dither), a 25/5 focus timer, koi count, size, rain,
  lilies, sakura, performance and open at login. Right-click the fish for a quick menu.
- **Rest the cursor on the right edge** of the desktop (the faint handle) and the same panel slides out.
- **Focus timer**: the countdown shows next to the fish; when a session ends the koi gather in the middle.
- **Performance**: Balanced (30 fps, the default), Smooth (60 fps) or Saver. While your mouse is on the desktop
  it always runs smoothly; when the desktop is covered or the screen is off it pauses and uses almost nothing.
- **Hide the menu bar icon** from the panel; open koipond again from Spotlight to bring the panel back.

## Support

koipond is free. If it makes your desk a bit calmer, **[pay what you want (from $3)](https://koipond-demo.vercel.app/?get)**: supporters get the new wallpapers as they come out, every 2 weeks to a month. One key works on up to 5 computers, any system.

## Uninstall

Mac: quit it from the panel (or right-click the fish → Quit), then drag `koipond.app` from Applications to the Bin.
Windows: quit it from the tray, then delete `%LOCALAPPDATA%\koipond`. Linux: right-click the pond → Quit, then
delete `~/.local/share/koipond` and `~/.local/bin/koipond`.

## Build it yourself

```sh
cd wallpaper && npm ci && npm run build:mac   # needs Node and the Xcode command line tools
open build/koipond.app
```

Windows: `npm run build:web`, copy `build/web/index.html` to `windows/web/`, then
`dotnet publish windows/koipond.csproj -c Release`. Linux: `npm run build:linux`, then `python3 build/linux/koipond.py`.

The Mac app is a small Swift shell (`mac/main.swift`) around the pond page (`web/`). It uses its own copy of the
pond in `pond/`, so changes here never touch the npm component in `../src`.
