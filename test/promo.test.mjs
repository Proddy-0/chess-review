import { Chess } from "chess.js";
import { decodeTCN } from "../src/lib/tcn.js";
const ua = { headers: { "User-Agent": "Mozilla/5.0" } };
let checked = 0, fail = 0, kinds = new Set();
for (const mo of ["2025/01","2024/06","2024/03"]) {
  const arch = await (await fetch(`https://api.chess.com/pub/player/hikaru/games/${mo}`, ua)).json();
  for (const g of arch.games.filter(g => g.rules === "chess" && /=[QRBN]/.test(g.pgn)).slice(0, 12)) {
    const id = g.url.split("/").pop();
    const cb = await (await fetch(`https://www.chess.com/callback/live/game/${id}`, ua)).json();
    const ref = new Chess(); ref.loadPgn(g.pgn);
    const c = new Chess();
    try { for (const m of decodeTCN(cb.game.moveList)) c.move(m); } catch (e) { fail++; console.log("ERR", id, e.message); continue; }
    c.history().filter(s => s.includes("=")).forEach(s => kinds.add(s.replace(/.*=/, "=")[0] + s.match(/=(.)/)[1] + (s.includes("x") ? "x" : "")));
    if (c.history().join() !== ref.history().join()) { fail++; console.log("MISMATCH", id); }
    checked++;
  }
}
console.log(`promo games checked=${checked} fail=${fail} kinds=${[...kinds]}`);
