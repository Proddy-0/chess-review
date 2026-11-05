import { Chess } from "chess.js";
import { decodeTCN } from "./tcn.js";

// Game = { key, src, id, url, pgn, white, black, whiteElo, blackElo, result, end, speed,
//          tc, fen, moves, opening, ending, acc: { w, b } | null, orient? }

const RESULT = (pgn) => (pgn.match(/\[Result "([^"]+)"\]/) || [])[1] || "*";
const HEADER = (pgn, k) => (pgn.match(new RegExp(`\\[${k} "([^"]*)"\\]`)) || [])[1];
const fullMoves = (pgn) => Math.max(0, ...[...pgn.replace(/\[[^\]]*\]/g, "").replace(/\{[^}]*\}/g, "").matchAll(/(\d+)\.(?!\.)/g)].map((m) => +m[1]));

const ENDINGS = [
  [/checkmate|mate/i, "xeque-mate"], [/resign/i, "abandono"], [/abandon/i, "abandono da partida"],
  [/insufficient/i, "material insuficiente"], [/time|outoftime/i, "tempo"], [/stalemate/i, "afogamento"],
  [/repetition/i, "repetição"], [/agree|draw/i, "acordo"], [/50/i, "regra dos 50 lances"],
];
const ending = (text) => (ENDINGS.find(([re]) => re.test(text || "")) || [null, ""])[1];

function tcLabel(tc) {
  if (!tc) return "";
  if (tc.includes("/")) return `${Math.round(+tc.split("/")[1] / 86400)} dia(s)`;
  const [base, inc] = tc.split("+").map(Number);
  const m = base >= 60 ? `${base / 60}` : `${base}s`;
  return inc ? `${m}+${inc}` : `${m} min`;
}

const chesscomOpening = (ecoUrl) => (ecoUrl ? decodeURIComponent(ecoUrl.split("/openings/")[1] || "").replace(/-/g, " ").replace(/\s*\.\.\..*$|\s+(with\s+)?\d.*$/i, "").trim() : "");

// Memoised "my games" so home and friends share one fetch per session.
const mine = new Map();
export function myGames(users) {
  const key = `${users.chesscom || ""}|${users.lichess || ""}`;
  if (!mine.has(key)) {
    const jobs = [];
    if (users.chesscom) jobs.push(chesscomRecent(users.chesscom, 60));
    if (users.lichess) jobs.push(lichessRecent(users.lichess, 60));
    mine.set(key, Promise.allSettled(jobs));
  }
  return mine.get(key);
}
export function forgetMyGames() { mine.clear(); }

export async function chesscomRecent(user, max = 40) {
  const u = user.trim().toLowerCase();
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (!r.ok) throw new Error(`Usuário "${user}" não encontrado no chess.com`);
  const { archives = [] } = await r.json();
  const out = [];
  for (const url of archives.slice(-3).reverse()) {
    const { games = [] } = await (await fetch(url)).json();
    for (const g of games.reverse()) {
      if (g.rules !== "chess" || !g.pgn) continue;
      out.push({
        key: `chesscom-${g.url.split("/").pop()}`,
        src: "chesscom",
        id: g.url.split("/").pop(),
        url: g.url,
        pgn: g.pgn,
        white: g.white.username,
        black: g.black.username,
        whiteElo: g.white.rating,
        blackElo: g.black.rating,
        result: RESULT(g.pgn),
        end: g.end_time * 1000,
        speed: g.time_class,
        tc: tcLabel(g.time_control),
        fen: g.fen,
        moves: fullMoves(g.pgn),
        opening: chesscomOpening(g.eco || HEADER(g.pgn, "ECOUrl")),
        ending: ending(HEADER(g.pgn, "Termination")),
        acc: g.accuracies ? { w: g.accuracies.white, b: g.accuracies.black } : null,
      });
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export async function lichessRecent(user, max = 40) {
  const r = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user.trim())}?max=${max}&pgnInJson=true&clocks=false&evals=false&opening=true&accuracy=true&lastFen=true`,
    { headers: { Accept: "application/x-ndjson" } },
  );
  if (!r.ok) throw new Error(`Usuário "${user}" não encontrado no Lichess`);
  const text = await r.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((g) => g.variant === "standard" && g.pgn)
    .map((g) => ({
      key: `lichess-${g.id}`,
      src: "lichess",
      id: g.id,
      url: `https://lichess.org/${g.id}`,
      pgn: g.pgn,
      white: g.players.white.user?.name || "Anônimo",
      black: g.players.black.user?.name || "Anônimo",
      whiteElo: g.players.white.rating,
      blackElo: g.players.black.rating,
      result: RESULT(g.pgn),
      end: g.lastMoveAt || g.createdAt,
      speed: g.speed,
      tc: g.clock ? tcLabel(`${g.clock.initial}+${g.clock.increment}`) : g.daysPerTurn ? `${g.daysPerTurn} dia(s)` : "",
      fen: g.lastFen,
      moves: Math.ceil((g.moves || "").split(" ").filter(Boolean).length / 2),
      opening: g.opening?.name || "",
      ending: ending(g.status),
      acc: g.players.white.analysis?.accuracy != null ? { w: g.players.white.analysis.accuracy, b: g.players.black.analysis?.accuracy } : null,
    }));
}

export async function lichessGame(id) {
  const r = await fetch(`https://lichess.org/game/export/${encodeURIComponent(id)}?clocks=false&evals=false`);
  if (!r.ok) throw new Error("Partida do Lichess não encontrada");
  const pgn = await r.text();
  const h = (k) => (pgn.match(new RegExp(`\\[${k} "([^"]*)"\\]`)) || [])[1];
  return { key: `lichess-${id}`, src: "lichess", id, url: `https://lichess.org/${id}`, pgn,
    white: h("White"), black: h("Black"), whiteElo: h("WhiteElo"), blackElo: h("BlackElo"), result: h("Result") };
}

// From the extension: chess.com TCN moveList + headers → Game.
export function fromChesscomTcn(p) {
  const c = new Chess();
  for (const m of decodeTCN(p.tcn)) c.move(m);
  for (const [k, v] of [["White", p.w], ["Black", p.b], ["WhiteElo", p.we], ["BlackElo", p.be], ["Result", p.res], ["Site", "Chess.com"]]) {
    if (v) c.setHeader(k, v);
  }
  return { key: `chesscom-${p.id}`, src: "chesscom", id: p.id, url: `https://www.chess.com/game/live/${p.id}`,
    pgn: c.pgn(), white: p.w, black: p.b, whiteElo: p.we, blackElo: p.be, result: p.res || "*", end: Date.now() };
}

export function fromPgn(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const h = c.getHeaders();
  let hash = 0;
  for (const ch of pgn) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { key: `pgn-${(hash >>> 0).toString(36)}`, src: "pgn", id: null, pgn,
    white: h.White || "Brancas", black: h.Black || "Pretas", whiteElo: h.WhiteElo, blackElo: h.BlackElo, result: h.Result || "*" };
}

// Offline games played on this site against Stockfish.
export function offlineGames() {
  return store.get("offline") || [];
}
export function saveOffline(game) {
  const list = offlineGames().filter((g) => g.key !== game.key);
  list.unshift(game);
  store.set("offline", list.slice(0, 200));
  store.set(`game:${game.key}`, game);
}

// Persistence (best effort; private windows may block storage).
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(`cr:${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`cr:${k}`, JSON.stringify(v)); } catch { /* quota/private */ } },
};
