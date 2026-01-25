# nico-keepalive

<img src="./docs/images/icon384.png" alt="icon">

A Chrome extension that keeps Niconico Live (Niconama) streams alive by detecting playback stalls and auto-reloading the watch page.

## Features

- Monitors `video.currentTime` at a fixed interval and ignores tiny jitter.
- Skips detection during a warmup window after the monitor starts.
- If `currentTime` doesn't change for a while, shows a short toast countdown and reloads the page.
- Resets the baseline while paused/ended, and skips monitoring when the program is off-air.
- Saves fullscreen state before reload and restores it after reload.
- Plays a notification sound on stall (volume control + custom audio file).
- Stores recent logs locally and shows them in the popup. Disabled state shows `Zz` badge.
- Shows auto-reload count in the popup status section.

## Installation

* [Chrome Web Store](https://chrome.google.com/webstore/detail/fdhjiepbemmboedlbpmpponhnhmcbdoe)

## Permissions

- `storage` (settings, logs, fullscreen restore state)
- Injects content script on `https://live.nicovideo.jp/watch/*`

## Development

Build artifacts are emitted to `dist`. Load it via `chrome://extensions` → "Load unpacked".

### Build

```shell
# build for production
npm run build-prod

# build for development w/ watch option
npm run build-dev

# build for development (once)
npm run build-dev-once

# clean
npm run clean
```

### Test

```shell
npm test
```

## License

nico-keepalive is under [MIT license](https://en.wikipedia.org/wiki/MIT_License).
