import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const key = readFileSync("../../.env.local", "utf8").split("\n").find((l) => l.startsWith("DEEPGRAM_API_KEY=")).split("=")[1].trim();
const all = JSON.parse(readFileSync("src/narration.json", "utf8"));
const norm = (s) => s.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter(Boolean).join(" ");
const variants = { l4: ["This is Blink.", "This, is Blink."], l6: ["The banker never sees a transcript. No suggestions. No noise. Only this.", "Your banker never sees a transcript. No suggestions. No noise. Only this."] };
for (const [id, texts] of Object.entries(variants)) {
  let done = false;
  for (let i = 0; i < 8 && !done; i++) {
    const text = texts[Math.min(Math.floor(i / 4), texts.length - 1)];
    const r = await fetch(`https://api.deepgram.com/v1/speak?model=aura-2-athena-en&encoding=linear16&container=wav&sample_rate=48000`, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    writeFileSync(`public/audio/${id}.raw.wav`, Buffer.from(await r.arrayBuffer()));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `public/audio/${id}.raw.wav`, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ar", "48000", "-ac", "1", `public/audio/${id}.wav`]);
    const s = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&keyterm=Blink&keyterm=banker", { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" }, body: readFileSync(`public/audio/${id}.wav`) });
    const alt = (await s.json()).results.channels[0].alternatives[0];
    const ok = norm(alt.transcript) === norm(text);
    console.log(id, "try", i + 1, ok ? "ok" : "heard: " + alt.transcript);
    if (ok) { done = true; const e = all.find((x) => x.id === id); e.text = text; e.dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/audio/${id}.wav`]).toString()); e.words = alt.words.map((w) => ({ w: w.word, s: w.start, e: w.end })); }
  }
  if (!done) console.log(id, "NOT VERIFIED");
}
writeFileSync("src/narration.json", JSON.stringify(all, null, 1));
