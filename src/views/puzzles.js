import { Chess } from "chess.js";
import { Chessground } from "chessground";
import { KINDS } from "../lib/analysis.js";
import { sound } from "../lib/sound.js";
import { myGames, offlineGames, store } from "../lib/sources.js";
import { analyseGame, cachedAnalysis } from "../lib/pipeline.js";
import { allPuzzles, queue, progress, record, status, myColor, meList, lichessPuzzle, liStats, liRecord, DIFFS } from "../lib/puzzles.js";
import { esc } from "../util.js";

const SRC = { chesscom: "chess.com", lichess: "Lichess", offline: "Offline", pgn: "PGN" };
const FILTERS = [["train", "Meus erros"], ["failed", "Errados"], ["all", "Todos"], ["lichess", "🌐 Lichess"]];
const BATCH_SIZES = [5, 20, 50];
const BATCH_DEPTH = 12;

export function renderPuzzles(root) {
  let alive = true;
  let list = [];
  let q = [];
  let idx = 0;
  let filter = store.get("pzFilter") || "train";
  let z = null; // current puzzle
  let chess = null;
  let step = 0;
  let failed = false, hinted = false, finished = false;
  let timers = [];
  let batching = false;
  let diff = store.get("pzDiff") || "easiest";
  let nextLi = null; // prefetched Lichess puzzle promise
  const isLi = () => filter === "lichess";
  const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));

  root.innerHTML = `
    <div class="review play puzzles">
      <div class="board-col">
        <div class="player" id="pTop"></div>
        <div class="board-row">
          <div class="board-wrap" id="wrap" data-theme="${store.get("theme") || "verde"}">
            <div class="board" id="board"></div>
          </div>
        </div>
        <div class="player" id="pBot"></div>
      </div>
      <aside class="panel">
        <div class="panel-head"><span class="ph-title">🧩 Puzzles</span><span class="muted small" id="pos"></span></div>
        <div class="tabs pz-tabs" id="tabs"></div>
        <div class="stage"><div id="status"></div></div>
        <div class="controls play-ctl">
          <button id="hint">💡 Dica</button>
          <button id="sol">👁 Ver solução</button>
          <button id="next" class="primary">Próximo ▶</button>
        </div>
        <div class="pz-stats" id="stats"></div>
        <div class="pz-batch" id="batch"></div>
      </aside>
    </div>`;
  const $ = (id) => root.querySelector(`#${id}`);

  const cg = Chessground($("board"), {
    coordinates: true,
    animation: { enabled: true, duration: 260 },
    movable: { free: false, showDests: true, events: { after: onUserMove } },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: true, visible: true },
  });

  // ---------- helpers ----------
  const uciMove = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const colorName = (c) => (c === "w" ? "brancas" : "pretas");

  function dests() {
    const d = new Map();
    for (const m of chess.moves({ verbose: true })) {
      if (!d.has(m.from)) d.set(m.from, []);
      d.get(m.from).push(m.to);
    }
    return d;
  }

  function sync(lastMove) {
    const myTurn = !finished && chess.turn() === z.color;
    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === "w" ? "white" : "black",
      check: chess.inCheck(),
      lastMove,
      movable: { color: myTurn ? (z.color === "w" ? "white" : "black") : undefined, dests: myTurn ? dests() : new Map() },
    });
  }

  function coach(color, ico, title, text) {
    $("status").innerHTML = `<div class="coach card-in" style="--c:${color}">
      <div class="coach-ico">${ico}</div><div><b>${title}</b><p>${text}</p></div></div>`;
  }

  function prompt() {
    const left = Math.ceil((z.line.length - step) / 2);
    coach("#5c8bb0", "🧩", `${esc(z.theme)} · você de ${colorName(z.color)}`,
      step === 0
        ? z.ext ? `Puzzle do Lichess (rating ${z.ext.rating}). Ache o melhor lance.`
          : `Lance ${z.moveNo} contra <b>${esc(z.opp)}</b>. Aqui você errou na partida. Ache o melhor lance.`
        : `Boa! Continue: ${left} lance${left > 1 ? "s" : ""} pra fechar.`);
  }

  function players() {
    const mine = z.color === "w" ? "Você (brancas)" : "Você (pretas)";
    if (z.ext) {
      $("pTop").innerHTML = `<span class="dot ${z.color === "w" ? "b" : "w"}"></span><b>Lichess</b>`;
      $("pBot").innerHTML = `<span class="dot ${z.color}"></span><b>${mine}</b>`;
      return;
    }
    const top = `<span class="dot ${z.color === "w" ? "b" : "w"}"></span><b>${esc(z.opp)}</b>`;
    $("pTop").innerHTML = top;
    $("pBot").innerHTML = `<span class="dot ${z.color}"></span><b>${mine}</b>`;
  }

  // ---------- puzzle flow ----------
  function show(puzzle) {
    timers.forEach(clearTimeout); timers = [];
    z = puzzle;
    if (!z) return empty();
    step = 0; failed = false; hinted = false; finished = false;
    $("pos").textContent = z.ext ? `#${z.ext.id}` : `${idx + 1}/${q.length}`;
    cg.setAutoShapes([]);
    cg.set({ orientation: z.color === "w" ? "white" : "black" });
    players();
    chess = new Chess(z.prev ? z.prev.fen : z.fen);
    sync(undefined);
    coach("#5c8bb0", "🧩", "Preparando…", "Olha o último lance do adversário.");
    if (z.prev) {
      later(() => {
        const m = chess.move({ from: z.prev.from, to: z.prev.to, promotion: z.prev.promotion });
        sound.play(m, { check: chess.inCheck() });
        chess.load(z.fen);
        sync([z.prev.from, z.prev.to]);
        prompt();
      }, 550);
    } else { chess.load(z.fen); sync(undefined); prompt(); }
    buttons();
  }

  function buttons() {
    $("hint").disabled = !z || finished;
    $("sol").disabled = !z || finished;
  }

  function onUserMove(orig, dest) {
    if (!z || finished) return;
    const expect = z.line[step];
    const piece = chess.get(orig);
    const promo = piece?.type === "p" && (dest[1] === "8" || dest[1] === "1")
      ? (expect.slice(0, 4) === orig + dest && expect[4]) || "q" : "";
    const uci = orig + dest + promo;
    let m;
    try { m = uciMove(chess, uci); } catch { return sync(); }
    const mate = chess.isCheckmate();
    if (uci === expect || mate) {
      sound.play(m, { check: chess.inCheck(), mate });
      cg.setAutoShapes([{ orig: dest, brush: "green" }]);
      step++;
      if (step >= z.line.length || mate) return solved();
      sync([orig, dest]);
      prompt();
      later(() => {
        const r = uciMove(chess, z.line[step]);
        step++;
        sound.play(r, { check: chess.inCheck() });
        cg.setAutoShapes([]);
        sync([r.from, r.to]);
      }, 450);
      return;
    }
    // wrong
    failed = true;
    sound.play(m, { kind: "blunder" });
    cg.setAutoShapes([{ orig: dest, brush: "red" }]);
    sync([orig, dest]);
    coach("#ca3431", "✕", "Não é esse", "Esse lance não resolve. Tente de novo.");
    later(() => { chess.undo(); cg.setAutoShapes([]); sync(); prompt(); }, 750);
  }

  function solved(gaveUp = false) {
    finished = true;
    const clean = !failed && !hinted && !gaveUp;
    sync();
    if (z.ext) return solvedLi(clean, gaveUp);
    const e = record(z.id, clean);
    const k = KINDS[z.kind];
    const bestSan = (() => { const c = new Chess(z.fen); return uciMove(c, z.line[0]).san; })();
    const icon = clean ? "✓" : gaveUp ? "👁" : "✓";
    const title = clean ? (e.streak >= 2 ? "Resolvido · dominado!" : "Resolvido!") : gaveUp ? "Solução" : "Resolvido com ajuda";
    coach(clean ? "#81b64c" : "#f0c15c", icon, title,
      `Na partida você jogou <b>${esc(z.played)}</b> <span class="ico" style="--c:${k.color}">${k.tag}</span> ${k.name.toLowerCase()} (−${z.drop}% de chance).
       O certo era <b>${esc(bestSan)}</b>.${clean ? "" : " Esse volta no treino."}
       <br><a href="#/review/${encodeURIComponent(z.gameKey)}?ply=${z.ply + 1}">Ver na revisão da partida →</a>`);
    if (clean) sound.play({ flags: "", san: "" }, { kind: "great" });
    buttons();
    stats();
  }

  function solvedLi(clean, gaveUp) {
    const s = liRecord(clean);
    coach(clean ? "#81b64c" : "#f0c15c", clean ? "✓" : gaveUp ? "👁" : "✓",
      clean ? `Resolvido! Sequência: ${s.streak}` : gaveUp ? "Solução" : "Resolvido com ajuda",
      `${esc(z.theme)} · rating do puzzle <b>${z.ext.rating}</b>.
       <br><a href="https://lichess.org/training/${encodeURIComponent(z.ext.id)}" target="_blank" rel="noopener">Abrir no Lichess ↗</a>`);
    if (clean) sound.play({ flags: "", san: "" }, { kind: "great" });
    buttons();
    stats();
  }

  // ---------- Lichess mode ----------
  const fetchLi = () => lichessPuzzle(diff).catch((e) => ({ error: e }));
  async function showLi() {
    timers.forEach(clearTimeout); timers = [];
    z = null; buttons();
    coach("#5c8bb0", "🌐", "Buscando puzzle…", "Puzzle do banco do Lichess no nível escolhido.");
    const p = await (nextLi || fetchLi());
    nextLi = null;
    if (!alive || !isLi()) return;
    if (p.error) {
      coach("#ca3431", "!", "Não deu pra buscar", `${esc(p.error.message)} <br><button id="liRetry">Tentar de novo</button>`);
      $("liRetry")?.addEventListener("click", showLi);
      return;
    }
    show(p);
    nextLi = fetchLi(); // prefetch
  }

  function giveUp() {
    if (!z || finished) return;
    failed = true;
    finished = true;
    buttons();
    cg.set({ movable: { color: undefined, dests: new Map() } });
    const rest = z.line.slice(step);
    rest.forEach((u, j) => later(() => {
      const m = uciMove(chess, u);
      sound.play(m, { check: chess.inCheck(), mate: chess.isCheckmate() });
      cg.setAutoShapes(j === 0 && step % 2 === 0 ? [{ orig: m.from, dest: m.to, brush: "green" }] : []);
      cg.set({ fen: chess.fen(), lastMove: [m.from, m.to], check: chess.inCheck() });
      if (j === rest.length - 1) later(() => solved(true), 500);
    }, 300 + j * 750));
  }

  function hint() {
    if (!z || finished) return;
    hinted = true;
    const u = z.line[step];
    cg.setAutoShapes([{ orig: u.slice(0, 2), brush: "yellow" }]);
    coach("#f0c15c", "💡", "Dica", "A peça destacada é a que você deve mover.");
  }

  function next() {
    if (isLi()) return showLi();
    if (!q.length) return;
    idx = (idx + 1) % q.length;
    if (idx === 0) { q = queue(list, filter); }
    show(q[idx]);
  }

  function empty() {
    cg.set({ fen: "8/8/8/8/8/8/8/8 w - - 0 1", movable: { color: undefined, dests: new Map() } });
    $("pTop").innerHTML = ""; $("pBot").innerHTML = ""; $("pos").textContent = "";
    const none = !list.length;
    coach("#5c8bb0", "🧩", none ? "Nenhum puzzle ainda" : "Nada nessa lista",
      (none ? "Os puzzles saem dos seus erros em partidas já analisadas. Analise mais partidas abaixo pra gerar."
        : filter === "failed" ? "Você não tem puzzle errado pendente. 👏" : "Tudo dominado por aqui. Analise mais partidas abaixo pra gerar novos.")
      + ` <br>Ou treine com puzzles do Lichess no seu nível: <button id="goLi">🌐 Puzzles do Lichess</button>`);
    $("goLi")?.addEventListener("click", () => setFilter("lichess"));
    buttons();
  }

  // ---------- lists / stats ----------
  function tabs() {
    const p = progress();
    const cnt = { train: list.filter((x) => status(p[x.id]) !== "mastered").length, failed: list.filter((x) => status(p[x.id]) === "failed").length, all: list.length, lichess: liStats().solved };
    $("tabs").innerHTML = FILTERS.map(([k, v]) => `<button class="tab ${filter === k ? "on" : ""}" data-f="${k}">${v}<small>${cnt[k]}</small></button>`).join("");
  }

  function stats() {
    if (isLi()) {
      const s = liStats();
      $("stats").innerHTML = `
        <span class="m"><b>${s.solved}</b><small>resolvidos</small></span>
        <span class="f"><b>${s.failed}</b><small>errados</small></span>
        <span class="l"><b>${s.streak}</b><small>sequência</small></span>
        <span><b>${s.best}</b><small>recorde</small></span>`;
      return tabs();
    }
    const p = progress();
    const c = { new: 0, failed: 0, learning: 0, mastered: 0 };
    list.forEach((x) => c[status(p[x.id])]++);
    $("stats").innerHTML = `
      <span><b>${c.new}</b><small>novos</small></span>
      <span class="f"><b>${c.failed}</b><small>a revisar</small></span>
      <span class="l"><b>${c.learning}</b><small>aprendendo</small></span>
      <span class="m"><b>${c.mastered}</b><small>dominados</small></span>`;
    tabs();
  }

  async function reload(keepCurrent) {
    list = await allPuzzles();
    if (!alive) return;
    q = queue(list, filter);
    stats();
    if (keepCurrent && z && !finished) { idx = Math.max(0, q.findIndex((x) => x.id === z.id)); $("pos").textContent = `${idx + 1}/${q.length}`; return; }
    idx = 0;
    if (isLi()) return;
    show(q[0]);
  }

  // ---------- batch analysis ----------
  async function pendingGames() {
    const users = store.get("users") || {};
    const me = meList();
    let games = [...offlineGames()];
    if (users.chesscom || users.lichess) {
      const out = await myGames(users);
      games = games.concat(out.filter((r) => r.status === "fulfilled").flatMap((r) => r.value));
    }
    return games
      .filter((g) => g.pgn && myColor(g, me) && !cachedAnalysis(g.key))
      .sort((a, b) => (b.end || 0) - (a.end || 0));
  }

  function diffBox() {
    $("batch").innerHTML = `<div>Nível dos puzzles do Lichess</div>
      <div class="pz-diff">${DIFFS.map(([k, v]) => `<button class="${k === diff ? "on" : ""}" data-d="${k}">${v}</button>`).join("")}</div>
      <small class="muted">Fácil ≈ puzzles de rating 600–1000. Suba quando acertar 5 seguidos.</small>`;
    $("batch").querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
      diff = b.dataset.d; store.set("pzDiff", diff); nextLi = null; diffBox(); showLi();
    }));
  }

  async function batchBox(msg = "") {
    if (batching) return;
    if (isLi()) return diffBox();
    $("batch").innerHTML = `<span class="muted small">Procurando partidas sem análise…</span>`;
    const pend = await pendingGames();
    if (!alive || batching) return;
    if (isLi()) return diffBox(); // tab changed while fetching
    $("batch").innerHTML = pend.length
      ? `<div><b>${pend.length}</b> partida${pend.length > 1 ? "s" : ""} sua${pend.length > 1 ? "s" : ""} ainda sem análise.
           <small class="muted">Cada partida analisada vira puzzles. ~30s por partida.</small></div>
         <div class="pz-diff">${sizes(pend.length).map((n) =>
           `<button data-n="${n}">⚙ Analisar ${n >= pend.length ? `todas (${pend.length})` : n}</button>`).join("")}</div>${msg}`
      : `<span class="muted small">Todas as suas partidas já foram analisadas.</span>${msg}`;
    $("batch").querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => runBatch(pend.slice(0, +b.dataset.n))));
  }

  // 5 / 20 / 50 capped at the pending count, no duplicates
  const sizes = (n) => [...new Set(BATCH_SIZES.map((x) => Math.min(x, n)))];

  async function runBatch(games) {
    batching = true;
    let made = list.length;
    for (let gi = 0; gi < games.length && alive; gi++) {
      const g = games[gi];
      const draw = (i, total) => {
        if (isLi()) return; // difficulty box stays visible in Lichess mode
        const pct = Math.round((i / total) * 100);
        $("batch").innerHTML = `<div class="small">Analisando ${gi + 1}/${games.length}: <b>${esc(g.white)}</b> × <b>${esc(g.black)}</b> <span class="muted">(${SRC[g.src] || g.src})</span></div>
          <div class="pbar"><i style="width:${pct}%"></i></div>`;
      };
      try { await analyseGame(g, { depth: BATCH_DEPTH, onProgress: draw, alive: () => alive }); } catch (e) { console.warn("batch analyse", g.key, e); }
      if (!alive) return;
      await reload(true);
      if (!z && !isLi()) show(q[0]); // first puzzles appear while the batch keeps running
    }
    batching = false;
    if (!alive) return;
    const gained = list.length - made;
    batchBox(`<div class="small ok-msg">+${gained} puzzle${gained === 1 ? "" : "s"} novo${gained === 1 ? "" : "s"}.</div>`);
  }

  // ---------- events ----------
  function setFilter(f) {
    filter = f;
    store.set("pzFilter", filter);
    stats();
    if (!batching) batchBox();
    if (isLi()) return showLi();
    q = queue(list, filter); idx = 0; show(q[0]);
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (b) setFilter(b.dataset.f);
  });
  $("hint").addEventListener("click", hint);
  $("sol").addEventListener("click", giveUp);
  $("next").addEventListener("click", next);
  const onKey = (e) => {
    if (e.target.closest("input,textarea,select")) return;
    if (e.key === "ArrowRight" || e.key === "Enter") next();
  };
  window.addEventListener("keydown", onKey);

  coach("#5c8bb0", "🧩", "Carregando puzzles…", "Lendo suas partidas analisadas.");
  reload(false).then(() => { batchBox(); if (isLi()) showLi(); });

  return () => {
    alive = false;
    timers.forEach(clearTimeout);
    window.removeEventListener("keydown", onKey);
    cg.destroy();
  };
}
