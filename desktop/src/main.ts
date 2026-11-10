import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import path from "node:path";
import { inOrigin, parseServer, type Server } from "./origin";

const PILL_WIDTH = 600;
const PILL_HEIGHT = 56;
const PILL_TOP_GAP = 8;

function readServer(): Server {
  const flag = process.argv.find((arg) => arg.startsWith("--server="));
  return parseServer(flag ? flag.slice("--server=".length) : process.env.BLINK_URL);
}

let server: Server;
try {
  server = readServer();
} catch (error) {
  process.stderr.write(`Blink: bad server address: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
const BLINK_URL = server.url;
const SMOKE = process.argv.includes("--smoke");

function inBlink(url: string): boolean {
  return inOrigin(server.origin, url);
}

/** Keeps a window on the Blink origin: no popups, no navigating away, in the main frame or any subframe. */
function lockToOrigin(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const refuse = (event: { preventDefault(): void }, url: string) => {
    if (!inBlink(url)) event.preventDefault();
  };
  contents.on("will-navigate", (event, url) => refuse(event, url));
  contents.on("will-frame-navigate", (event) => refuse(event, event.url));
  contents.on("will-redirect", (event, url) => refuse(event, url));
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
    callback(permission === "media" && inBlink(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return permission === "media" && inBlink(requestingOrigin);
  });
  // Spike verdict pending: assume `audio grant: needs-video`, so a screen source is granted as video
  // beside the system-audio loopback. Revisit if the spike settles on `audio-only`.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!inBlink(request.securityOrigin)) {
      callback({});
      return;
    }
    desktopCapturer.getSources({ types: ["screen"] }).then(
      (sources) => callback(sources[0] ? { video: sources[0], audio: "loopback" } : {}),
      (error: unknown) => {
        console.error(`could not list screens: ${error instanceof Error ? error.message : String(error)}`);
        callback({});
      },
    );
  });
}

app.whenReady().then(() => {
  setUpSession();
  const pill = makePill();
  const control = makeControl();

  ipcMain.on("blink:set-pill-visible", (event, visible: unknown) => {
    if (event.sender !== control.webContents || !inBlink(event.senderFrame?.url ?? "")) return;
    if (visible === true) pill.showInactive();
    else if (visible === false) pill.hide();
  });

  // The pill must never outlive the control window: it is always on top, ignores the mouse and cannot be dismissed.
  control.on("closed", () => app.quit());

  if (SMOKE) {
    const { workArea } = screen.getPrimaryDisplay();
    const bounds = pill.getBounds();
    // Fires the guards the way Electron would, and reports whether each one cancelled the navigation.
    const refused = (event: string, url: string): boolean => {
      let cancelled = false;
      const fake = { url, preventDefault: () => (cancelled = true) };
      if (event === "will-frame-navigate") control.webContents.emit(event, fake);
      else control.webContents.emit(event, fake, url);
      return cancelled;
    };
    const guards = ["will-navigate", "will-frame-navigate", "will-redirect"];
    const line = {
      pill: {
        alwaysOnTop: pill.isAlwaysOnTop(),
        ignoresMouse: pillIgnoresMouse,
        width: bounds.width,
        height: bounds.height,
        centred: bounds.x === Math.round(workArea.x + (workArea.width - bounds.width) / 2),
        visible: pill.isVisible(),
        top: bounds.y - workArea.y,
      },
      control: { url: `${BLINK_URL}/desktop` },
      navigation: {
        offOriginRefused: guards.every((g) => refused(g, "https://elsewhere.invalid/")),
        onOriginAllowed: guards.every((g) => !refused(g, `${BLINK_URL}/desktop`)),
      },
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    app.exit(0);
  }
});

app.on("window-all-closed", () => app.quit());
