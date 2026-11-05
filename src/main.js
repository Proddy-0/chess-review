import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./style.css";
import "./review.css";
import "./home.css";
import "./social.css";
import { renderHome } from "./views/home.js";
import { renderReview } from "./views/review.js";
import { renderPlay } from "./views/play.js";
import { renderFriends } from "./views/friends.js";
import { renderRoom } from "./views/room.js";
import { renderPuzzles } from "./views/puzzles.js";
import { fromChesscomTcn, lichessGame, store } from "./lib/sources.js";
import { esc } from "./util.js";

const app = document.getElementById("app");
let cleanup = null;

function navActive(path) {
  document.querySelectorAll(".nav a").forEach((a) => {
    const t = a.getAttribute("href").slice(1);
    a.classList.toggle("on", t === "/" ? path === "/" : path.startsWith(t));
  });
}

async function route() {
  cleanup?.();
  cleanup = null;
  const [path, qs = ""] = (location.hash.slice(1) || "/").split("?");
  navActive(path);

  try {
    if (path === "/import") {
      // Coming from the browser extension after a chess.com game ended.
      const p = Object.fromEntries(new URLSearchParams(qs));
      const g = fromChesscomTcn(p);
      if (p.orient === "black" || p.orient === "white") g.orient = p.orient;
      store.set(`game:${g.key}`, g);
      location.replace(`#/review/${encodeURIComponent(g.key)}`);
      return;
    }
    if (path.startsWith("/review/")) {
      const key = decodeURIComponent(path.slice("/review/".length));
      let g = store.get(`game:${key}`);
      if (!g && key.startsWith("lichess-")) {
        g = await lichessGame(key.slice("lichess-".length));
        store.set(`game:${key}`, g);
      }
      if (!g) {
        app.innerHTML = `<p class="err">Partida não encontrada. <a href="#/">Voltar</a></p>`;
        return;
      }
      const users = store.get("users") || {};
      const me = [users.chesscom, users.lichess].filter(Boolean).map((u) => u.toLowerCase());
      cleanup = renderReview(app, g, me, { ply: +new URLSearchParams(qs).get("ply") || 0 });
      return;
    }
    if (path === "/play") {
      cleanup = renderPlay(app);
      return;
    }
    if (path === "/puzzles") {
      cleanup = renderPuzzles(app);
      return;
    }
    if (path === "/friends") {
      cleanup = renderFriends(app);
      return;
    }
    if (path === "/room" || path.startsWith("/room/")) {
      cleanup = renderRoom(app, path.slice("/room/".length) || null, qs);
      return;
    }
    cleanup = renderHome(app, new URLSearchParams(qs).get("q") || "");
  } catch (e) {
    app.innerHTML = `<p class="err">${esc(e.message)}</p><p><a href="#/">Voltar</a></p>`;
  }
}

window.addEventListener("hashchange", route);
route();
