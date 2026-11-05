import { Chess } from "chess.js";
import { Engine } from "./engine.js";
import { toWhitePov, classify } from "./analysis.js";
import { store } from "./sources.js";

// Shared analysis pipeline: used by the review screen and by background
// batch analysis (puzzles). Cache format: cr:an2:<gameKey>:<depth> = res[]
//   res[i] = { ev, best, pv, second } for the position BEFORE move i (white POV).

export const DEPTHS = [12, 16, 20];

let openingsP = null;
export const openings = () => (openingsP ||= import("../data/openings.json").then((m) => m.default));
/** Tests run in plain Node, which can't import JSON without attributes. */
export const setOpenings = (map) => { openingsP = Promise.resolve(map); };
export const posKey = (fen) => fen.split(" ").slice(0, 2).join(" ");

export function gameLine(game) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];
  return { moves, fens };
}

/** Book flags + opening names for the leading moves found in the openings dataset. */
export async function bookFlags(fens) {
  const map = await openings();
  const n = fens.length - 1;
  const book = new Array(n).fill(false), names = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const name = map[posKey(fens[i + 1])];
    if (!name) break;
    book[i] = true;
    names[i] = name;
  }
  return { book, names };
}

/** Evaluate one position. Terminal positions are resolved without the engine. */
export async function evalPosition(engine, fen, depth) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { ev: { cp: c.turn() === "w" ? -100000 : 100000, final: "mate" }, best: null, pv: [], second: null };
  if (c.isDraw() || c.isStalemate()) return { ev: { cp: 0, final: "draw" }, best: null, pv: [], second: null };
  const r = await engine.analyse(fen, depth);
  const wtm = c.turn() === "w";
  return {
    ev: r.info ? toWhitePov(r.info, wtm) : { cp: 0 },
    best: r.bestmove,
    pv: r.info?.pv || [],
    second: r.second ? toWhitePov(r.second, wtm) : null,
  };
}

export function classifyMove(moves, fens, res, book, i, prevKind) {
  if (i < 0 || i >= moves.length || !res[i] || !res[i + 1]) return null;
  return classify({
    before: res[i].ev, after: res[i + 1].ev, second: res[i].second, mover: moves[i].color,
    played: moves[i].lan, best: res[i].best, fenBefore: fens[i], book: book[i], prevKind,
  });
}

export function classifyAll(moves, fens, res, book) {
  const cls = [];
  for (let i = 0; i < moves.length; i++) cls[i] = classifyMove(moves, fens, res, book, i, cls[i - 1]?.kind);
  return cls;
}

export function accuracies(moves, cls) {
  const of = (c) => {
    const a = cls.filter((x, i) => x && moves[i].color === c).map((x) => x.accuracy);
    return a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : 0;
  };
  return { w: of("w"), b: of("b") };
}

/** Deepest cached analysis for a game: { depth, res } or null. */
export function cachedAnalysis(key, plies) {
  for (const d of [...DEPTHS].reverse()) {
    const res = store.get(`an2:${key}:${d}`);
    if (res && (plies === undefined || res.length === plies + 1)) return { depth: d, res };
  }
  return null;
}

/**
 * Full-game analysis outside the review screen. Stores an2 + acc caches.
 * opts: { depth, onProgress(i, total), alive() } — returns res or null if aborted.
 */
export async function analyseGame(game, { depth = 12, onProgress, alive = () => true } = {}) {
  const { moves, fens } = gameLine(game);
  const engine = new Engine();
  try {
    const res = [];
    for (let i = 0; i < fens.length; i++) {
      if (!alive()) return null;
      onProgress?.(i, fens.length);
      res[i] = await evalPosition(engine, fens[i], depth);
    }
    if (!alive()) return null;
    const { book } = await bookFlags(fens);
    store.set(`game:${game.key}`, game);
    store.set(`an2:${game.key}:${depth}`, res);
    store.set(`acc:${game.key}`, accuracies(moves, classifyAll(moves, fens, res, book)));
    return res;
  } finally {
    engine.terminate();
  }
}
