/**
 * Transcript parsing (§10.1). Deterministic.
 *
 * Accepted formats:
 *  - .txt   lines like `[00:03:12] Analyst (Priya): text…` or `Expert: text…`
 *  - .vtt   WebVTT; cues are merged by speaker
 *  - .json  `[{speaker, name?, text}]`
 *
 * Line endings are normalized and the raw text is kept. Each turn records its
 * `startChar`/`endChar` in the raw text. Turn ids are stable strings T1…Tn
 * per version.
 */

export type SpeakerRole = "analyst" | "expert" | "moderator";
export type TranscriptFormat = "txt" | "vtt" | "json";

export interface ParsedTurn {
  idx: number; // 1-based
  label: string; // "T1"
  speaker: SpeakerRole;
  /** The label as written in the source, e.g. "Analyst". */
  speakerLabel: string;
  speakerName: string;
  timestamp: string | null;
  startChar: number;
  endChar: number;
  text: string;
}

export interface ParsedTranscript {
  format: TranscriptFormat;
  rawText: string;
  turns: ParsedTurn[];
  /** Speaker labels that did not map to a known role; they default to `moderator` until mapped. */
  unknownSpeakers: string[];
}

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

const KNOWN_ROLES: Record<string, SpeakerRole> = {
  analyst: "analyst",
  interviewer: "analyst",
  client: "analyst",
  expert: "expert",
  advisor: "expert",
  consultant: "expert",
  moderator: "moderator",
  operator: "moderator",
  compliance: "moderator",
};

export function normalizeLineEndings(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function detectFormat(text: string, filename?: string | null): TranscriptFormat {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "vtt") return "vtt";
  if (ext === "json") return "json";
  if (ext === "txt") return "txt";
  const head = text.trimStart();
  if (head.startsWith("WEBVTT")) return "vtt";
  if (head.startsWith("[") && /^\[\s*\{/.test(head)) return "json";
  return "txt";
}

function resolveRole(label: string, speakerMap: Readonly<Record<string, SpeakerRole>>, unknown: Set<string>): SpeakerRole {
  const key = label.trim();
  const mapped = speakerMap[key] ?? speakerMap[key.toLowerCase()];
  if (mapped) return mapped;
  const known = KNOWN_ROLES[key.toLowerCase()];
  if (known) return known;
  unknown.add(key);
  return "moderator";
}

const SPEAKER_LINE = /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\][ \t]*)?([A-Za-z][A-Za-z0-9 .'&/-]{0,40}?)(?:[ \t]*\(([^)\n]{0,60})\))?:[ \t]+(?=\S)/;

interface RawTurn {
  speakerLabel: string;
  speakerName: string;
  timestamp: string | null;
  startChar: number;
  endChar: number;
  text: string;
}

function parseTxt(raw: string): RawTurn[] {
  const turns: RawTurn[] = [];
  let offset = 0;
  for (const line of raw.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    if (!line.trim()) continue;
    const m = SPEAKER_LINE.exec(line);
    if (m) {
      const textStart = lineStart + m[0].length;
      const text = line.slice(m[0].length).replace(/\s+$/, "");
      turns.push({
        speakerLabel: m[2].trim(),
        speakerName: (m[3] ?? "").trim(),
        timestamp: m[1] ?? null,
        startChar: textStart,
        endChar: textStart + text.length,
        text,
      });
    } else if (turns.length > 0) {
      // Continuation line: extend the previous turn through the end of this line.
      const prev = turns[turns.length - 1];
      const end = lineStart + line.replace(/\s+$/, "").length;
      prev.endChar = end;
      prev.text = raw.slice(prev.startChar, end);
    } else {
      throw new TranscriptParseError(`line 1 has no speaker label: "${line.slice(0, 60)}"`);
    }
  }
  return turns;
}

const VTT_TIMING = /^(\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+/;

function parseVtt(raw: string): RawTurn[] {
  const turns: RawTurn[] = [];
  const lines = raw.split("\n");
  let offset = 0;
  let cueTime: string | null = null;
  let inCue = false;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (!line.trim()) {
      inCue = false;
      continue;
    }
    if (VTT_TIMING.test(line)) {
      cueTime = line.trim().split(/\s+/)[0].replace(/[.,]\d{3}$/, "");
      inCue = true;
      continue;
    }
    if (!inCue) continue; // header, NOTE blocks, cue identifiers
    let speakerLabel = "";
    let speakerName = "";
    let body = line;
    let bodyStart = lineStart;
    const voice = /^<v(?:\.[\w.-]+)?\s+([^>]+)>/.exec(line);
    if (voice) {
      body = line.slice(voice[0].length).replace(/<\/v>\s*$/, "");
      bodyStart = lineStart + voice[0].length;
      const named = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(voice[1]);
      speakerLabel = (named ? named[1] : voice[1]).trim();
      speakerName = named ? named[2].trim() : "";
    } else {
      const m = SPEAKER_LINE.exec(line);
      if (m) {
        speakerLabel = m[2].trim();
        speakerName = (m[3] ?? "").trim();
        body = line.slice(m[0].length);
        bodyStart = lineStart + m[0].length;
      }
    }
    const text = body.replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    const prev = turns[turns.length - 1];
    const sameSpeaker = prev && (speakerLabel === "" || (prev.speakerLabel === speakerLabel && prev.speakerName === speakerName));
    if (sameSpeaker) {
      prev.text = `${prev.text} ${text}`;
      prev.endChar = bodyStart + body.length;
    } else {
      if (!speakerLabel) throw new TranscriptParseError(`cue at ${cueTime ?? "?"} has no speaker (use <v Name> or "Name: text")`);
      turns.push({ speakerLabel, speakerName, timestamp: cueTime, startChar: bodyStart, endChar: bodyStart + body.length, text });
    }
  }
  return turns;
}

function parseJson(raw: string): RawTurn[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new TranscriptParseError(`invalid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) throw new TranscriptParseError("JSON transcript must be an array of {speaker, name?, text}");
  const turns: RawTurn[] = [];
  let cursor = 0;
  data.forEach((item, i) => {
    if (!item || typeof item !== "object") throw new TranscriptParseError(`item ${i + 1} is not an object`);
    const { speaker, name, text } = item as Record<string, unknown>;
    if (typeof speaker !== "string" || typeof text !== "string") throw new TranscriptParseError(`item ${i + 1} needs string "speaker" and "text"`);
    const body = text.trim();
    if (!body) return;
    // Locate the text in the raw JSON so offsets point at the source; fall back to the cursor.
    const encoded = JSON.stringify(text).slice(1, -1);
    const at = raw.indexOf(encoded, cursor);
    const startChar = at >= 0 ? at : cursor;
    const endChar = at >= 0 ? at + encoded.length : cursor;
    if (at >= 0) cursor = endChar;
    turns.push({ speakerLabel: speaker.trim(), speakerName: typeof name === "string" ? name.trim() : "", timestamp: null, startChar, endChar, text: body });
  });
  return turns;
}

export function parseTranscript(
  input: string,
  options: { filename?: string | null; speakerMap?: Readonly<Record<string, SpeakerRole>> } = {},
): ParsedTranscript {
  const rawText = normalizeLineEndings(input);
  if (!rawText.trim()) throw new TranscriptParseError("the transcript is empty");
  const format = detectFormat(rawText, options.filename);
  const raw = format === "vtt" ? parseVtt(rawText) : format === "json" ? parseJson(rawText) : parseTxt(rawText);
  if (raw.length === 0) throw new TranscriptParseError("no speaker turns were found");

  const unknown = new Set<string>();
  const turns: ParsedTurn[] = raw.map((t, i) => ({
    idx: i + 1,
    label: `T${i + 1}`,
    speaker: resolveRole(t.speakerLabel, options.speakerMap ?? {}, unknown),
    speakerLabel: t.speakerLabel,
    speakerName: t.speakerName,
    timestamp: t.timestamp,
    startChar: t.startChar,
    endChar: t.endChar,
    text: t.text,
  }));
  return { format, rawText, turns, unknownSpeakers: [...unknown] };
}
