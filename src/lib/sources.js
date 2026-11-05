import { Chess } from "chess.js";
import { decodeTCN } from "./tcn.js";

// Game = { key, src, id, url, pgn, white, black, whiteElo, blackElo, result, end, speed }

const RESULT = (pgn) => (pgn.match(/\[Result "([^"]+)"\]/) || [])[1] || "*";

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
      });
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export async function lichessRecent(user, max = 40) {
  const r = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user.trim())}?max=${max}&pgnInJson=true&clocks=false&evals=false&opening=true`,
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

// Persistence (best effort; private windows may block storage).
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(`cr:${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`cr:${k}`, JSON.stringify(v)); } catch { /* quota/private */ } },
};
