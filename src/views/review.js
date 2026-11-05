import { Chess } from "chess.js";
import { Chessground } from "chessground";
import { Engine } from "../lib/engine.js";
import { toWhitePov, whiteWinPct, formatEval, classify, TAG, KIND_NAME } from "../lib/analysis.js";
import { explain } from "../lib/explain.js";
import { store } from "../lib/sources.js";
import { esc } from "../util.js";

const DEPTHS = [12, 16, 20];

export function renderReview(root, game, me = []) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const n = moves.length;
  const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];

  const isMe = (name) => name && me.includes(String(name).toLowerCase());
  let orientation = game.orient || (isMe(game.black) && !isMe(game.white) ? "black" : "white");
  let depth = store.get("depth") || 16;
  let cur = n;
  let timer = null;
  let engine = null;
  let alive = true;
  const res = new Array(n + 1).fill(null); // { ev, best, pv }
  const cls = new Array(n).fill(null); // { kind, accuracy }

  root.innerHTML = `
    <div class="review">
      <div class="board-col">
        <div class="player top" id="pTop"></div>
        <div class="board-row">
          <div class="evalbar" id="bar"><div class="fill" id="barFill"></div><span id="barTxt"></span></div>
          <div class="board" id="board"></div>
        </div>
        <div class="player bottom" id="pBot"></div>
        <div class="controls">
          <button data-a="first" title="Início (Home)">⏮</button>
          <button data-a="prev" title="Voltar (←)">◀</button>
          <button data-a="play" id="play" title="Reproduzir (espaço)">▶ Reproduzir</button>
          <button data-a="next" title="Avançar (→)">▶</button>
          <button data-a="last" title="Fim (End)">⏭</button>
          <select id="speed" title="Velocidade">
            <option value="1600">lento</option><option value="900" selected>normal</option><option value="400">rápido</option>
          </select>
          <button data-a="flip" title="Virar tabuleiro (F)">⇅</button>
        </div>
        <div class="explain" id="explain"></div>
      </div>
      <aside class="panel">
        <div class="status" id="status"></div>
        <div class="acc" id="acc"></div>
        <svg class="graph" id="graph" viewBox="0 0 300 80" preserveAspectRatio="none"></svg>
        <div class="summary" id="summary"></div>
        <div class="settings">
          Profundidade
          <select id="depth">${DEPTHS.map((d) => `<option value="${d}" ${d === depth ? "selected" : ""}>${d}</option>`).join("")}</select>
          <button id="reanalyse">Reanalisar</button>
          ${game.url ? `<a href="${esc(game.url)}" target="_blank" rel="noopener">partida original ↗</a>` : ""}
        </div>
        <ol class="moves" id="moves"></ol>
      </aside>
    </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const cg = Chessground($("board"), {
    viewOnly: true,
    coordinates: true,
    orientation,
    animation: { enabled: true, duration: 280 },
    drawable: { enabled: false, visible: true },
    highlight: { lastMove: true, check: true },
  });

  function players() {
    const line = (name, elo, color) => {
      const r = game.result === "1-0" ? (color === "w" ? "1" : "0") : game.result === "0-1" ? (color === "w" ? "0" : "1") : game.result === "1/2-1/2" ? "½" : "";
      return `<span class="dot ${color}"></span><b>${esc(name || "?")}</b>${elo ? ` <small>(${esc(elo)})</small>` : ""} <span class="res">${r}</span>`;
    };
    const w = line(game.white, game.whiteElo, "w"), b = line(game.black, game.blackElo, "b");
    $("pTop").innerHTML = orientation === "white" ? b : w;
    $("pBot").innerHTML = orientation === "white" ? w : b;
  }

  function moveList() {
    let html = "";
    for (let i = 0; i < n; i += 2) {
      html += `<li>${cell(i)}${i + 1 < n ? cell(i + 1) : ""}</li>`;
    }
    $("moves").innerHTML = html;
    $("moves").style.counterReset = "";
  }
  function cell(i) {
    const c = cls[i];
    const tag = c ? `<span class="tag t-${c.kind}">${TAG[c.kind]}</span>` : "";
    return `<span class="mv ${i + 1 === cur ? "cur" : ""}" data-p="${i + 1}">${esc(moves[i].san)}${tag}</span>`;
  }

  function evalBar(ev) {
    const wp = ev ? whiteWinPct(ev) : 50;
    const fill = $("barFill");
    fill.style.height = `${orientation === "white" ? wp : 100 - wp}%`;
    $("bar").classList.toggle("flipped", orientation === "black");
    $("barTxt").textContent = formatEval(ev);
    $("bar").classList.toggle("black-adv", wp < 50);
  }

  function graph() {
    const pts = [];
    for (let i = 0; i <= n; i++) if (res[i]) pts.push([(i / Math.max(1, n)) * 300, 80 - (whiteWinPct(res[i].ev) / 100) * 80]);
    let svg = `<line x1="0" y1="40" x2="300" y2="40" class="mid"/>`;
    if (pts.length > 1) {
      svg += `<polygon class="area" points="0,80 ${pts.map((p) => p.join(",")).join(" ")} ${pts[pts.length - 1][0]},80"/>`;
    }
    for (let i = 0; i < n; i++) {
      const k = cls[i]?.kind;
      if (k === "blunder" || k === "mistake") {
        const x = ((i + 1) / Math.max(1, n)) * 300;
        svg += `<circle class="m-${k}" cx="${x}" cy="${80 - (whiteWinPct(res[i + 1].ev) / 100) * 80}" r="2.6"/>`;
      }
    }
    const cx = (cur / Math.max(1, n)) * 300;
    svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="80" class="cursor"/>`;
    $("graph").innerHTML = svg;
  }

  function accuracy() {
    const side = (c) => {
      const a = cls.filter((x, i) => x && moves[i].color === c).map((x) => x.accuracy);
      return a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : "–";
    };
    const count = (c, k) => cls.filter((x, i) => x && moves[i].color === c && x.kind === k).length;
    $("acc").innerHTML = ["w", "b"].map((c) => `
      <div><small>Precisão ${c === "w" ? "brancas" : "pretas"}</small><b>${side(c)}%</b></div>`).join("");
    $("summary").innerHTML = `<table>
      <tr><th></th><th>Brancas</th><th>Pretas</th></tr>
      ${["best", "inacc", "mistake", "blunder"].map((k) => `<tr><td class="t-${k}">${TAG[k]} ${KIND_NAME[k]}</td><td>${count("w", k)}</td><td>${count("b", k)}</td></tr>`).join("")}
    </table>`;
  }

  function goto(p) {
    cur = Math.max(0, Math.min(n, p));
    const c = new Chess(fens[cur]);
    const mv = moves[cur - 1];
    cg.set({
      fen: fens[cur],
      orientation,
      turnColor: c.turn() === "w" ? "white" : "black",
      lastMove: mv ? [mv.from, mv.to] : undefined,
      check: c.inCheck() ? (c.turn() === "w" ? "white" : "black") : false,
    });
    const shapes = [];
    const k = cls[cur - 1]?.kind;
    if (mv && res[cur - 1]?.best && k && k !== "best" && k !== "good") {
      const b = res[cur - 1].best;
      shapes.push({ orig: b.slice(0, 2), dest: b.slice(2, 4), brush: "green" });
    }
    cg.setAutoShapes(shapes);
    evalBar(res[cur]?.ev);
    root.querySelectorAll(".mv.cur").forEach((e) => e.classList.remove("cur"));
    const el = root.querySelector(`.mv[data-p="${cur}"]`);
    if (el) { el.classList.add("cur"); el.scrollIntoView({ block: "nearest" }); }
    graph();

    const box = $("explain");
    if (!mv) { box.innerHTML = `<span class="muted">Posição inicial. Use ▶ ou as setas pra ver a partida.</span>`; return; }
    if (!cls[cur - 1]) { box.innerHTML = `<b>${Math.ceil(cur / 2)}${mv.color === "w" ? "." : "..."} ${esc(mv.san)}</b> <span class="muted">analisando…</span>`; return; }
    const r0 = res[cur - 1], r1 = res[cur];
    const text = explain(fens[cur - 1], { uci: mv.lan, san: mv.san, color: mv.color }, {
      kind: k, evalBefore: r0.ev, evalAfter: r1.ev, bestUci: r0.best, bestPv: r0.pv, replyPv: r1.pv,
    });
    box.innerHTML = `<span class="badge t-${k}">${TAG[k] || "✓"} ${KIND_NAME[k]}</span> <b>${Math.ceil(cur / 2)}${mv.color === "w" ? "." : "..."} ${esc(mv.san)}</b><p>${esc(text)}</p>`;
  }

  function updateMove(i) {
    if (i < 0 || i >= n || !res[i] || !res[i + 1]) return;
    cls[i] = classify(res[i].ev, res[i + 1].ev, moves[i].color, moves[i].lan, res[i].best);
  }

  function refreshAll() { moveList(); accuracy(); goto(cur); }

  async function analyse() {
    engine?.terminate();
    res.fill(null); cls.fill(null);
    const cached = store.get(`an:${game.key}:${depth}`);
    if (cached && cached.length === n + 1) {
      cached.forEach((r, i) => (res[i] = r));
      for (let i = 0; i < n; i++) updateMove(i);
      $("status").textContent = `Análise Stockfish 19 · profundidade ${depth} (cache)`;
      refreshAll();
      return;
    }
    engine = new Engine();
    const mine = engine;
    refreshAll();
    for (let i = 0; i <= n; i++) {
      if (!alive || engine !== mine) return;
      $("status").textContent = `Analisando ${i}/${n} lances · profundidade ${depth}…`;
      const c = new Chess(fens[i]);
      if (c.isCheckmate()) {
        res[i] = { ev: { cp: c.turn() === "w" ? -100000 : 100000, final: "mate" }, best: null, pv: [] };
      } else if (c.isDraw() || c.isStalemate()) {
        res[i] = { ev: { cp: 0, final: "draw" }, best: null, pv: [] };
      } else {
        const r = await mine.analyse(fens[i], depth);
        if (engine !== mine) return;
        res[i] = r.info
          ? { ev: toWhitePov(r.info, c.turn() === "w"), best: r.bestmove, pv: r.info.pv }
          : { ev: { cp: 0 }, best: r.bestmove, pv: [] };
      }
      updateMove(i - 1);
      accuracy();
      if (i - 1 >= 0) {
        const el = root.querySelector(`.mv[data-p="${i}"]`);
        if (el) el.outerHTML = cell(i - 1);
      }
      if (i === cur || i === cur - 1) goto(cur); else graph();
    }
    mine.terminate();
    if (engine === mine) engine = null;
    store.set(`an:${game.key}:${depth}`, res);
    $("status").textContent = `Análise Stockfish 19 · profundidade ${depth}`;
  }

  function stop() { clearInterval(timer); timer = null; $("play").textContent = "▶ Reproduzir"; }
  function play() {
    if (timer) return stop();
    if (cur >= n) goto(0);
    $("play").textContent = "⏸ Pausar";
    timer = setInterval(() => { if (cur >= n) return stop(); goto(cur + 1); }, +$("speed").value);
  }

  const act = {
    first: () => { stop(); goto(0); }, prev: () => { stop(); goto(cur - 1); },
    next: () => { stop(); goto(cur + 1); }, last: () => { stop(); goto(n); },
    play, flip: () => { orientation = orientation === "white" ? "black" : "white"; players(); goto(cur); },
  };
  root.querySelector(".controls").addEventListener("click", (e) => { const a = e.target.closest("button")?.dataset.a; if (a) act[a](); });
  $("speed").addEventListener("change", () => { if (timer) { stop(); play(); } });
  $("moves").addEventListener("click", (e) => { const p = e.target.closest(".mv")?.dataset.p; if (p) { stop(); goto(+p); } });
  $("graph").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    stop(); goto(Math.round(((e.clientX - r.left) / r.width) * n));
  });
  $("depth").addEventListener("change", (e) => { depth = +e.target.value; store.set("depth", depth); analyse(); });
  $("reanalyse").addEventListener("click", () => { try { localStorage.removeItem(`cr:an:${game.key}:${depth}`); } catch { /* ignore */ } analyse(); });

  const onKey = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    const k = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last", " ": "play", f: "flip", F: "flip" }[e.key];
    if (k) { e.preventDefault(); act[k](); }
  };
  window.addEventListener("keydown", onKey);

  players();
  moveList();
  goto(0);
  analyse();

  return () => { alive = false; stop(); engine?.terminate(); cg.destroy(); window.removeEventListener("keydown", onKey); };
}
