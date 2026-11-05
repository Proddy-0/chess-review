import { chesscomRecent, lichessRecent, fromPgn, store } from "../lib/sources.js";
import { esc } from "../util.js";

const SPEED = { bullet: "Bullet", blitz: "Blitz", rapid: "Rápida", daily: "Diária", classical: "Clássica", correspondence: "Correspondência", ultraBullet: "UltraBullet" };

export function renderHome(root) {
  const users = store.get("users") || { chesscom: "", lichess: "" };
  root.innerHTML = `
    <section class="home">
      <form class="card" id="f">
        <h2>Suas partidas</h2>
        <div class="row">
          <label>chess.com<input name="chesscom" placeholder="usuário" value="${esc(users.chesscom)}" autocomplete="off"></label>
          <label>Lichess<input name="lichess" placeholder="usuário" value="${esc(users.lichess)}" autocomplete="off"></label>
          <button>Buscar partidas</button>
        </div>
        <p class="muted small">Só partidas já terminadas, pelas APIs públicas. Nada de login, nada de assinatura.</p>
      </form>
      <div id="list" class="games"></div>
      <details class="card">
        <summary>Colar PGN</summary>
        <textarea id="pgn" rows="6" placeholder="[Event &quot;...&quot;]&#10;1. e4 e5 2. Nf3 ..."></textarea>
        <button id="pgnGo">Revisar PGN</button>
        <p class="err" id="pgnErr"></p>
      </details>
      <details class="card">
        <summary>Extensão pro chess.com</summary>
        <p>Quando a partida termina no chess.com, aparece o botão <b>Revisar no Chess Review</b> que abre ela aqui direto.</p>
        <ol>
          <li>Baixe <a href="extension.zip" download>extension.zip</a> e extraia numa pasta.</li>
          <li>Abra <code>chrome://extensions</code> e ligue o <b>Modo do desenvolvedor</b>.</li>
          <li><b>Carregar sem compactação</b> → escolha a pasta extraída.</li>
        </ol>
      </details>
    </section>`;

  const list = root.querySelector("#list");
  const me = () => [users.chesscom, users.lichess].filter(Boolean).map((u) => u.toLowerCase());

  function draw(games) {
    if (!games.length) { list.innerHTML = `<p class="muted">Nenhuma partida encontrada.</p>`; return; }
    list.innerHTML = games.map((g) => {
      const mine = me();
      const myColor = mine.includes(String(g.white).toLowerCase()) ? "w" : mine.includes(String(g.black).toLowerCase()) ? "b" : null;
      const won = myColor && ((g.result === "1-0" && myColor === "w") || (g.result === "0-1" && myColor === "b"));
      const lost = myColor && ((g.result === "0-1" && myColor === "w") || (g.result === "1-0" && myColor === "b"));
      const out = won ? "win" : lost ? "loss" : g.result === "1/2-1/2" ? "draw" : "";
      return `<a class="game ${out}" href="#/review/${encodeURIComponent(g.key)}" data-key="${esc(g.key)}">
        <span class="src ${g.src}">${g.src === "chesscom" ? "chess.com" : "Lichess"}</span>
        <span class="who"><span class="dot w"></span>${esc(g.white)} <small>${esc(g.whiteElo ?? "")}</small>
          <span class="vs">×</span><span class="dot b"></span>${esc(g.black)} <small>${esc(g.blackElo ?? "")}</small></span>
        <span class="result">${esc(g.result)}</span>
        <span class="meta">${esc(SPEED[g.speed] || g.speed || "")} · ${g.end ? new Date(g.end).toLocaleDateString("pt-BR") : ""}</span>
      </a>`;
    }).join("");
    const byKey = Object.fromEntries(games.map((g) => [g.key, g]));
    list.querySelectorAll(".game").forEach((a) => a.addEventListener("click", () => store.set(`game:${a.dataset.key}`, byKey[a.dataset.key])));
  }

  async function load() {
    const jobs = [];
    if (users.chesscom) jobs.push(chesscomRecent(users.chesscom));
    if (users.lichess) jobs.push(lichessRecent(users.lichess));
    if (!jobs.length) { list.innerHTML = ""; return; }
    list.innerHTML = `<p class="muted">Carregando…</p>`;
    const out = await Promise.allSettled(jobs);
    const games = out.filter((r) => r.status === "fulfilled").flatMap((r) => r.value).sort((a, b) => (b.end || 0) - (a.end || 0));
    draw(games);
    const errs = out.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    if (errs.length) list.insertAdjacentHTML("afterbegin", errs.map((e) => `<p class="err">${esc(e)}</p>`).join(""));
  }

  root.querySelector("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    users.chesscom = String(fd.get("chesscom") || "").trim();
    users.lichess = String(fd.get("lichess") || "").trim();
    store.set("users", users);
    load();
  });

  root.querySelector("#pgnGo").addEventListener("click", () => {
    try {
      const g = fromPgn(root.querySelector("#pgn").value);
      store.set(`game:${g.key}`, g);
      location.hash = `#/review/${encodeURIComponent(g.key)}`;
    } catch (e) {
      root.querySelector("#pgnErr").textContent = `PGN inválido: ${e.message}`;
    }
  });

  load();
  return () => {};
}
