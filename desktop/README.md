# Blink for Mac

A small Electron shell around the web app. It shows two windows from one Blink server:

- the control window (`/desktop`), 420 by 560, where the banker starts and stops a call;
- the pill (`/desktop/pill`), 600 by 56, a transparent bar at the top centre of the screen. It floats above every app and Space, ignores the mouse, cannot take focus, and stays hidden until the control page calls `window.blinkDesktop.setPillVisible(true)`.

The shell answers the page's screen-capture request with the system-audio loopback. It assumes the spike's `audio grant: needs-video`, so a screen source is granted as video beside it. Only `BLINK_URL`'s origin may use the microphone; navigation and new windows outside that origin are refused.

## Build and check

```bash
pnpm desktop:build   # compile, package desktop/out/Blink-darwin-arm64/Blink.app, sign ad hoc
pnpm desktop:smoke   # run the packaged app with --smoke and check the one JSON line it prints
```

Always run the packaged app, never `electron .`: macOS credits the system-audio permission to the responsible app, and an unpackaged run silently delivers a dead audio track. Open it with `open desktop/out/Blink-darwin-arm64/Blink.app`, not by running the inner binary from a terminal. The smoke check does run the inner binary, which is fine because it never touches audio.

`ELECTRON_RUN_AS_NODE=1` makes the binary behave as plain Node; the smoke script removes it from the environment.

## Pointing it at a server

`BLINK_URL` (or `--server=<url>`) names the Blink server; the default is `http://localhost:3000`. For example: `open -n desktop/out/Blink-darwin-arm64/Blink.app --args --server=https://blink.example.com`.

macOS 14.2 or later. Apple silicon only.
