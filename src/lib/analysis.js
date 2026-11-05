import { Chess } from "chess.js";

// Pure helpers: UCI parsing, win %, move classification, accuracy.
// Evals are WHITE point of view: { cp } or { mate } (mate > 0 = white mates).
// Terminal positions: { cp: ±100000 | 0, final: "mate" | "draw" }.

export function parseInfo(line) {
  if (!line.startsWith("info ") || !line.includes(" score ") || !line.includes(" pv ")) return null;
  if (/ (lowerbound|upperbound)/.test(line)) return null;
  const sc = line.match(/ score (cp|mate) (-?\d+)/);
  if (!sc) return null;
  return {
    multipv: +((line.match(/ multipv (\d+)/) || [0, 1])[1]),
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
  if (!ev) return 50;
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export const moverWinPct = (ev, color) => (color === "w" ? whiteWinPct(ev) : 100 - whiteWinPct(ev));

export function formatEval(ev) {
  if (!ev) return "…";
  if (ev.final === "mate") return "#";
  if (ev.final === "draw") return "½";
  if (ev.mate !== undefined) return `${ev.mate > 0 ? "" : "-"}M${Math.abs(ev.mate)}`;
  const p = ev.cp / 100;
  return (p > 0 ? "+" : "") + p.toFixed(1);
}

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Piece left en prise on purpose: moved piece (≥ minor) can be taken by a cheaper
// piece, or is attacked and undefended, and the move did not win equal material.
export function isSacrifice(fenBefore, uci) {
  const c = new Chess(fenBefore);
  let mv;
  try { mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return false; }
  const piece = mv.promotion || mv.piece;
  if (VAL[piece] < 3) return false;
  const opp = mv.color === "w" ? "b" : "w";
  const attackers = c.attackers(mv.to, opp);
  if (!attackers.length) return false;
  const gained = mv.captured ? VAL[mv.captured] : 0;
  if (gained >= VAL[piece]) return false;
  const cheapest = Math.min(...attackers.map((sq) => VAL[c.get(sq).type] || 99));
  const defended = c.attackers(mv.to, mv.color).length > 0;
  return cheapest < VAL[piece] - gained || !defended;
}

/**
 * Classify move i.
 * ctx: { before, after, second, mover, played, best, fenBefore, book, prevKind }
 *   before/after: white-POV evals; second: white-POV eval of 2nd best line (or null)
 */
export function classify(ctx) {
  const { before, after, second, mover, played, best, fenBefore, book, prevKind } = ctx;
  const pb = moverWinPct(before, mover);
  const pa = moverWinPct(after, mover);
  const drop = Math.max(0, pb - pa);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));

  let kind;
  if (book) kind = "book";
  else if (after.final === "mate") kind = "best";
  else if (drop < 2 && pa >= 45 && pb < 97 && isSacrifice(fenBefore, played)) kind = "brilliant";
  else if (played === best && second && pb - moverWinPct(second, mover) >= 18 && pb < 97) kind = "great";
  else if (played === best) kind = "best";
  else if (drop < 2) kind = "excellent";
  else if (drop < 5) kind = "good";
  else if (["mistake", "blunder", "miss"].includes(prevKind) && drop >= 10 && pa >= 35) kind = "miss";
  else if (drop < 10) kind = "inacc";
  else if (drop < 20) kind = "mistake";
  else kind = "blunder";
  return { kind, drop, accuracy };
}

export const KINDS = {
  brilliant: { tag: "!!", name: "Brilhante", color: "#1baca6" },
  great: { tag: "!", name: "Ótimo lance", color: "#5c8bb0" },
  best: { tag: "★", name: "Melhor lance", color: "#81b64c" },
  excellent: { tag: "✓", name: "Excelente", color: "#96bc4b" },
  good: { tag: "✓", name: "Bom", color: "#97af8b" },
  book: { tag: "≡", name: "Teoria", color: "#a88865" },
  inacc: { tag: "?!", name: "Imprecisão", color: "#f0c15c" },
  mistake: { tag: "?", name: "Erro", color: "#e58f2a" },
  miss: { tag: "✕", name: "Oportunidade perdida", color: "#ee6b55" },
  blunder: { tag: "??", name: "Capivarada", color: "#ca3431" },
};
export const KIND_ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "inacc", "mistake", "miss", "blunder"];
