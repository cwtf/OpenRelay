# Packaging the desktop app

How to turn `apps/desktop/` into something you can install: a Windows `.exe`, a macOS `.dmg`, or a Linux AppImage or `.deb`. The tool is [electron-builder](https://www.electron.build/). Its settings live in the `"build"` section of `apps/desktop/package.json`.

## The short version (Windows)

From the repository root, in a terminal:

```sh
npm ci
cd apps/desktop
npm ci
npm run dist
npm run test:packaged
```

The files are in `apps/desktop/release/`:

| File | What it is |
|---|---|
| `OpenRelay-<version>-setup.exe` | Installer. Installs for your user only (no administrator rights), lets you pick the folder, and adds a Start menu entry and an uninstaller. |
| `OpenRelay-<version>-portable.exe` | One file that runs without installing. It unpacks itself to a temporary folder on each start, so it starts more slowly. |
| `win-unpacked/` | The app before it's wrapped into an installer. `win-unpacked/OpenRelay.exe` runs as is, which is handy for a quick check. |
| `*.blockmap`, `builder-debug.yml` | Build by-products. You can ignore them. |

`release/` is git-ignored. Copy the `.exe` you want somewhere else before you share it.

## Step by step

### 1. Prerequisites

- **Node 24 or later** (`node --version`) and git.
- An internet connection the first time. electron-builder downloads Electron and its packaging tools (NSIS on Windows) and caches them for later builds.
- **You build each platform on that platform.** A Windows `.exe` is built on Windows, a `.dmg` on a Mac, and an AppImage or `.deb` on Linux. electron-builder can't make Mac builds anywhere but macOS. Linux packages need Linux tools, so on Windows use WSL (Ubuntu) or Docker; see "Linux" below.

### 2. Install dependencies

The repository has two `package.json` files: the root one for the shared reader and extension, and `apps/desktop/package.json` for Electron and electron-builder. Install both:

```sh
npm ci                 # in the repository root
cd apps/desktop
npm ci
```

Run these again after pulling changes that touch either `package-lock.json`.

### 3. Set the version

The version goes into the file names and the installer, and Windows uses it to recognise an upgrade. Change `"version"` in **`apps/desktop/package.json`**. That one is independent of the extension's version, which is in the root `package.json` and `public/manifest.json`.

### 4. Build

```sh
npm run dist
```

This runs three steps:

1. `npm run build` at the repository root builds the reader and `content.js` into `dist/`. It runs the root build only, not the full `npm run check`. Run `npm run check` from the root first if you want the type-check and unit tests too.
2. `tools/copy-dist.mjs` copies `reader.html`, `assets/` and `content.js` into `apps/desktop/openrelay/`.
3. `electron-builder` packages `src/`, `openrelay/` and `package.json` into `app.asar`, sets Electron's security fuses, and builds the targets for the platform you're on.

So the package always contains the current code; you never need to copy anything by hand.

### 5. Check it

On Windows:

```sh
npm run test:packaged
```

It runs two checks, and neither contacts Reddit:

- It starts the real `release/win-unpacked/OpenRelay.exe` with a throwaway profile and a dead proxy, and checks that the reader loads and a vote is sent (with fixtures, not Reddit).
- It runs the full desktop test suite on the packaged `app.asar`.

Both should print a `PASS` line. Screenshots and test profiles go to `test-results/` at the repository root.

On macOS and Linux, run the full suite on the packaged `app.asar` instead. It's at `release/mac/OpenRelay.app/Contents/Resources/app.asar` (`release/mac-arm64/…` on Apple silicon) or `release/linux-unpacked/resources/app.asar`:

```sh
node test/smoke.mjs release/linux-unpacked/resources/app.asar
```

`test/packaged-smoke.mjs` takes the path to the packaged executable as its argument, but it has only been run on Windows.

Then install it and try it yourself: sign in to Reddit inside the app, open a post, vote, and switch views with Ctrl+Shift+R.

## Choosing what gets built

The `"build"` section in `apps/desktop/package.json` sets the default targets:

```json
"win":   { "target": ["nsis", "portable"] },
"mac":   { "target": "dmg" },
"linux": { "target": "AppImage" }
```

To build only some of them once, call electron-builder yourself after `npm run build`:

```sh
npm run build
npx electron-builder --win portable        # only the portable exe
npx electron-builder --win nsis            # only the installer
npx electron-builder --linux deb AppImage  # on Linux
npx electron-builder --mac dmg zip         # on a Mac
```

To change the defaults, edit the `target` lists. electron-builder has many more targets, such as `zip`, `msi`, `appx`, `rpm`, `snap` and `pacman`; see [its targets list](https://www.electron.build/configuration#target).

## Linux

On Ubuntu or Debian, natively or in WSL:

```sh
sudo apt install build-essential
npm ci && cd apps/desktop && npm ci
npm run dist
```

That gives an `OpenRelay-<version>….AppImage` in `release/`. Make it executable (`chmod +x`) and run it; nothing needs installing.

### Adding a `.deb`

A `.deb` isn't in the defaults yet. To add it:

1. In `apps/desktop/package.json`, change the Linux target to `"target": ["AppImage", "deb"]`.
2. Debian packages need a maintainer with an email address. Add one under `"linux"`, for example `"maintainer": "Your Name <you@example.com>"`. The address is visible to anyone who installs the package (`dpkg -s`), so use one you're happy to publish.
3. Run `npm run dist` on Linux. You get `release/openrelay-desktop_<version>_amd64.deb`. Install it with `sudo apt install ./release/openrelay-desktop_<version>_amd64.deb`.

For an `.rpm`, do the same with `"rpm"` and install the `rpm` package first (`sudo apt install rpm`).

### Building Linux packages from Windows with Docker

If you'd rather not set up WSL, electron-builder publishes a build image. From the repository root, in PowerShell:

```powershell
docker run --rm -v "${PWD}:/project" -w /project electronuserland/builder:latest bash -c "npm ci && cd apps/desktop && npm ci && npm run dist -- --linux"
```

`npm ci` replaces `node_modules` with Linux versions, so run `npm ci` in both folders again before you build for Windows.

## macOS

On a Mac with the Xcode command-line tools (`xcode-select --install`):

```sh
npm ci && cd apps/desktop && npm ci
npm run dist
```

This makes an `OpenRelay-<version>….dmg` in `release/` for the Mac's own chip. Add `-- --universal` to build one app for both Intel and Apple silicon (`npm run dist -- --universal`).

Without signing and notarization, macOS refuses to open the app at first. Right-click it → **Open**, or allow it in **System Settings → Privacy & Security**.

## Signing (optional)

The builds aren't signed. That's fine for yourself and friends, but users see warnings:

- **Windows:** SmartScreen says "Windows protected your PC". Click **More info → Run anyway**. The warning goes away only with a code-signing certificate, and an EV certificate or Azure Trusted Signing helps the most.
- **macOS:** Gatekeeper blocks the app until it's signed with an Apple Developer ID and notarized. This needs the paid Apple Developer Program.

When you have a certificate, electron-builder reads it from environment variables, so nothing secret goes into the repository:

- **Windows:** `CSC_LINK` is the path to the `.pfx` (or its base64), and `CSC_KEY_PASSWORD` is its password.
- **macOS:** `CSC_LINK` and `CSC_KEY_PASSWORD` hold the Developer ID certificate, and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are used for notarization.

Never commit certificates or `.pfx`/`.p12` files. Keep them outside the repository, or add them to `.gitignore`, as the repo already does for `dist.pem`. electron-builder's [code-signing guide](https://www.electron.build/code-signing) has the details.

## App icon

The desktop app, Android launcher and browser extension use OpenRelay's **Open Thread** icon: two white comment blocks connected by a thread rail on blue (`#1d63c4`). The vector originals are in `assets/branding/`.

The desktop resources in `apps/desktop/resources/` are checked in:

- `icon.ico`: Windows executable, installer and uninstaller; includes 16–256 px sizes.
- `icon.icns`: macOS app.
- `icon.png`: 1024 px PNG for Linux and the running desktop window.

Android resources include adaptive launcher icons, a monochrome layer for Android 13+ themed icons, and density-specific PNGs. The extension's toolbar and management icons are in `public/icons/` and are copied into both extension builds.

To regenerate all assets after changing the geometry in `tools/build-icons.py`, install Pillow in your Python environment and run:

```sh
python tools/build-icons.py
```

Normal builds use the checked-in assets and need no Python dependency. Rebuild with `npm run build:apps` to produce the Windows installer, portable executable and Android debug APK. The unrelated reference files under `APK/` are not used.

## What the fuses do, and what they break

`"electronFuses"` in the build settings hardens the packaged app:

- It can't be started as a plain Node.js runtime.
- It ignores `NODE_OPTIONS`, `--inspect` and `-r`.
- It loads only its own integrity-checked `app.asar`.
- It encrypts the cookie store (your Reddit session) with the operating system's key store.

Because of this, you can't attach a Node debugger to the packaged app, and Playwright's usual Electron launcher can't drive it. That's why `test/packaged-smoke.mjs` uses Chrome's remote-debugging port instead. Debug from source with `npm start`.

## Troubleshooting

- **`npm run dist` fails while downloading:** the first build needs internet access to GitHub, where Electron and NSIS are downloaded from. Corporate proxies can block this. Try again on another network, or set `ELECTRON_MIRROR`.
- **"The process cannot access the file" / `EBUSY` on `release/`:** OpenRelay, or an Explorer window, is still using the old build. Close it and run `npm run dist` again.
- **The app shows an old reader:** an old copy is still installed or running. `npm run dist` always rebuilds, so quit OpenRelay, reinstall from the new installer, and start it again.
- **Antivirus quarantines the portable exe:** unsigned self-extracting executables sometimes trigger heuristics. The installer is less likely to, and signing fixes it.
- **Where are my settings and session?** In `%APPDATA%\OpenRelay` (Windows), `~/Library/Application Support/OpenRelay` (macOS) or `~/.config/OpenRelay` (Linux). Uninstalling leaves this folder; delete it to start fresh.
