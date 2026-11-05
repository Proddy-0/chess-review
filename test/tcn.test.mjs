import { Chess } from "chess.js";
import { decodeTCN } from "../src/lib/tcn.js";
const ua = { headers: { "User-Agent": "Mozilla/5.0" } };
const months = ["2025/01", "2024/06"];
let checked = 0, fail = 0;
for (const mo of months) {
  const arch = await (await fetch(`https://api.chess.com/pub/player/hikaru/games/${mo}`, ua)).json();
  for (const g of arch.games.filter(g => g.rules === "chess").slice(0, 15)) {
    const id = g.url.split("/").pop();
    const cb = await (await fetch(`https://www.chess.com/callback/live/game/${id}`, ua)).json();
    const ref = new Chess(); ref.loadPgn(g.pgn);
    const refSan = ref.history();
    const c = new Chess();
    try { for (const m of decodeTCN(cb.game.moveList)) c.move(m); } catch (e) { fail++; console.log("ERR", id, e.message); continue; }
    if (c.history().join() !== refSan.join()) { fail++; console.log("MISMATCH", id); }
    checked++;
  }
}
console.log(`checked=${checked} fail=${fail}`);
