import { Chess } from "chess.js";
import { myGames, forgetMyGames, fromPgn, offlineGames, store } from "../lib/sources.js";
import { esc } from "../util.js";

const SPEED = {
  bullet: ["⚡", "Bullet"], ultraBullet: ["⚡", "UltraBullet"], blitz: ["🔥", "Blitz"], rapid: ["⏱", "Rápida"],
  classical: ["🐢", "Clássica"], daily: ["☀", "Diária"], correspondence: ["☀", "Correspondência"], offline: ["🤖", "Offline"], room: ["👥", "Sala"],
};
const SRC = { chesscom: "chess.com", lichess: "Lichess", offline: "Offline", pgn: "PGN" };
const PIECE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

let cache = { users: null, games: [] }; // survives navigation inside the SPA

function miniBoard(fen, flip) {
  if (!fen) return `<div class="mini empty"></div>`;
  let html = "";
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const col = flip ? 7 - f : f, rr = flip ? 7 - r : r;
      html += `<piece class="${ch === ch.toUpperCase() ? "white" : "black"} ${PIECE[ch.toLowerCase()]}" style="left:${col * 12.5}%;top:${rr * 12.5}%"></piece>`;
      f++;
    }
  });
  return `<div class="mini cg-wrap">${html}</div>`;
}

function finalFen(g) {
  if (g.fen) return g.fen.includes(" ") ? g.fen : `${g.fen} w - - 0 1`;
  try { const c = new Chess(); c.loadPgn(g.pgn); return c.fen(); } catch { return null; }
}

export function renderHome(root, query = "") {
  const users = store.get("users") || { chesscom: "", lichess: "" };
  let filter = store.get("filter") || { src: "all", res: "all" };
  const editing = !users.chesscom && !users.lichess;

  root.innerHTML = `
    <section class="home2">
      <div class="hero">
        <a class="play-card" href="#/play">
          <span class="pc-ico">🤖</span>
          <span class="pc-txt"><b>Jogar contra o Stockfish</b><small>Offline, direto no navegador · 8 níveis · revisão no fim</small></span>
          <span class="pc-go">Jogar ▶</span>
        </a>
        <form class="accounts ${editing ? "editing" : ""}" id="f">
          <div class="acc-view">
            <span class="muted small">Contas</span>
            ${users.chesscom ? `<span class="acct chesscom">chess.com · <b>${esc(users.chesscom)}</b></span>` : ""}
            ${users.lichess ? `<span class="acct lichess">Lichess · <b>${esc(users.lichess)}</b></span>` : ""}
            <button type="button" id="edit" class="ghost">✎ editar</button>
            <button type="button" id="refresh" class="ghost" title="Atualizar">↻</button>
          </div>
          <div class="acc-edit">
            <label>chess.com<input name="chesscom" placeholder="usuário" value="${esc(users.chesscom)}" autocomplete="off"></label>
            <label>Lichess<input name="lichess" placeholder="usuário" value="${esc(users.lichess)}" autocomplete="off"></label>
            <button class="primary">Salvar e buscar</button>
          </div>
        </form>
      </div>

      <div class="toolbar">
        <div class="tabs" id="tabs"></div>
        <div class="tb-right">
          <select id="fres">
            <option value="all">Todos os resultados</option><option value="win">Vitórias</option>
            <option value="loss">Derrotas</option><option value="draw">Empates</option>
          </select>
          <input id="q" placeholder="Buscar adversário ou abertura" autocomplete="off">
        </div>
      </div>
      <div id="msg"></div>
      <div class="ggrid" id="list"></div>

      <div class="extras">
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
      </div>
    </section>`;

  const $ = (s) => root.querySelector(s);
  $("#fres").value = filter.res;
  if (query) { $("#q").value = query; filter.src = "all"; }
  const me = () => [users.chesscom, users.lichess, "você"].filter(Boolean).map((u) => u.toLowerCase());

  function outcome(g) {
    const m = me();
    const color = g.orient ? (g.orient === "white" ? "w" : "b")
      : m.includes(String(g.white).toLowerCase()) ? "w" : m.includes(String(g.black).toLowerCase()) ? "b" : null;
    if (g.result === "1/2-1/2") return { color, out: "draw" };
    if (!color || g.result === "*") return { color, out: null };
    const won = (g.result === "1-0") === (color === "w");
    return { color, out: won ? "win" : "loss" };
  }

  function all() {
    return [...cache.games, ...offlineGames()].sort((a, b) => (b.end || 0) - (a.end || 0));
  }

  function card(g) {
    const { color, out } = outcome(g);
    const acc = g.acc || store.get(`acc:${g.key}`);
    const [ico, speedName] = SPEED[g.speed] || ["♟", g.speed || ""];
    const flip = color === "b";
    const line = (c) => {
      const name = c === "w" ? g.white : g.black, elo = c === "w" ? g.whiteElo : g.blackElo;
      const win = (g.result === "1-0" && c === "w") || (g.result === "0-1" && c === "b");
      return `<div class="gp ${win ? "won" : ""} ${c === color ? "me" : ""}">
        <span class="dot ${c}"></span><span class="gpn">${esc(name)}</span>${elo ? `<small>${esc(elo)}</small>` : ""}
        ${acc && acc[c] != null ? `<span class="gacc">${(+acc[c]).toFixed(1)}</span>` : ""}
      </div>`;
    };
    const outLabel = { win: "Vitória", loss: "Derrota", draw: "Empate" }[out] || g.result;
    return `<a class="gcard ${out || ""}" href="#/review/${encodeURIComponent(g.key)}" data-key="${esc(g.key)}">
      ${miniBoard(finalFen(g), flip)}
      <div class="gbody">
        <div class="gtop"><span class="src ${g.src}">${SRC[g.src] || g.src}</span>
          <span class="gspeed" title="${esc(speedName)}">${ico} ${esc(g.tc || speedName)}</span>
          <span class="gdate">${g.end ? new Date(g.end).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}</span></div>
        ${line("w")}${line("b")}
        <div class="gmeta">
          <span class="gout ${out || ""}">${esc(outLabel)}</span>
          ${g.ending ? `<span>por ${esc(g.ending)}</span>` : ""}
          ${g.moves ? `<span>· ${g.moves} lances</span>` : ""}
        </div>
        ${g.opening ? `<div class="gopen" title="${esc(g.opening)}">${esc(g.opening)}</div>` : ""}
        <span class="greview">${acc ? "Ver revisão" : "Revisar"} →</span>
      </div>
    </a>`;
  }

  function draw() {
    const games = all();
    const counts = { all: games.length, chesscom: 0, lichess: 0, offline: 0 };
    games.forEach((g) => { if (counts[g.src] !== undefined) counts[g.src]++; });
    $("#tabs").innerHTML = [["all", "Todas"], ["chesscom", "chess.com"], ["lichess", "Lichess"], ["offline", "Offline"]]
      .map(([k, v]) => `<button class="tab ${filter.src === k ? "on" : ""} t-${k}" data-src="${k}">${v}<small>${counts[k]}</small></button>`).join("");

    const q = $("#q").value.trim().toLowerCase();
    const shown = games.filter((g) => (filter.src === "all" || g.src === filter.src)
      && (filter.res === "all" || outcome(g).out === filter.res)
      && (!q || [g.white, g.black, g.opening].some((s) => String(s || "").toLowerCase().includes(q))));
    $("#list").innerHTML = shown.length ? shown.map(card).join("")
      : `<p class="muted empty-msg">${games.length ? "Nenhuma partida com esse filtro." : "Coloque seu usuário do chess.com ou Lichess, ou jogue uma partida offline."}</p>`;
    const byKey = Object.fromEntries(games.map((g) => [g.key, g]));
    $("#list").querySelectorAll(".gcard").forEach((a) => a.addEventListener("click", () => store.set(`game:${a.dataset.key}`, byKey[a.dataset.key])));
  }

  async function load(force = false) {
    const sameUsers = cache.users && cache.users.chesscom === users.chesscom && cache.users.lichess === users.lichess;
    if (sameUsers && !force) return draw();
    if (force) forgetMyGames();
    cache = { users: { ...users }, games: [] };
    $("#msg").innerHTML = users.chesscom || users.lichess ? `<p class="muted">Carregando partidas…</p>` : "";
    draw();
    const out = await myGames(users);
    cache.games = out.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
    $("#msg").innerHTML = out.filter((r) => r.status === "rejected").map((r) => `<p class="err">${esc(r.reason.message)}</p>`).join("");
    draw();
  }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-src]");
    if (!b) return;
    filter.src = b.dataset.src; store.set("filter", filter); draw();
  });
  $("#fres").addEventListener("change", (e) => { filter.res = e.target.value; store.set("filter", filter); draw(); });
  $("#q").addEventListener("input", draw);
  $("#edit").addEventListener("click", () => $("#f").classList.add("editing"));
  $("#refresh").addEventListener("click", () => load(true));
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    users.chesscom = String(fd.get("chesscom") || "").trim();
    users.lichess = String(fd.get("lichess") || "").trim();
    store.set("users", users);
    location.reload();
  });
  $("#pgnGo").addEventListener("click", () => {
    try {
      const g = fromPgn($("#pgn").value);
      store.set(`game:${g.key}`, g);
      location.hash = `#/review/${encodeURIComponent(g.key)}`;
    } catch (e) {
      $("#pgnErr").textContent = `PGN inválido: ${e.message}`;
    }
  });

  load();
  return () => {};
}
