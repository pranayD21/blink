import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const key = readFileSync("../../.env.local", "utf8").split("\n").find((l) => l.startsWith("DEEPGRAM_API_KEY=")).split("=")[1].trim();
const lines = JSON.parse(readFileSync("narration.json", "utf8"));
const voice = process.argv[2] ?? "aura-2-athena-en";
const out = []; let chars = 0;
const norm = (s) => s.toLowerCase().replace(/[^a-z' -]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
for (const l of lines) {
  const r = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&container=wav&sample_rate=48000`, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: l.text }) });
  if (!r.ok) throw new Error(`tts ${l.id} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer()); const raw = `public/audio/${l.id}.raw.wav`; writeFileSync(raw, buf); chars += l.text.length;
  // Trim silence at both ends, keep a clean edge.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ar", "48000", "-ac", "1", `public/audio/${l.id}.wav`]);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/audio/${l.id}.wav`]).toString());
  const s = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=false&punctuate=false", { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" }, body: readFileSync(`public/audio/${l.id}.wav`) });
  const j = await s.json(); const alt = j.results.channels[0].alternatives[0];
  const heard = norm(alt.transcript), want = norm(l.text);
  out.push({ ...l, dur, words: alt.words.map((w) => ({ w: w.word, s: w.start, e: w.end })) });
  console.log(`${l.id} ${dur.toFixed(2)}s ${heard.join(" ") === want.join(" ") ? "ok" : "DIFF heard: " + alt.transcript}`);
}
writeFileSync("src/narration.json", JSON.stringify(out, null, 1));
console.log("chars", chars, "total speech", out.reduce((a, b) => a + b.dur, 0).toFixed(1));
