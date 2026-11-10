import { contextBridge, ipcRenderer } from "electron";

/** What the web app may ask of the shell. Anything else stays in the main process. */
contextBridge.exposeInMainWorld("blinkDesktop", {
  isDesktop: true,
  setPillVisible(visible: boolean): void {
    ipcRenderer.send("blink:set-pill-visible", visible === true);
  },
});
