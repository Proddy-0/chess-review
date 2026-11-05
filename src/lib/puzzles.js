import { Chess } from "chess.js";
import { moverWinPct } from "./analysis.js";
import { gameLine, bookFlags, classifyAll, cachedAnalysis } from "./pipeline.js";
import { store } from "./sources.js";

// Puzzles built from the player's own mistakes in analysed games.
// Puzzle = position before my bad move; solution = engine line, my moves only
// validated (opponent replies auto-played).

const BAD = ["mistake", "blunder", "miss"];
const MIN_GAP = 10; // best line must beat 2nd best by ≥10 win% points => single clear answer
const MIN_BEST = 35; // skip positions where even the best move is lost

export function myColor(game, me) {
  if (game.orient) return game.orient === "white" ? "w" : "b";
  const w = me.includes(String(game.white).toLowerCase()), b = me.includes(String(game.black).toLowerCase());
  return w && !b ? "w" : b && !w ? "b" : null;
}

export function meList() {
  const u = store.get("users") || {};
  return [u.chesscom, u.lichess, store.get("nick"), "você"].filter(Boolean).map((s) => String(s).toLowerCase());
}

/** Keep my first move; extend with opponent reply + my next move while the line stays forcing. */
function trimLine(fen, pv) {
  const c = new Chess(fen);
  const out = [];
  for (let j = 0; j < pv.length && j < 6; j++) {
    let mv;
    try { mv = c.move({ from: pv[j].slice(0, 2), to: pv[j].slice(2, 4), promotion: pv[j][4] }); } catch { break; }
    const mine = j % 2 === 0;
    if (mine && j > 0 && !(mv.captured || mv.san.includes("+") || mv.san.includes("#"))) break;
    out.push(pv[j]);
    if (c.isGameOver()) break;
  }
  if (out.length % 2 === 0) out.pop(); // always end on my move
  return out;
}

function theme(fen, line, ev, color) {
  const mateFor = ev.mate !== undefined && (ev.mate > 0) === (color === "w");
  if (mateFor) return `Mate em ${Math.abs(ev.mate)}`;
  const c = new Chess(fen);
  let captured = false;
  line.forEach((u, j) => {
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (j % 2 === 0 && m.captured) captured = true;
  });
  return captured ? "Ganhe material" : "Ache o lance forte";
}

export async function puzzlesFromGame(game, res, me) {
  const { moves, fens } = gameLine(game);
  if (res.length !== moves.length + 1) return [];
  const color = myColor(game, me);
  if (!color) return [];
  const { book } = await bookFlags(fens);
  const cls = classifyAll(moves, fens, res, book);
  const opp = color === "w" ? game.black : game.white;
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const k = cls[i]?.kind, r = res[i];
    if (moves[i].color !== color || !BAD.includes(k) || !r?.best || !r.second || !r.pv?.length) continue;
    const best = moverWinPct(r.ev, color);
    if (best < MIN_BEST || best - moverWinPct(r.second, color) < MIN_GAP) continue;
    const line = trimLine(fens[i], r.pv);
    if (!line.length || line[0] !== r.best) continue;
    out.push({
      id: `${game.key}:${i}`, gameKey: game.key, ply: i, fen: fens[i], color,
      prev: i > 0 ? { fen: fens[i - 1], from: moves[i - 1].from, to: moves[i - 1].to, promotion: moves[i - 1].promotion } : null,
      line, played: moves[i].san, kind: k, drop: Math.round(cls[i].drop),
      theme: theme(fens[i], line, r.ev, color),
      opp, src: game.src, end: game.end || 0, moveNo: Math.floor(i / 2) + 1,
    });
  }
  return out;
}

/** Every puzzle from every analysed game in localStorage. */
export async function allPuzzles() {
  const me = meList();
  const keys = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("cr:an2:")) keys.add(k.slice(7, k.lastIndexOf(":")));
  }
  const out = [];
  for (const key of keys) {
    const game = store.get(`game:${key}`);
    if (!game?.pgn) continue;
    const a = cachedAnalysis(key);
    if (!a) continue;
    try { out.push(...(await puzzlesFromGame(game, a.res, me))); } catch { /* bad pgn */ }
  }
  return out;
}

// ---------- progress / spaced repetition ----------
// pz = { [id]: { tries, solved, streak, last, ok } }
export const progress = () => store.get("pz") || {};

export function record(id, ok) {
  const p = progress();
  const e = p[id] || { tries: 0, solved: 0, streak: 0, last: 0, ok: false };
  e.tries++;
  e.last = Date.now();
  e.ok = ok;
  if (ok) { e.solved++; e.streak++; } else e.streak = 0;
  p[id] = e;
  store.set("pz", p);
  return e;
}

const DAY = 86400000;
export function status(e) {
  if (!e) return "new";
  if (!e.ok) return "failed";
  return e.streak >= 2 ? "mastered" : "learning";
}

/** Training order: failed → new → learning due (≥1 day) → learning not due. Mastered excluded. */
export function queue(list, filter = "train") {
  const p = progress();
  const now = Date.now();
  const rank = (z) => {
    const e = p[z.id], s = status(e);
    if (s === "failed") return 0;
    if (s === "new") return 1;
    if (s === "learning") return now - e.last >= DAY ? 2 : 3;
    return 4;
  };
  const sev = { blunder: 0, miss: 1, mistake: 2 };
  let l = list;
  if (filter === "train") l = l.filter((z) => status(p[z.id]) !== "mastered");
  else if (filter === "failed") l = l.filter((z) => status(p[z.id]) === "failed");
  return [...l].sort((a, b) => rank(a) - rank(b) || b.end - a.end || sev[a.kind] - sev[b.kind] || a.ply - b.ply);
}
