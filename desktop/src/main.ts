import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import path from "node:path";

const PILL_WIDTH = 600;
const PILL_HEIGHT = 56;
const PILL_TOP_GAP = 8;

function serverUrl(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--server="));
  const raw = (flag ? flag.slice("--server=".length) : process.env.BLINK_URL) || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

const BLINK_URL = serverUrl();
const ORIGIN = new URL(BLINK_URL).origin;
const SMOKE = process.argv.includes("--smoke");

/** True when a URL belongs to the one origin this shell talks to. */
function inOrigin(url: string): boolean {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

/** Keeps a window on the Blink origin: no popups, no navigating away. */
function lockToOrigin(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guard = (event: { preventDefault(): void }, url: string) => {
    if (!inOrigin(url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", guard);
  win.webContents.on("will-redirect", guard);
}

function load(win: BrowserWindow, route: string): void {
  win.loadURL(`${BLINK_URL}${route}`).catch((error: unknown) => {
    // The server may be down or restarting; the window stays blank until it is back.
    console.error(`could not load ${route}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

let pillIgnoresMouse = false;

function makePill(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
    y: workArea.y + PILL_TOP_GAP,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  pillIgnoresMouse = true;
  lockToOrigin(win);
  load(win, "/desktop/pill");
  return win;
}

function makeControl(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    title: "Blink",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  lockToOrigin(win);
  load(win, "/desktop");
  win.once("ready-to-show", () => win.show());
  return win;
}

function setUpSession(): void {
  const ses = session.defaultSession;
  // Only the Blink page may use the microphone or ask to capture; nothing else is ever granted.
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permission === "media" && inOrigin(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return permission === "media" && inOrigin(requestingOrigin);
  });
  // Spike verdict pending: assume `audio grant: needs-video`, so a screen source is granted as video
  // beside the system-audio loopback. Revisit if the spike settles on `audio-only`.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!inOrigin(request.securityOrigin)) {
      callback({});
      return;
    }
    desktopCapturer.getSources({ types: ["screen"] }).then(
      (sources) => callback(sources[0] ? { video: sources[0], audio: "loopback" } : {}),
      () => callback({}),
    );
  });
}

app.whenReady().then(() => {
  setUpSession();
  const pill = makePill();
  const control = makeControl();

  ipcMain.on("blink:set-pill-visible", (event, visible: unknown) => {
    if (event.sender !== control.webContents || !inOrigin(event.senderFrame?.url ?? "")) return;
    if (visible === true) pill.showInactive();
    else if (visible === false) pill.hide();
  });

  if (SMOKE) {
    const { workArea } = screen.getPrimaryDisplay();
    const bounds = pill.getBounds();
    const line = {
      pill: {
        alwaysOnTop: pill.isAlwaysOnTop(),
        ignoresMouse: pillIgnoresMouse,
        width: bounds.width,
        height: bounds.height,
        centred: bounds.x === Math.round(workArea.x + (workArea.width - bounds.width) / 2),
      },
      control: { url: `${BLINK_URL}/desktop` },
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    app.exit(0);
  }
});

app.on("window-all-closed", () => app.quit());
