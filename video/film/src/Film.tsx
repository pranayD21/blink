import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Bg, C, Dither, Eyebrow, Grain, Line, Lid, Mark, Shot, fontFamily, inn, io, out, r, rnd } from "./kit";
import T from "./timeline.json";
import RAW from "../src-rects.json";
const R = RAW as Record<string, Record<string, number[]>>;
const K = T.cues, A = T.at, B = T.B;
const on = (t: number, a: number, b: number) => t >= a && t < b;
const union = (a: number[], b: number[]) => { const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]; };
const grow = (a: number[], p: number) => [a[0] - p, a[1] - p * 1.78, a[2] + p * 2, a[3] + p * 3.56];

const Wave: React.FC<{ t: number; n?: number; w?: number; h?: number; amp?: number; color?: string }> = ({ t, n = 72, w = 900, h = 90, amp = 1, color = C.mut }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: w, height: h }}>
    {Array.from({ length: n }).map((_, i) => { const env = Math.sin((i / n) * Math.PI); const v = (0.18 + 0.82 * Math.abs(Math.sin(t * 5.1 + i * 0.55) * Math.cos(t * 2.3 + i * 0.21 + rnd(i) * 3))) * env * amp; return <span key={i} style={{ width: w / n / 2.3, height: Math.max(3, v * h), borderRadius: 9, background: color }} />; })}
  </div>
);

const SENT = [["I still have a ", 0], ["login", 1], [" to their ", 0], ["pipeline dashboard", 1], [".", 0]] as const;
const WALL = ["Thanks for making time. Could you start with a quick overview of your background?", "Distributors broadly are soft right now. Everyone overbought and they're working through inventory.", "Which end markets are weakest?", "Municipal water is fine. Oil and gas midstream is the weak spot.", "Pricing is holding, though, and lead times have come in a lot.", "How are input costs affecting manufacturers?", "Steel is the big one. Hot-rolled is up about twelve percent over six months.", "And pricing power, can manufacturers pass that through?", "Mostly yes. The industry pushed two price increases this year.", "How do you think about competitive position in the channel?"];

const Cold: React.FC<{ t: number }> = ({ t }) => {
  const total = SENT.reduce((a, s) => a + s[0].length, 0); const shown = Math.floor(r(t, 0.9, 2.9, 0, total, (x) => x)); let used = 0;
  const hot = r(t, K.redWords, K.redWords + 0.5), pull = r(t, K.wall - 0.1, K.wall + 2.3, 0, 1, io);
  const scale = 1 - pull * 0.62, sentOp = 1, wallOp = r(t, K.wall, K.wall + 1.2);
  return (
    <AbsoluteFill>
      <Bg t={t} warm={0.5} />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 60% at 50% 50%,rgba(239,68,68,${0.17 * hot * (1 - pull)}),transparent 70%)` }} />
      <AbsoluteFill style={{ transform: `scale(${scale})`, alignItems: "center", justifyContent: "center" }}>
        {Array.from({ length: 34 }).map((_, i) => { const row = i - 17; if (row === 0) return null; const scroll = (t - K.wall) * 22 * (pull > 0 ? 1 : 0); return <div key={i} style={{ position: "absolute", top: 540 + row * 104 - 34 - (scroll % 104), left: -2300 - Math.floor(rnd(i + 40) * 500), width: 9000, fontSize: 62, whiteSpace: "nowrap", color: C.mut, opacity: wallOp * (0.15 + 0.16 * rnd(i)), letterSpacing: "-0.02em" }}>{[0, 1, 2, 3, 4, 5].map((k) => WALL[(i * (k + 3) + k) % WALL.length]).join("   ")}</div>; })}
        <div style={{ position: "relative", opacity: sentOp, display: "flex", flexDirection: "column", alignItems: "center", gap: 46 }}>
          <div style={{ opacity: r(t, 0.3, 0.9) * (1 - pull), display: "flex", alignItems: "center", gap: 14, fontSize: 19, letterSpacing: "0.2em", color: C.mut, textTransform: "uppercase" }}><span style={{ width: 11, height: 11, borderRadius: 9, background: C.red, opacity: 0.55 + 0.45 * Math.sin(t * 5) }} />Expert call · {`00:14:${String(32 + Math.floor(t)).padStart(2, "0")}`}</div>
          <div style={{ fontSize: 82, letterSpacing: "-0.03em", color: C.fg, whiteSpace: "nowrap", minHeight: 100 }}>
            <span style={{ color: C.mut }}>“</span>{SENT.map(([s, h], i) => { const n = Math.max(0, Math.min(s.length, shown - used)); used += s.length; return <span key={i} style={h ? { color: `color-mix(in srgb,${C.red} ${hot * 100}%,${C.fg})`, textShadow: `0 0 ${46 * hot}px rgba(239,68,68,${0.65 * hot})` } : undefined}>{s.slice(0, n)}</span>; })}{shown >= total ? <span style={{ color: C.mut }}>”</span> : <span style={{ opacity: Math.floor(t * 4) % 2 ? 1 : 0.1 }}>|</span>}
          </div>
          <div style={{ opacity: r(t, 0.4, 1) * (1 - pull) * (1 - hot) }}><Wave t={t} amp={shown < total ? 1 : 0.32} /></div>
          <div style={{ position: "absolute", top: 232, fontSize: 25, letterSpacing: "0.3em", fontWeight: 600, color: C.red, opacity: r(t, K.inside, K.inside + 0.3) * (1 - pull), transform: `scale(${1.5 - 0.5 * r(t, K.inside, K.inside + 0.3)})`, border: `1.5px solid ${C.red}`, padding: "11px 24px 11px 30px", borderRadius: 10 }}>INSIDE INFORMATION</div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 110 }}><Line t={t} at={K.daysLater} size={92} weight={500}>Days later.</Line></AbsoluteFill>
    </AbsoluteFill>
  );
};

const Plate: React.FC<{ t: number; at: number; lid: number }> = ({ t, at, lid }) => { const a = r(t, at, at + 0.9); return (
  <div style={{ transform: `scale(${0.86 + 0.14 * a})`, opacity: a, display: "inline-flex", alignItems: "center", gap: 30, padding: "44px 74px", borderRadius: 999, background: "rgba(12,12,11,.74)", backdropFilter: "blur(20px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.28),inset 0 0 0 1px rgba(255,255,255,.1),0 40px 100px rgba(0,0,0,.6)" }}><Mark size={124} lid={lid} /><span style={{ fontSize: 104, letterSpacing: "-0.04em", color: C.fg }}>blink</span></div>
); };
const blinkLid = (t: number, at: number) => { const d = t - at; if (d < 0) return 1; if (d < 0.5) return r(d, 0, 0.5, 1, 0.08); if (d < 0.75) return 0.08; if (d < 0.9) return r(d, 0.75, 0.9, 0.08, 1, inn); if (d < 1.15) return r(d, 0.9, 1.15, 1, 0.08); return 0.08; };

const Logo: React.FC<{ t: number }> = ({ t }) => (<AbsoluteFill style={{ background: C.bg }}><Dither t={t} opacity={0.82} /><AbsoluteFill style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%,transparent 30%,rgba(0,0,0,.65))" }} /><AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Plate t={t} at={B.b1 + 0.45} lid={blinkLid(t, A.l4 - 0.3)} /></AbsoluteFill></AbsoluteFill>);

const Pill: React.FC<{ t: number }> = ({ t }) => { const red = r(t, T.pillRed, T.pillRed + 0.28); const isRed = t >= T.pillRed; const pop = isRed ? 1 + 0.07 * Math.exp(-(t - T.pillRed) * 6) * Math.cos((t - T.pillRed) * 22) : 1; return (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "13px 25px 13px 21px", borderRadius: 999, background: "#17160f", color: isRed ? C.fg : C.mut, fontSize: 25, fontWeight: isRed ? 500 : 400, whiteSpace: "nowrap", transform: `scale(${pop})`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.14),0 14px 40px rgba(0,0,0,.5),0 0 ${70 * red}px rgba(239,68,68,${0.5 * red})` }}><span style={{ width: 14, height: 14, borderRadius: 9, background: isRed ? C.red : C.green }} />{isRed ? "Sounds like inside information. Move on." : "Listening"}</div>
); };
const Tile: React.FC<{ t: number; i: string; name: string; role: string; talk: number }> = ({ t, i, name, role, talk }) => (
  <div style={{ position: "relative", flex: 1, borderRadius: 26, background: "linear-gradient(160deg,#211f1b,#12110f)", boxShadow: `inset 0 0 0 ${talk ? 2 : 1}px rgba(246,241,232,${talk ? 0.5 : 0.07})` }}>
    <div style={{ position: "absolute", left: "50%", top: "46%", transform: `translate(-50%,-50%) scale(${1 + talk * 0.03 * Math.sin(t * 9)})`, width: 170, height: 170, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 58, color: C.fg, background: "linear-gradient(160deg,#3b3933,#25241f)" }}>{i}</div>
    <div style={{ position: "absolute", left: "50%", top: "74%", transform: "translateX(-50%)", opacity: talk }}><Wave t={t + i.length} n={26} w={230} h={44} color={C.fg} /></div>
    <div style={{ position: "absolute", left: 26, bottom: 22, fontSize: 22, color: C.fg }}>{name}<span style={{ color: C.mut, marginLeft: 10 }}>{role}</span></div>
  </div>
);
const Live: React.FC<{ t: number }> = ({ t }) => {
  const a = r(t, T.liveStart, T.liveStart + 0.8), zoom = r(t, T.pillRed - 0.25, T.pillRed + 0.55, 0, 1, io), dim = r(t, K.noTranscript - 0.5, K.noTranscript) * (1 - r(t, K.onlyThis, K.onlyThis + 0.5)), expert = Math.floor((t - T.liveStart) / 2.4) % 2 === 0 ? 1 : 0, blackout = r(t, T.pillRed - 0.05, T.pillRed + 0.5);
  const turns = Math.max(0, Math.floor((t - K.everyTurn + 0.2) * 3.2));
  return (
    <AbsoluteFill>
      <Bg t={t} />
      <div style={{ position: "absolute", left: 90, right: 90, top: 60, bottom: 60, opacity: a, transform: `translateY(${(1 - a) * 40 + zoom * 300}px) scale(${1 + zoom * 1.05})`, transformOrigin: "50% 5%", borderRadius: 30, background: "#0d0c0b", boxShadow: "0 0 0 1px rgba(255,255,255,.09),0 50px 130px rgba(0,0,0,.7)" }}>
        <div style={{ position: "absolute", inset: "104px 34px 118px", display: "flex", gap: 22, opacity: 1 - dim * 0.72 - blackout * 0.62 }}><Tile t={t} i="RC" name="R. Castellano" role="Expert" talk={expert} /><Tile t={t} i="PR" name="Priya Raman" role="Banker" talk={1 - expert} /></div>
        <div style={{ position: "absolute", left: "50%", bottom: 30, transform: "translateX(-50%)", display: "flex", gap: 16, opacity: 1 - blackout * 0.7 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 58, height: 58, borderRadius: 99, background: "#272520" }} />)}<span style={{ width: 84, height: 58, borderRadius: 99, background: "#b3261e" }} /></div>
        <div style={{ position: "absolute", top: 28, left: 0, right: 0, display: "flex", justifyContent: "center" }}><Pill t={t} /></div>
      </div>
      {on(t, K.listens - 0.2, K.noTranscript - 0.45) && <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 170 }}>
        <div style={{ padding: "28px 44px", borderRadius: 26, background: "rgba(8,8,7,.8)", backdropFilter: "blur(18px)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)", opacity: r(t, K.listens - 0.2, K.listens + 0.2) * (1 - r(t, K.noTranscript - 0.85, K.noTranscript - 0.45)), textAlign: "center" }}>
          <Line t={t} at={K.listens} size={46}>Listens along.</Line>
          <Line t={t} at={K.everyTurn} size={46} color={C.mut}>Reads every turn against your firm's policy.</Line>
          <div style={{ display: "flex", gap: 9, justifyContent: "center", marginTop: 20 }}>{Array.from({ length: 12 }).map((_, i) => <span key={i} style={{ fontSize: 17, padding: "6px 11px", borderRadius: 9, color: i < turns ? C.bg : C.dim, background: i < turns ? C.fg : "rgba(255,255,255,.06)", fontWeight: 600 }}>T{i + 1}</span>)}</div>
        </div></AbsoluteFill>}
      {on(t, K.noTranscript - 0.6, T.pillRed) && <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 40 }}>
        <Line t={t} at={K.noTranscript - 0.45} size={92} until={K.onlyThis - 0.15} weight={500}>No transcript.</Line><Line t={t} at={K.noSugg - 0.2} size={92} until={K.onlyThis - 0.15} weight={500}>No suggestions.</Line><Line t={t} at={K.noNoise - 0.15} size={92} until={K.onlyThis - 0.15} weight={500}>No noise.</Line>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 40 }}><Line t={t} at={K.onlyThis} size={92} until={T.pillRed - 0.3} weight={500}>Only this.</Line></AbsoluteFill></AbsoluteFill>}
    </AbsoluteFill>
  );
};

type Seg = string | [string, number];
const TURNS: { who: string; l: string; segs: Seg[] }[] = [
  { who: "R. Castellano", l: "T5", segs: ["Honestly, ", ["orders fell off a cliff. They're down about twenty percent.", 0]] },
  { who: "Priya", l: "T6", segs: ["Is that something you're seeing across distributors generally?"] },
  { who: "R. Castellano", l: "T7", segs: ["Distributors broadly are soft right now. Everyone overbought in 2025."] },
  { who: "Priya", l: "T10", segs: ["Going back to the twenty percent, where does that number come from?"] },
  { who: "R. Castellano", l: "T11", segs: ["That's their West region, this quarter. ", ["I still have a login to their pipeline dashboard in Salesforce.", 1], " ", ["They never shut it off when I left.", 2]] },
  { who: "Priya", l: "T14", segs: ["How do you think about their competitive position versus Brightwater?"] },
  { who: "R. Castellano", l: "T15", segs: ["Brightwater has been aggressive on price in utilities. And between us, ", ["the Cardinal Utilities contract is being re-bid and Halvorsen is out.", 3]] },
];
const After: React.FC<{ t: number }> = ({ t }) => {
  const a = r(t, T.afterStart, T.afterStart + 0.8), scan = r(t, K.reads8 - 0.1, K.hides - 0.1, 0, 1, (x) => x), card = r(t, K.sends - 0.1, K.sends + 0.6);
  return (
    <AbsoluteFill style={{ opacity: a }}>
      <Bg t={t} />
      <div style={{ position: "absolute", left: 110, top: 300, width: 590 }}>
        <Eyebrow t={t} at={T.afterStart + 0.2}>After the call</Eyebrow>
        <Line t={t} at={K.nothingLost} size={76} weight={500}>Nothing is lost.</Line>
        <div style={{ height: 34 }} />
        <Line t={t} at={K.reads8} size={44} color={C.mut}>The whole transcript, read again.</Line>
        <div style={{ height: 14 }} />
        <Line t={t} at={K.hides} size={44} color={C.mut}>Every flagged passage, hidden.</Line>
      </div>
      <div style={{ position: "absolute", right: 90, top: 96, width: 1010, height: 888, borderRadius: 26, background: "#100f0d", overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,.09),0 50px 120px rgba(0,0,0,.6)", padding: "36px 46px", transform: `translateY(${(1 - a) * 50}px)` }}>
        {TURNS.map((u, i) => <div key={u.l} style={{ display: "flex", gap: 24, marginBottom: 26, fontSize: 25, lineHeight: 1.42 }}><span style={{ color: C.dim, width: 44, flex: "none", paddingTop: 1 }}>{u.l}</span><div><div style={{ color: C.mut, fontSize: 20, marginBottom: 3 }}>{u.who}</div><div style={{ color: C.fg }}>{u.segs.map((s, j) => { if (typeof s === "string") return <span key={j}>{s}</span>; const rowY = (i + 0.7) / TURNS.length; const hit = r(scan, rowY - 0.04, rowY + 0.02); const wipeAt = K.hides + 0.1 + s[1] * 0.3; const wipe = r(t, wipeAt, wipeAt + 0.42, 0, 1, io); return <span key={j} style={{ position: "relative", display: "inline", color: wipe >= 1 ? "transparent" : undefined, background: wipe >= 1 ? "#46433c" : `linear-gradient(90deg,#46433c ${wipe * 100}%,rgba(239,68,68,${0.3 * hit}) ${wipe * 100}%)`, borderRadius: 5, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", padding: "1px 3px" }}>{s[0]}</span>; })}</div></div></div>)}
        {scan > 0 && scan < 1 && <div style={{ position: "absolute", left: 0, right: 0, top: scan * 888, height: 2, background: C.fg, boxShadow: "0 0 34px 8px rgba(246,241,232,.35)" }} />}
        <div style={{ position: "absolute", left: "50%", bottom: 34, transform: `translate(-50%,${(1 - card) * 40}px)`, opacity: card, display: "inline-flex", alignItems: "center", gap: 12, padding: "14px 26px 14px 22px", borderRadius: 999, background: "#1a1913", fontSize: 25, fontWeight: 500, color: C.fg, whiteSpace: "nowrap", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16),0 20px 60px rgba(0,0,0,.6)" }}><span style={{ width: 14, height: 14, borderRadius: 9, background: C.green }} />Call ended. 4 passages hidden and sent to compliance.</div>
      </div>
    </AbsoluteFill>
  );
};

const SX = 630, SY = 186, SW = 1230; // the product window
const Text: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ position: "absolute", left: 84, top: 0, bottom: 0, width: 505, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>;

const Review: React.FC<{ t: number }> = ({ t }) => { const f = R["review-f1"], tr = R["review-trace"]; const q = union(f.t5, f.t11); return (
  <AbsoluteFill><Bg t={t} /><Text><Eyebrow t={t} at={T.reviewStart + 0.2}>Compliance</Eyebrow><Line t={t} at={K.quotes} size={66} weight={500}>The exact quotes.</Line><div style={{ height: 16 }} /><Line t={t} at={K.rule} size={66} weight={500}>The rule that fired.</Line><div style={{ height: 16 }} /><Line t={t} at={K.why} size={66} weight={500}>And why.</Line></Text>
  <Shot t={t} x={SX} y={SY} w={SW} enter={T.reviewStart} shots={[{ src: "review-f1", at: 0 }, { src: "review-trace", at: K.rule }]} cams={[{ at: K.quotes - 0.3, rect: grow(q, 0.03) }, { at: K.rule - 0.15, rect: grow(tr.r1, 0.02) }]} spots={[{ from: K.quotes + 0.25, to: K.rule - 0.3, rect: q }, { from: K.rule + 0.5, to: T.kineticStart, rect: tr.r1, color: C.red }]} /></AbsoluteFill>
); };
const Kinetic: React.FC<{ t: number }> = ({ t }) => { const hi = (a: number, b: number) => (t >= b ? C.dim : C.fg); return (
  <AbsoluteFill style={{ opacity: r(t, T.kineticStart, T.kineticStart + 0.35) }}><Bg t={t} /><AbsoluteFill style={{ justifyContent: "center", paddingLeft: 240, gap: 12 }}>
    <Line t={t} at={A.l10a} size={118} weight={500} color={hi(A.l10a, A.l10b)}>A model reads.</Line><Line t={t} at={A.l10b} size={118} weight={500} color={hi(A.l10b, A.l10c)}>Code applies the policy.</Line><Line t={t} at={A.l10c} size={118} weight={500}>A person decides.</Line></AbsoluteFill></AbsoluteFill>
); };
const Policy: React.FC<{ t: number }> = ({ t }) => { const v = R["policy-validation"], ac = R["policy-active"]; return (
  <AbsoluteFill style={{ opacity: r(t, T.policyStart, T.policyStart + 0.35) }}><Bg t={t} /><Text><Eyebrow t={t} at={T.policyStart + 0.1}>Policy</Eyebrow><Line t={t} at={A.l11} size={66} weight={500}>Your rules.</Line><div style={{ height: 22 }} /><Line t={t} at={K.written} size={40} color={C.mut}>Written in plain English.</Line><div style={{ height: 10 }} /><Line t={t} at={K.compiled} size={40} color={C.mut}>Compiled into monitors.</Line><div style={{ height: 10 }} /><Line t={t} at={K.tested} size={40} color={C.mut}><span style={{ color: C.fg }}>1,156</span> evidence combinations, tested.</Line><div style={{ height: 10 }} /><Line t={t} at={K.approved} size={40} color={C.mut}>Approved by hash.</Line></Text>
  <Shot t={t} x={SX} y={SY} w={SW} enter={T.policyStart + 0.05} shots={[{ src: "policy-new", at: 0 }, { src: "policy-monitors", at: K.compiled - 0.15 }, { src: "policy-validation", at: K.tested - 0.15 }, { src: "policy-active", at: K.approved - 0.15 }]} cams={[{ at: K.written - 0.1, rect: grow(R["policy-new"].text, 0.02) }, { at: K.compiled - 0.15, rect: grow(R["policy-monitors"].graph, 0.02) }, { at: K.tested - 0.15, rect: grow(v.summary, 0.03) }, { at: K.approved - 0.15, rect: [0.1, 0.05, 0.62, 0.62] }]} spots={[{ from: K.tested + 0.5, to: K.approved - 0.3, rect: v.summary }, { from: K.approved + 0.6, to: T.briefStart, rect: ac.status, color: C.green }]} /></AbsoluteFill>
); };
const Brief: React.FC<{ t: number }> = ({ t }) => { const d = R["brief-draft"], s = R["brief-released"]; return (
  <AbsoluteFill style={{ opacity: r(t, T.briefStart, T.briefStart + 0.35) }}><Bg t={t} /><Text><Eyebrow t={t} at={T.briefStart + 0.1}>Release</Eyebrow><Line t={t} at={K.drafted} size={62} weight={500}>Drafted from cleared statements alone.</Line><div style={{ height: 22 }} /><Line t={t} at={K.every12} size={44} color={C.mut}>Every sentence cited.</Line></Text>
  <Shot t={t} x={SX} y={SY} w={SW} enter={T.briefStart + 0.05} shots={[{ src: "brief-draft", at: 0 }, { src: "brief-released", at: K.cited + 0.35 }]} cams={[{ at: K.drafted - 0.1, rect: [0.14, 0.22, 0.5, 0.5] }, { at: K.every12 - 0.1, dur: 0.8, rect: [0.14, 0.24, 0.3, 0.3] }, { at: K.cited + 0.3, dur: 0.7, rect: grow(s.success, 0.06) }]} spots={[{ from: K.every12, to: K.cited + 0.25, rect: d.cite }, { from: K.cited + 0.7, to: B.b3, rect: s.success, color: C.green }]} /></AbsoluteFill>
); };
const Banker: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill><Bg t={t} /><Text><Eyebrow t={t} at={T.bankerStart + 0.2}>Banker</Eyebrow><Line t={t} at={A.l13} size={62} weight={500}>Only what was released.</Line><div style={{ height: 22 }} /><Line t={t} at={K.blank} size={44} color={C.mut}>Restricted passages are blank.</Line><div style={{ height: 14 }} /><Line t={t} at={K.hidden13} size={44} color={C.mut}>The hidden words never reach the browser.</Line></Text>
  <Shot t={t} x={SX} y={SY} w={SW} enter={T.bankerStart} shots={[{ src: "banker-transcript", at: 0 }, { src: "banker-transcript2", at: K.blank - 0.15 }]} cams={[{ at: T.bankerStart + 0.5, dur: 1.6, rect: [0.1, 0.2, 0.68, 0.68] }, { at: K.blank - 0.15, dur: 1.2, rect: [0.08, 0.06, 0.62, 0.62] }, { at: K.hidden13, dur: 2.2, rect: [0.08, 0.3, 0.62, 0.62] }]} /></AbsoluteFill>
);
const Trust: React.FC<{ t: number }> = ({ t }) => { const a = R.audit; return (
  <AbsoluteFill style={{ opacity: r(t, T.trustStart, T.trustStart + 0.35) }}><Bg t={t} /><Text><Eyebrow t={t} at={T.trustStart + 0.1}>Proof</Eyebrow><Line t={t} at={K.tamper} size={62} weight={500}>A tamper-evident audit log.</Line><div style={{ height: 22 }} /><Line t={t} at={K.measured} size={44} color={C.mut}>Every call measured.</Line><div style={{ height: 14 }} /><Line t={t} at={K.misses} size={44} color={C.fg}>Even the misses.</Line></Text>
  <Shot t={t} x={SX} y={SY} w={SW} enter={T.trustStart + 0.05} shots={[{ src: "audit", at: 0 }, { src: "calls", at: K.measured - 0.15 }, { src: "call-record", at: K.misses - 0.15 }]} cams={[{ at: K.tamper - 0.1, rect: [0.1, 0.1, 0.62, 0.62] }, { at: K.measured - 0.15, rect: [0.2, 0.08, 0.6, 0.6] }, { at: K.misses - 0.15, dur: 0.8, rect: [0.2, 0.55, 0.45, 0.45] }]} spots={[{ from: K.tamper + 0.4, to: K.measured - 0.3, rect: a.ok, color: C.green }, { from: K.misses + 0.5, to: B.b4, rect: [0.272, 0.872, 0.24, 0.028], color: C.amber }]} /></AbsoluteFill>
); };
const Close: React.FC<{ t: number }> = ({ t }) => { const d = r(t, T.logo2 - 0.3, T.logo2 + 0.9), txt = 1 - r(t, T.logo2 - 0.5, T.logo2); return (
  <AbsoluteFill style={{ background: C.bg }}><Bg t={t} warm={0.6} /><Dither t={t} opacity={0.82 * d} /><AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 60% at 50% 50%,transparent 30%,rgba(0,0,0,${0.65 * d}))` }} />
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 10, opacity: txt }}><Line t={t} at={K.talk} size={112} weight={500}>Talk freely.</Line><Line t={t} at={K.decides} size={112} weight={500} color={C.mut}>Compliance decides the rest.</Line></AbsoluteFill>
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Plate t={t} at={T.logo2} lid={blinkLid(t, A.l16 - 0.1)} /></AbsoluteFill>
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 44 }}><div style={{ fontSize: 17, color: C.fg, opacity: 0.62 * r(t, A.l16 + 0.9, A.l16 + 1.5), background: "rgba(0,0,0,.6)", padding: "7px 16px", borderRadius: 8 }}>Synthetic demo data. The call, pill and transcript scenes are illustrative; the product screens are real.</div></AbsoluteFill></AbsoluteFill>
); };

export const Film: React.FC = () => {
  const f = useCurrentFrame(), t = f / 60, mid = (b: number) => b + 0.42;
  const fadeIn = r(t, 0, 0.9), fadeOut = 1 - r(t, T.total - 1.1, T.total - 0.1, 0, 1, io);
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily, color: C.fg, WebkitFontSmoothing: "antialiased" }}>
      <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
        {t < mid(B.b1) && <Cold t={t} />}
        {on(t, mid(B.b1), T.liveStart + 0.9) && <Logo t={t} />}
        {on(t, T.liveStart, T.afterStart + 0.9) && <div style={{ position: "absolute", inset: 0, opacity: r(t, T.liveStart, T.liveStart + 0.7) }}><Live t={t} /></div>}
        {on(t, T.afterStart, mid(B.b2)) && <After t={t} />}
        {on(t, mid(B.b2), T.kineticStart + 0.4) && <Review t={t} />}
        {on(t, T.kineticStart, T.policyStart + 0.4) && <Kinetic t={t} />}
        {on(t, T.policyStart, T.briefStart + 0.4) && <Policy t={t} />}
        {on(t, T.briefStart, mid(B.b3)) && <Brief t={t} />}
        {on(t, mid(B.b3), T.trustStart + 0.4) && <Banker t={t} />}
        {on(t, T.trustStart, mid(B.b4)) && <Trust t={t} />}
        {t >= mid(B.b4) && <Close t={t} />}
        {[B.b1, B.b2, B.b3, B.b4].map((b) => <Lid key={b} t={t} at={b} />)}
        <Grain f={f} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
