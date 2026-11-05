// Pure helpers: UCI parsing, win %, move classification, accuracy.
// Evals are WHITE point of view: { cp } or { mate } (mate > 0 = white mates).
// Terminal positions: { cp: ±100000 | 0, final: "mate" | "draw" }.

export function parseInfo(line) {
  if (!line.startsWith("info ") || !line.includes(" score ") || !line.includes(" pv ")) return null;
  if (/ (lowerbound|upperbound)/.test(line)) return null;
  const mp = line.match(/ multipv (\d+)/);
  if (mp && mp[1] !== "1") return null;
  const sc = line.match(/ score (cp|mate) (-?\d+)/);
  if (!sc) return null;
  return {
    depth: +(line.match(/ depth (\d+)/) || [0, 0])[1],
    kind: sc[1],
    value: +sc[2],
    pv: line.split(" pv ")[1].trim().split(/\s+/),
  };
}

export function toWhitePov(info, whiteToMove) {
  const s = whiteToMove ? 1 : -1;
  return info.kind === "mate" ? { mate: s * info.value } : { cp: s * info.value };
}

export function whiteWinPct(ev) {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(ev) {
  if (!ev) return "…";
  if (ev.final === "mate") return "#";
  if (ev.final === "draw") return "½";
  if (ev.mate !== undefined) return `${ev.mate > 0 ? "" : "-"}M${Math.abs(ev.mate)}`;
  const p = ev.cp / 100;
  return (p > 0 ? "+" : "") + p.toFixed(1);
}

// before/after: white-POV evals around the move. mover: "w" | "b".
export function classify(before, after, mover, playedUci, bestUci) {
  const wb = whiteWinPct(before), wa = whiteWinPct(after);
  const pb = mover === "w" ? wb : 100 - wb;
  const pa = mover === "w" ? wa : 100 - wa;
  const drop = Math.max(0, pb - pa);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
  let kind = "good";
  if (playedUci === bestUci || after.final === "mate") kind = "best";
  else if (drop >= 20) kind = "blunder";
  else if (drop >= 10) kind = "mistake";
  else if (drop >= 5) kind = "inacc";
  return { kind, drop, accuracy };
}

export const TAG = { best: "★", good: "", inacc: "?!", mistake: "?", blunder: "??" };
export const KIND_NAME = { best: "Melhor lance", good: "Bom lance", inacc: "Imprecisão", mistake: "Erro", blunder: "Blunder" };
