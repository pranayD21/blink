/**
 * pnpm eval:spoken — real transcripts through the live path as speech (Task 38).
 *
 * Reads each turn of a written call aloud with `say` (a different voice per speaker), lays the
 * turns out as two 16 kHz channels (the banker on the microphone; the expert and the moderator on
 * the computer's audio), streams both to Flux at real-time pace through tokens from the call's own
 * `stt-token` route, assembles the turns with the app's pure assembler, and posts them, the
 * acknowledgements and the end exactly as the banker's app does. It prints, per heard turn: the
 * speaker's role, the pill, the read status and the milliseconds from the end of speech to the
 * decision being shown. It never prints a word of what was said, and never a password or token.
 *
 *   pnpm eval:spoken --prepare-db data/spoken.db
 *       a fresh scratch database (under data/, never data/blink.db): users, documents, the
 *       Halvorsen case at intake, the demo's manual policy active, document facts from recordings
 *   pnpm eval:spoken --db data/spoken.db --prepare-case <callDir> --policy oaktree
 *       a case for Priya from a real call's packet, judged under a real policy installed the way
 *       `pnpm eval:real` installs it (despite coverage gaps; never approved, never through a route)
 *   pnpm eval:spoken --transcript <file> --case <caseId> [--server <url>] [--as <userId>]
 *                    [--db <path>] [--name <label>] [--expect-red T11] [--private]
 *       the call. `--as` signs in through /api/session/login with that user's email and the
 *       password under that id in BLINK_SEED_PASSWORDS; without it, the switcher cookie for
 *       user_priya. With `--db` (the server's own database file) it also waits for the after-call
 *       read and compares its flags with the live ones, and reads the timings back from call_turns.
 *       `labels.json` beside the transcript, or `--expect-red`, names the turns that should go red.
 *       `--private` keeps error messages to their codes.
 *   pnpm eval:spoken --earnings21 4387332,4366522 [--minutes 10]
 *       the first minutes of Earnings-21 files in data/spoken/earnings21/ through Flux, scored
 *       against the reference: word error rate, numbers and company names (see the doc).
 *
 * Results (numbers, roles and turn labels only) go to data/spoken/results/.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { eq, like } from "drizzle-orm";
import { parseFluxMessage } from "../src/core/live/flux";
import { BROKEN_AFTER_MS } from "../src/core/live/pill";
import { summarizeLatency } from "../src/core/live/stats";
import { type Channel, type FinishedTurn, createTurnAssembler } from "../src/core/live/turns";
import { type SpeakerRole, parseTranscript } from "../src/core/transcript/parse";
import { findingCleared } from "../src/core/workflow/brief";
import { DEMO_USERS, demoEmail, loadActor } from "../src/server/auth/actor";
import { closeDb, getDb, migrateDb, transact } from "../src/server/db/client";
import { callClaims, callTurns, calls, cases, jobs, llmCalls } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { errorCode, installPolicies, priceCalls } from "../src/server/eval/real";
import {
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  SPOKEN_FLUX_URL,
  TURN_DEADLINE_MS,
  alignPrefix,
  compareFlags,
  isTurnReply,
  layoutTurns,
  mixChannels,
  nlpReference,
  normalizeWords,
  scratchDbProblem,
  sourceTurnsOf,
  tokenAccuracy,
} from "../src/server/eval/spoken";
import { drainJobs } from "../src/server/jobs/runner";
import { eligibilityForCase } from "../src/server/services/briefs";
import { CreateCaseSchema, createCase } from "../src/server/services/cases";
import { loadCurrentClaims } from "../src/server/services/loaders";
import { seedDatabase } from "../src/server/services/seed";

const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1280; // 80 ms, as the app's worklet sends
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;
const VOICES: Record<SpeakerRole, string> = { analyst: "Samantha", expert: "Daniel", moderator: "Karen" };
const LAYOUT = { leadMs: 1000, switchGapMs: 700, sameChannelGapMs: 3000 };
const TAIL_MS = 4000;
const FLUX_USD_PER_MIN = 0.0077; // Flux English streaming, pay as you go (deepgram.com/pricing, 2026-11-10)

const DATA = resolve(process.cwd(), "data");
const SPOKEN = join(DATA, "spoken");

// ── Arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (flag: string) => {
  const i = argv.lastIndexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (flag: string) => argv.includes(flag);
const privateRun = has("--private");

/**
 * A path under data/, and never the developer's own database. Checked as written first (so no
 * folder is made outside data/), then again with symlinks followed and the disk's own spelling,
 * since data/BLINK.db or a link inside data/ could still reach data/blink.db.
 */
function scratchPath(raw: string, what: string, opts: { makeFolder?: boolean } = {}): string {
  const path = resolve(raw);
  const asWritten = scratchDbProblem({ base: basename(path), parentReal: dirname(path), dataReal: DATA });
  if (asWritten) throw new Error(`${what} is refused: ${asWritten}`);
  if (opts.makeFolder) mkdirSync(dirname(path), { recursive: true });
  let target: string;
  let dataReal: string;
  try {
    // The file itself is followed too when it exists, so a link named spoken.db cannot lead to blink.db.
    target = existsSync(path) ? realpathSync.native(path) : join(realpathSync.native(dirname(path)), basename(path));
    dataReal = realpathSync.native(DATA);
  } catch {
    throw new Error(`${what} is refused: its folder does not exist`);
  }
  const followed = scratchDbProblem({ base: basename(target), parentReal: dirname(target), dataReal });
  if (followed) throw new Error(`${what} is refused: ${followed}`);
  return path;
}

function pointAtDb(raw: string | undefined): string | null {
  if (!raw) return null;
  const path = scratchPath(raw, "--db");
  // Set before loadEnv, so .env.local's BLINK_DB_PATH cannot win.
  process.env.BLINK_DB_PATH = path;
  return path;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const iso = (ms: number) => new Date(ms).toISOString();
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(2)} s`);

// ── Preparing the scratch database ──────────────────────────────────────────

async function prepareDb(raw: string) {
  const path = scratchPath(raw, "--prepare-db", { makeFolder: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  process.env.BLINK_DB_PATH = path;
  // Document facts come from the committed recordings, so preparing costs nothing.
  process.env.BLINK_LLM_MODE = "replay";
  loadEnv();
  migrateDb();
  const { caseId, policyVersionId } = await seedDatabase({ manualPolicy: true });
  const ran = await drainJobs();
  const failed = getDb().select().from(jobs).where(eq(jobs.status, "failed")).all().length;
  console.log(`prepared ${relative(process.cwd(), path)}: case ${caseId}, manual policy active (${policyVersionId}), ${ran} document-facts job(s) replayed, ${failed} failed`);
  closeDb();
  if (failed > 0) process.exitCode = 1;
}

function prepareCase(callDir: string, policy: string) {
  if (!process.env.BLINK_DB_PATH) throw new Error("--prepare-case needs --db <the server's database under data/>");
  process.env.BLINK_LLM_MODE = "replay"; // nothing here calls a model
  loadEnv();
  const read = (file: string) => readFileSync(join(callDir, file), "utf8");
  const input = CreateCaseSchema.parse({ ...(JSON.parse(read("packet.json")) as Record<string, unknown>), expert: JSON.parse(read("expert.json")) as Record<string, unknown> });
  const [installed] = installPolicies([policy]);
  const caseId = transact((tx) => {
    const created = createCase(tx, input, loadActor(tx, "user_priya"));
    // The policy is never approved: the case is pointed at its version directly, as eval:real does.
    tx.update(cases).set({ activePolicyVersionId: installed.versionId }).where(eq(cases.id, created.caseId)).run();
    return created.caseId;
  });
  console.log(`case ${caseId} for call ${basename(callDir)} under ${policy} (${installed.versionId}, ${installed.coverageGaps} blocking coverage issues, not approved)`);
  closeDb();
}

// ── Speech ──────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], input?: string): Buffer {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status}): ${r.stderr.toString().slice(0, 200)}`);
  return r.stdout;
}

const toInt16 = (buf: Buffer) => new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length - (buf.length % 2))));

/** One turn read aloud by `voice`, as 16 kHz mono 16-bit samples. The words go to `say` on stdin, never on a command line. */
function speak(text: string, voice: string, scratch: string): Int16Array {
  const aiff = join(scratch, `${randomUUID()}.aiff`);
  run("say", ["-v", voice, "-o", aiff, "-f", "-"], text);
  const pcm = run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", aiff, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"]);
  rmSync(aiff, { force: true });
  return toInt16(pcm);
}

// ── Flux ────────────────────────────────────────────────────────────────────

interface FluxSocket {
  send(frame: Int16Array): void;
  finish(): Promise<void>;
  /** Wall-clock time of every unexpected close, for the outage record. */
  dropped: { atMs: number; code: number }[];
}

/** Opens one Flux socket and resolves once it is open. `onMessage` gets each text message and when it arrived. */
function openFlux(protocols: string[], onMessage: (raw: string, atMs: number) => void): Promise<FluxSocket> {
  return new Promise((resolveOpen, rejectOpen) => {
    const ws = new WebSocket(SPOKEN_FLUX_URL, protocols);
    ws.binaryType = "arraybuffer";
    let opened = false;
    let finishing = false;
    let closed: () => void = () => undefined;
    const closedP = new Promise<void>((r) => (closed = r));
    const socket: FluxSocket = {
      dropped: [],
      send(frame) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      },
      async finish() {
        finishing = true;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        await Promise.race([closedP, sleep(5000)]);
        if (ws.readyState !== WebSocket.CLOSED) ws.close();
      },
    };
    ws.onopen = () => {
      opened = true;
      resolveOpen(socket);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") onMessage(e.data, Date.now());
    };
    ws.onclose = (e: CloseEvent) => {
      closed();
      if (!opened) rejectOpen(new Error(`Flux refused the connection (code ${e.code})`));
      else if (!finishing) socket.dropped.push({ atMs: Date.now(), code: e.code });
    };
    ws.onerror = () => undefined; // onclose follows and says what happened
  });
}

/** Sends the channels frame by frame, each frame when its audio has finished, as a microphone would. */
async function stream(channels: { socket: FluxSocket; pcm: Int16Array }[], t0: number) {
  const frames = Math.ceil(Math.max(...channels.map((c) => c.pcm.length)) / FRAME_SAMPLES);
  for (let k = 0; k < frames; k++) {
    await sleep(t0 + (k + 1) * FRAME_MS - Date.now());
    for (const c of channels) {
      const frame = new Int16Array(FRAME_SAMPLES);
      frame.set(c.pcm.subarray(k * FRAME_SAMPLES, (k + 1) * FRAME_SAMPLES));
      c.socket.send(frame);
    }
  }
}

// ── The server ──────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`the server answered ${status} (${code})`);
  }
}

function client(base: string) {
  let cookie = "";
  const request = async <T>(path: string, init: { body?: unknown; key?: string; signal?: AbortSignal; method?: string } = {}): Promise<T> => {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const headers: Record<string, string> = cookie ? { cookie } : {};
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = init.key ?? randomUUID();
    }
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}), signal: init.signal ?? AbortSignal.timeout(120_000), redirect: "manual" });
    } catch (err) {
      if (init.signal?.aborted) throw err;
      throw new HttpError(0, "NETWORK");
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (!res.ok) throw new HttpError(res.status, json?.error?.code ?? "HTTP_ERROR");
    return json as T;
  };

  return {
    request,
    async signIn(asUser: string | undefined) {
      if (!asUser) {
        cookie = "blink_user=user_priya"; // the switcher cookie
        return "the switcher cookie for user_priya";
      }
      const user = DEMO_USERS.find((u) => u.id === asUser);
      if (!user) throw new Error(`--as ${asUser} is not a demo user id`);
      let passwords: Record<string, string>;
      try {
        passwords = JSON.parse(process.env.BLINK_SEED_PASSWORDS ?? "") as Record<string, string>;
      } catch {
        throw new Error("BLINK_SEED_PASSWORDS is not set or not valid JSON");
      }
      const password = passwords[user.id];
      if (!password) throw new Error(`BLINK_SEED_PASSWORDS has no password for ${user.id}`);
      const res = await fetch(`${base}/api/session/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: demoEmail(user.name), password }), redirect: "manual" });
      const token = res.headers
        .getSetCookie()
        .map((c) => /^blink_session=([^;]+)/.exec(c)?.[1])
        .find(Boolean);
      if (res.status !== 200 || !token) throw new Error(`signing in as ${user.id} failed (status ${res.status})`);
      cookie = `blink_session=${token}`;
      return `a password sign-in as ${user.id}`;
    },
    async signOut() {
      if (cookie.startsWith("blink_session=")) await request("/api/session/logout", { body: {} }).catch(() => undefined);
    },
  };
}

/** A development server compiles each route on its first request; do that before the call, so the first turn is not slowed by it. */
async function warmUp(http: ReturnType<typeof client>) {
  const id = "call_warmup_none";
  for (const path of ["/api/calls", `/api/calls/${id}/turns`, `/api/calls/${id}/acks`, `/api/calls/${id}/outages`, `/api/calls/${id}/stt-token`, `/api/calls/${id}/end`]) {
    await http.request(path, { body: {}, signal: AbortSignal.timeout(180_000) }).catch(() => undefined);
  }
}

// ── The call ────────────────────────────────────────────────────────────────

interface HeardTurn {
  seq: number;
  speaker: Channel;
  sources: string[];
  speechStartMs: number;
  speechEndMs: number;
  speechEndedAtMs: number;
  /** End of the written turns' synthetic audio this turn came from, on the wall clock. */
  audioEndedAtMs: number | null;
  pill: string;
  readStatus: string;
  shownAtMs: number;
  attempts: number;
}

const retryable = (err: unknown) => !(err instanceof HttpError) || err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;

async function runSpokenCall() {
  const transcriptPath = resolve(opt("--transcript")!);
  const caseId = opt("--case");
  if (!caseId) throw new Error("--case <caseId> is required");
  const base = new URL(opt("--server") ?? "http://localhost:3000").origin;
  const dbPath = pointAtDb(opt("--db"));
  loadEnv();
  const name = opt("--name") ?? basename(dirname(transcriptPath));
  const callDir = dirname(transcriptPath);
  const labelsFile = join(callDir, "labels.json");
  const expectRed = opt("--expect-red")?.split(",").filter(Boolean) ?? (existsSync(labelsFile) ? [...new Set((JSON.parse(readFileSync(labelsFile, "utf8")) as { labels: { turn: string }[] }).labels.map((l) => l.turn))] : []);

  // The written call, in its speakers' voices.
  const written = parseTranscript(readFileSync(transcriptPath, "utf8"), { filename: basename(transcriptPath) }).turns;
  const scratch = join(SPOKEN, "audio", `${name}-${randomUUID().slice(0, 8)}`);
  mkdirSync(scratch, { recursive: true });
  let pcm: Int16Array[];
  try {
    pcm = written.map((t) => speak(t.text, VOICES[t.speaker], scratch));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const placed = layoutTurns(
    written.map((t, i) => ({ label: t.label, role: t.speaker, durationMs: Math.round((pcm[i].length / SAMPLE_RATE) * 1000) })),
    LAYOUT,
  );
  const audio = mixChannels(placed, pcm, { sampleRate: SAMPLE_RATE, tailMs: TAIL_MS });
  const audioMinutes = audio.analyst.length / SAMPLE_RATE / 60;
  const roles = (r: SpeakerRole) => written.filter((t) => t.speaker === r).length;
  console.log(`call ${name}: ${written.length} written turns (analyst ${roles("analyst")}, expert ${roles("expert")}, moderator ${roles("moderator")}), ${audioMinutes.toFixed(1)} min of audio per channel, voices ${VOICES.analyst} / ${VOICES.expert} / ${VOICES.moderator}`);
  console.log(`server ${base}; expected red at ${expectRed.join(", ") || "nothing named"}`);

  const http = client(base);
  console.log(`signed in with ${await http.signIn(opt("--as"))}`);
  await warmUp(http);
  const { call } = await http.request<{ call: { id: string } }>("/api/calls", { body: { caseId } });
  const callPath = `/api/calls/${encodeURIComponent(call.id)}`;
  console.log(`call ${call.id} started on ${caseId}`);

  const heard: HeardTurn[] = [];
  const unreadable: number[] = [];
  const pending = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    pending.add(p);
    void p.finally(() => pending.delete(p)).catch(() => undefined);
  };
  const queue: { body: Record<string, unknown> & { seq: number }; sources: string[]; turn: FinishedTurn }[] = [];
  let pumping = false;
  let halted = false;
  let nextSeq = 1;
  let t0 = 0;

  /** A small record (an acknowledgement or an outage): a few tries with one key. */
  const postRecord = (path: string, body: unknown) =>
    track(
      (async () => {
        const key = randomUUID();
        for (let attempt = 1, wait = RETRY_FIRST_MS; attempt <= 4; attempt++, wait = Math.min(wait * 2, RETRY_MAX_MS)) {
          try {
            return await http.request(path, { body, key });
          } catch (err) {
            if (!retryable(err) || attempt === 4) return console.error(`   could not record ${path.split("/").at(-1)}: ${(err as Error).message}`);
            await sleep(wait);
          }
        }
      })(),
    );

  /** One turn until the server has it: the same seq, words and key every time, as the app sends it. */
  const sendTurn = async (item: (typeof queue)[number]) => {
    const key = randomUUID();
    let wait = RETRY_FIRST_MS;
    let downSince: number | null = null;
    let cause = "";
    for (let attempt = 1; !halted; attempt++) {
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), TURN_DEADLINE_MS);
      let reply: unknown;
      try {
        reply = await http.request<unknown>(`${callPath}/turns`, { body: item.body, key, signal: abort.signal });
        clearTimeout(deadline);
      } catch (err) {
        clearTimeout(deadline);
        const timedOut = abort.signal.aborted;
        if (!timedOut && !retryable(err)) {
          halted = true;
          console.error(`   turn ${item.body.seq} was refused: ${(err as Error).message}; the app would stop here and show broken`);
          return;
        }
        downSince ??= Date.now();
        cause = timedOut ? `turn ${item.body.seq} took more than ${TURN_DEADLINE_MS / 1000} s` : `turn ${item.body.seq}: ${(err as Error).message}`;
        await sleep(wait);
        wait = Math.min(wait * 2, RETRY_MAX_MS);
        continue;
      }
      const receivedAtMs = Date.now();
      // Reading is up again: close the outage this turn's retries opened, as the app does when a reply arrives.
      if (downSince !== null) postRecord(`${callPath}/outages`, { stage: "reading", startedAt: iso(downSince), endedAt: iso(receivedAtMs), cause, shownToBanker: receivedAtMs - downSince > BROKEN_AFTER_MS });
      if (!isTurnReply(reply)) {
        // As the app does (session.ts): the server took the turn but its answer is unusable, and asking
        // again returns the same answer. Nothing is shown or acknowledged; a momentary reading outage says why.
        unreadable.push(item.body.seq);
        postRecord(`${callPath}/outages`, { stage: "reading", startedAt: iso(receivedAtMs), endedAt: iso(receivedAtMs), cause: `the server's reply to turn ${item.body.seq} could not be read`, shownToBanker: false });
        console.error(`   T${item.body.seq}: the server's reply could not be read; nothing shown for this turn`);
        return;
      }
      const shownAtMs = Date.now();
      postRecord(`${callPath}/acks`, { seq: item.body.seq, responseReceivedAt: iso(receivedAtMs), shownAt: iso(shownAtMs) });
      const audioEnd = placed.filter((p) => item.sources.includes(p.label)).reduce<number | null>((n, p) => Math.max(n ?? 0, p.endMs), null);
      const h: HeardTurn = {
        seq: item.body.seq,
        speaker: item.turn.speaker,
        sources: item.sources,
        speechStartMs: item.turn.speechStartMs,
        speechEndMs: item.turn.speechEndMs,
        speechEndedAtMs: t0 + item.turn.speechEndMs,
        audioEndedAtMs: audioEnd === null ? null : t0 + audioEnd,
        pill: reply.pill.level,
        readStatus: reply.readStatus ?? "unknown",
        shownAtMs,
        attempts: attempt,
      };
      heard.push(h);
      console.log(`   T${String(h.seq).padEnd(3)} ${h.speaker.padEnd(7)} from ${(h.sources.join("+") || "?").padEnd(8)} pill ${h.pill.padEnd(9)} ${`read ${h.readStatus}`.padEnd(13)} ${String(h.shownAtMs - h.speechEndedAtMs).padStart(5)} ms after Flux's end of speech${h.audioEndedAtMs === null ? "" : `, ${h.shownAtMs - h.audioEndedAtMs} ms after the audio ended`}${attempt > 1 ? ` (${attempt} tries)` : ""}`);
      return;
    }
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0 && !halted) {
        await sendTurn(queue[0]);
        queue.shift();
      }
    } finally {
      pumping = false;
    }
  };

  const assembler = createTurnAssembler();
  const onTurn = (turn: FinishedTurn) => {
    const seq = nextSeq++;
    const sources = sourceTurnsOf({ channel: turn.speaker, startMs: turn.speechStartMs, endMs: turn.speechEndMs }, placed);
    queue.push({
      sources,
      turn,
      body: {
        seq,
        speaker: turn.speaker,
        text: turn.text,
        speechStartMs: Math.max(0, Math.round(turn.speechStartMs)),
        speechEndMs: Math.max(0, Math.round(turn.speechEndMs)),
        speechEndedAt: iso(t0 + turn.speechEndMs),
        transcribedAt: iso(turn.transcribedAtMs),
      },
    });
    void pump();
  };

  const mint = async () => (await http.request<{ accessToken: string }>(`${callPath}/stt-token`, { body: {} })).accessToken;
  const sockets: Record<Channel, FluxSocket> = {} as Record<Channel, FluxSocket>;
  for (const channel of ["analyst", "expert"] as const) {
    // Both sockets start their audio clocks at t0, the call clock's origin, so a Flux window is already on the call clock.
    sockets[channel] = await openFlux(["bearer", await mint()], (raw, atMs) => {
      for (const t of assembler.push({ channel, event: parseFluxMessage(raw), atMs })) onTurn(t);
    });
  }
  t0 = Date.now();
  await stream(
    (["analyst", "expert"] as const).map((c) => ({ socket: sockets[c], pcm: audio[c] })),
    t0,
  );
  await Promise.all(Object.values(sockets).map((s) => s.finish()));
  for (const [channel, s] of Object.entries(sockets)) {
    for (const d of s.dropped) {
      console.error(`   the ${channel} Flux socket closed during the call (code ${d.code}); the app would reconnect, this eval does not`);
      postRecord(`${callPath}/outages`, { stage: "transcribing", startedAt: iso(d.atMs), endedAt: null, cause: `${channel === "analyst" ? "microphone" : "computer audio"}: the speech-to-text connection closed (code ${d.code})`, shownToBanker: true });
    }
  }
  const drainUntil = Date.now() + 60_000;
  while ((queue.length > 0 || pumping) && !halted && Date.now() < drainUntil) await sleep(50);
  while (pending.size > 0) await Promise.allSettled([...pending]);
  const ended = await http.request<{ hiddenCount: number; pillText: string }>(`${callPath}/end`, { body: {} });
  console.log(`   ${ended.pillText}`);
  await http.signOut();

  // ── What the call shows ──
  heard.sort((a, b) => a.seq - b.seq);
  const toDecision = heard.map((h) => h.shownAtMs - h.speechEndedAtMs);
  const fromAudio = heard.flatMap((h) => (h.audioEndedAtMs === null ? [] : [h.shownAtMs - h.audioEndedAtMs]));
  const notRead = heard.filter((h) => h.readStatus !== "read");
  const expected = expectRed.map((label) => {
    const carrying = heard.filter((h) => h.sources.includes(label));
    return { turn: label, heardAs: carrying.map((h) => `T${h.seq}`), pills: carrying.map((h) => h.pill), red: carrying.some((h) => h.pill === "red") };
  });
  const summary = {
    name,
    caseId,
    callId: call.id,
    server: base,
    writtenTurns: written.length,
    heardTurns: heard.length,
    unreadableReplies: unreadable,
    unplacedTurns: heard.filter((h) => h.sources.length === 0).length,
    notReadLive: notRead.map((h) => ({ seq: h.seq, readStatus: h.readStatus })),
    pills: { red: heard.filter((h) => h.pill === "red").map((h) => `T${h.seq}`), amber: heard.filter((h) => h.pill === "amber").map((h) => `T${h.seq}`) },
    expectedRed: expected,
    hiddenCount: ended.hiddenCount,
    msToDecision: summarizeLatency(toDecision),
    msFromAudioEnd: summarizeLatency(fromAudio),
    audioMinutesPerChannel: Number(audioMinutes.toFixed(2)),
    deepgramMinutes: Number((audioMinutes * 2).toFixed(2)),
    deepgramUsdEstimate: Number((audioMinutes * 2 * FLUX_USD_PER_MIN).toFixed(4)),
    turns: heard.map((h) => ({ seq: h.seq, speaker: h.speaker, sources: h.sources, pill: h.pill, readStatus: h.readStatus, msToDecision: h.shownAtMs - h.speechEndedAtMs, msFromAudioEnd: h.audioEndedAtMs === null ? null : h.shownAtMs - h.audioEndedAtMs, attempts: h.attempts })),
    afterCall: null as unknown,
    writtenTurnsFlagged: null as { live: string[]; afterCall: string[] } | null,
  };
  const line = (label: string, s: { n: number; p50: number | null; p95: number | null; max: number | null }) => console.log(`   ${label}: n ${s.n} · typical ${secs(s.p50)} · 19 in 20 ${secs(s.p95)} · worst ${secs(s.max)}`);
  console.log(`\n   heard ${heard.length} turns from ${written.length} written; not read live ${notRead.length}${notRead.length ? ` (${notRead.map((h) => `T${h.seq} ${h.readStatus}`).join(", ")})` : ""}; red ${summary.pills.red.join(",") || "none"}; amber ${summary.pills.amber.join(",") || "none"}`);
  line("end of speech (Flux) to shown", summary.msToDecision);
  line("end of the audio to shown", summary.msFromAudioEnd);
  for (const e of expected) console.log(`   expected red at ${e.turn}: heard as ${e.heardAs.join("+") || "nothing"} · ${e.red ? "red" : `not red (${e.pills.join(",") || "no pill"})`}`);
  console.log(`   Deepgram: ${summary.deepgramMinutes} min of audio streamed (2 channels), about $${summary.deepgramUsdEstimate.toFixed(3)}`);

  if (dbPath) {
    const after = await afterCall(call.id, caseId, heard);
    summary.afterCall = after;
    if (after) {
      // The flags are on heard turns; say which written turns they stand for.
      const written = (labels: string[]) => [...new Set(labels.flatMap((l) => heard.find((h) => `T${h.seq}` === l)?.sources ?? []))];
      summary.writtenTurnsFlagged = { live: written([...after.flags.both, ...after.flags.liveOnly]), afterCall: written([...after.flags.both, ...after.flags.afterOnly]) };
      console.log(`   as written turns: live ${summary.writtenTurnsFlagged.live.join(",") || "none"} · after the call ${summary.writtenTurnsFlagged.afterCall.join(",") || "none"}`);
    }
  }

  const out = join(SPOKEN, "results", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`   results written to ${relative(process.cwd(), out)}`);
  const missedRed = expected.filter((e) => !e.red).length;
  process.exitCode = halted || missedRed > 0 || unreadable.length > 0 ? 1 : 0;
}

/** From the server's database: the timings as stored, the after-call read, and whether its flags match the live ones. */
async function afterCall(callId: string, caseId: string, heard: HeardTurn[]) {
  const db = getDb();
  const call = db.select().from(calls).where(eq(calls.id, callId)).get();
  if (!call?.analysisJobId) {
    console.log("   no after-call read (the call was abandoned)");
    return null;
  }
  const until = Date.now() + 15 * 60_000;
  let job = db.select().from(jobs).where(eq(jobs.id, call.analysisJobId)).get();
  while (job && (job.status === "queued" || job.status === "running") && Date.now() < until) {
    await sleep(2000);
    job = db.select().from(jobs).where(eq(jobs.id, call.analysisJobId)).get();
  }
  // Timings as the server stored them: shown_at minus speech_ended_at (Task 20's definition).
  const rows = db.select().from(callTurns).where(eq(callTurns.callId, callId)).all();
  const stored = rows.flatMap((r) => (r.shownAt ? [Date.parse(r.shownAt) - Date.parse(r.speechEndedAt)] : []));
  const storedSummary = summarizeLatency(stored);
  const sameAsClient = rows.length === heard.length && rows.every((r) => r.shownAt && heard.find((h) => h.seq === r.seq)?.shownAtMs === Date.parse(r.shownAt));

  const liveTurns = db
    .select()
    .from(callClaims)
    .where(eq(callClaims.callId, callId))
    .all()
    .filter((c) => c.flagged !== "none")
    .flatMap((c) => (JSON.parse(c.recordJson) as { quotes: { turnLabel: string }[] }).quotes.map((q) => q.turnLabel));
  const findings = eligibilityForCase(db, caseId).findings.filter((f) => f.origin === "policy" && !findingCleared(f));
  const afterTurns = loadCurrentClaims(db, caseId)
    .filter((c) => c.row.status !== "rejected" && findings.some((f) => f.claimLogicalKey === c.row.logicalKey))
    .flatMap((c) => c.turnLabels);
  const flags = compareFlags(liveTurns, afterTurns);

  const spent = db.select().from(llmCalls).where(like(llmCalls.refJson, `%${caseId}%`)).all();
  const byStage = [...new Set(spent.map((c) => c.stage))].map((stage) => {
    const mine = spent.filter((c) => c.stage === stage);
    const { usd, unpriced } = priceCalls(mine);
    return { stage, calls: mine.length, usd: Number(usd.toFixed(4)), unpriced };
  });
  const timedOut = rows.filter((r) => r.readStatus === "timeout" || r.readStatus === "error").length;

  console.log(`   after-call read: job ${job?.status ?? "missing"}`);
  console.log(`   stored timings (shown_at - speech_ended_at): n ${storedSummary.n} · typical ${secs(storedSummary.p50)} · 19 in 20 ${secs(storedSummary.p95)} · worst ${secs(storedSummary.max)} · ${sameAsClient ? "the same as the client's" : "DIFFERENT from the client's"}`);
  console.log(`   flagged turns: live ${[...new Set(liveTurns)].join(",") || "none"} · after the call ${[...new Set(afterTurns)].join(",") || "none"} · ${flags.match ? "match" : `differ (live only ${flags.liveOnly.join(",") || "none"}; after only ${flags.afterOnly.join(",") || "none"})`}`);
  for (const s of byStage) console.log(`   Anthropic ${s.stage}: ${s.calls} call(s), $${s.usd.toFixed(3)}${s.unpriced ? ` + ${s.unpriced} with no listed price` : ""}`);
  if (timedOut) console.log(`   ${timedOut} read(s) timed out or failed; a timed-out read leaves no usage behind, so its cost is unknown and not in the total`);
  return { jobStatus: job?.status ?? null, storedMsToDecision: storedSummary, storedSameAsClient: sameAsClient, flags, anthropic: byStage, readsWithUnknownCost: timedOut };
}

// ── Earnings-21 ─────────────────────────────────────────────────────────────

async function transcribeFile(id: string, minutes: number, key: string): Promise<string> {
  const dir = join(SPOKEN, "earnings21");
  const pcm = toInt16(run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-t", String(minutes * 60), "-i", join(dir, `${id}.mp3`), "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"]));
  const padded = new Int16Array(pcm.length + SAMPLE_RATE * 4); // four seconds of silence so Flux ends the last turn
  padded.set(pcm);
  const turns: string[] = [];
  const socket = await openFlux(["token", key], (raw) => {
    const e = parseFluxMessage(raw);
    if (e.kind === "end" && e.transcript.trim()) turns.push(e.transcript.trim());
  });
  await stream([{ socket, pcm: padded }], Date.now());
  await socket.finish();
  if (socket.dropped.length) console.error(`   ${id}: the Flux socket closed early (code ${socket.dropped[0].code})`);
  const text = turns.join("\n");
  writeFileSync(join(dir, `${id}.flux-${minutes}min.txt`), `${text}\n`);
  return text;
}

async function earnings21(ids: string[], minutes: number) {
  loadEnv();
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set (in the environment or .env.local)");
  const dir = join(SPOKEN, "earnings21");
  console.log(`Earnings-21: ${ids.join(", ")} · first ${minutes} min of each through Flux at real-time pace, in parallel`);
  const hyps = await Promise.all(ids.map((id) => transcribeFile(id, minutes, key)));
  const results = ids.map((id, i) => {
    const types = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(dir, `${id}.wer_tag.json`), "utf8")) as Record<string, { entity_type: string }>).map(([k, v]) => [k, v.entity_type]));
    const ref = nlpReference(readFileSync(join(dir, `${id}.nlp`), "utf8"), types);
    const hyp = normalizeWords(hyps[i]);
    const a = alignPrefix(
      ref.map((r) => r.word),
      hyp,
    );
    const numbers = tokenAccuracy(a, (j) => /\d/.test(ref[j].word));
    const orgs = tokenAccuracy(a, (j) => ref[j].entities.includes("ORG"));
    const share = (x: { correct: number; total: number }) => (x.total ? `${x.correct}/${x.total} (${((100 * x.correct) / x.total).toFixed(1)}%)` : "none");
    console.log(`   ${id}: reference words used ${a.refUsed} · hypothesis words ${hyp.length} · WER ${a.wer === null ? "n/a" : `${(100 * a.wer).toFixed(1)}%`} (sub ${a.substitutions}, del ${a.deletions}, ins ${a.insertions}) · numbers ${share(numbers)} · company names ${share(orgs)}`);
    return { id, minutes, refUsed: a.refUsed, hypWords: hyp.length, wer: a.wer, substitutions: a.substitutions, deletions: a.deletions, insertions: a.insertions, numbers, companyNames: orgs };
  });
  const total = (f: (r: (typeof results)[number]) => number) => results.reduce((n, r) => n + f(r), 0);
  const errors = total((r) => r.substitutions + r.deletions + r.insertions);
  // A file with no reference words matched would add nothing to the sums and hide that it failed.
  for (const r of results.filter((r) => r.refUsed === 0)) console.warn(`   warning: ${r.id} matched no reference words (Flux returned ${r.hypWords} words), so it adds nothing to the line below`);
  console.log(`   both: WER ${((100 * errors) / total((r) => r.refUsed)).toFixed(1)}% · numbers ${total((r) => r.numbers.correct)}/${total((r) => r.numbers.total)} · company names ${total((r) => r.companyNames.correct)}/${total((r) => r.companyNames.total)}`);
  const audioMin = ids.length * minutes;
  console.log(`   Deepgram: ${audioMin} min streamed (plus 4 s of silence each), about $${(audioMin * FLUX_USD_PER_MIN).toFixed(3)}`);
  const out = join(SPOKEN, "results", `earnings21-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ results, deepgramMinutes: audioMin }, null, 2)}\n`);
  console.log(`   results written to ${relative(process.cwd(), out)}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (opt("--prepare-db")) return prepareDb(opt("--prepare-db")!);
  if (opt("--prepare-case")) {
    pointAtDb(opt("--db"));
    return prepareCase(resolve(opt("--prepare-case")!), opt("--policy") ?? "oaktree");
  }
  if (opt("--earnings21")) return earnings21(opt("--earnings21")!.split(",").filter(Boolean), Number(opt("--minutes") ?? "10"));
  if (opt("--transcript")) return runSpokenCall();
  throw new Error("usage: pnpm eval:spoken --transcript <file> --case <caseId> [--server <url>] [--as <userId>] [--db <path>]; or --prepare-db, --prepare-case, --earnings21 (see the top of scripts/speak-call.ts)");
}

main()
  .catch((err: unknown) => {
    // A message can quote a transcript line (a parse error); for private material only its code is shown.
    console.error(`eval:spoken failed: ${privateRun ? errorCode(err) : err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
    // An idle keep-alive connection would hold the process open.
    process.exit(process.exitCode ?? 0);
  });
