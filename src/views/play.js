import { Chess } from "chess.js";
import { Chessground } from "chessground";
import { Engine } from "../lib/engine.js";
import { toWhitePov, whiteWinPct, formatEval } from "../lib/analysis.js";
import { sound } from "../lib/sound.js";
import { saveOffline, store } from "../lib/sources.js";
import { esc } from "../util.js";

// Strength ladder: Stockfish "Skill Level" + depth/time caps. Elo is a rough guide.
const LEVELS = [
  { skill: 0, depth: 1, ms: 120, elo: "~400" },
  { skill: 2, depth: 2, ms: 150, elo: "~700" },
  { skill: 5, depth: 4, ms: 200, elo: "~1000" },
  { skill: 8, depth: 6, ms: 300, elo: "~1300" },
  { skill: 11, depth: 8, ms: 500, elo: "~1600" },
  { skill: 14, depth: 11, ms: 700, elo: "~1900" },
  { skill: 17, depth: 14, ms: 1000, elo: "~2200" },
  { skill: 20, depth: null, ms: 1500, elo: "2800+" },
];
const CLOCKS = { none: "Sem relógio", "3+2": "3+2", "5+3": "5+3", "10+0": "10 min", "15+10": "15+10" };
const PIECE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

let openingsP = null;
const openings = () => (openingsP ||= import("../data/openings.json").then((m) => m.default));

export function renderPlay(root) {
  const cfg = { color: "white", level: 3, clock: "none", ...(store.get("playCfg") || {}) };
  let cleanup = () => {};

  function setup() {
    root.innerHTML = `
      <section class="setup card-in">
        <h1>🤖 Jogar contra o Stockfish</h1>
        <p class="muted">Roda offline no seu navegador. No fim você pode revisar a partida lance a lance.</p>
        <h3>Você joga de</h3>
        <div class="opts" id="oColor">
          ${[["white", "♔", "Brancas"], ["random", "⚄", "Aleatório"], ["black", "♚", "Pretas"]]
            .map(([k, i, l]) => `<button class="opt ${cfg.color === k ? "on" : ""}" data-v="${k}"><span class="oi">${i}</span>${l}</button>`).join("")}
        </div>
        <h3>Nível</h3>
        <div class="opts levels" id="oLevel">
          ${LEVELS.map((l, i) => `<button class="opt ${cfg.level === i ? "on" : ""}" data-v="${i}"><b>${i + 1}</b><small>${l.elo}</small></button>`).join("")}
        </div>
        <h3>Relógio</h3>
        <div class="opts" id="oClock">
          ${Object.entries(CLOCKS).map(([k, v]) => `<button class="opt ${cfg.clock === k ? "on" : ""}" data-v="${k}">${v}</button>`).join("")}
        </div>
        <button class="start" id="go">▶ Começar partida</button>
      </section>`;
    const pick = (id, key, num) => root.querySelector(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      cfg[key] = num ? +b.dataset.v : b.dataset.v;
      root.querySelectorAll(`${id} .opt`).forEach((x) => x.classList.toggle("on", x === b));
    });
    pick("#oColor", "color"); pick("#oLevel", "level", true); pick("#oClock", "clock");
    root.querySelector("#go").addEventListener("click", () => {
      store.set("playCfg", cfg);
      cleanup = game();
    });
  }

  function game() {
    const me = cfg.color === "random" ? (Math.random() < 0.5 ? "white" : "black") : cfg.color;
    const myC = me[0];
    const lvl = LEVELS[cfg.level];
    const botName = `Stockfish nível ${cfg.level + 1}`;
    const chess = new Chess();
    const engine = new Engine({ multipv: 1, skill: lvl.skill });
    let helper = null; // full-strength engine for hint / live eval
    let orientation = me;
    let over = null; // { result, reason }
    let thinking = false;
    let showEval = !!store.get("playEval");
    let alive = true;
    const [base, inc] = cfg.clock === "none" ? [0, 0] : cfg.clock.split("+").map(Number);
    const clock = { w: base * 60000, b: base * 60000, last: 0, timer: null, on: cfg.clock !== "none" };

    root.innerHTML = `
      <div class="review play">
        <div class="board-col">
          <div class="player" id="pTop"></div>
          <div class="board-row">
            <div class="evalbar ${showEval ? "" : "off"}" id="bar"><div class="fill" id="barFill"></div><span id="barTxt"></span></div>
            <div class="board-wrap" id="wrap" data-theme="${store.get("theme") || "verde"}">
              <div class="board" id="board"></div>
              <div class="overlay" id="overlay"></div>
            </div>
          </div>
          <div class="player" id="pBot"></div>
        </div>
        <aside class="panel">
          <div class="panel-head"><span class="ph-title">🤖 vs ${esc(botName)} <small class="muted">${lvl.elo}</small></span></div>
          <div class="stage"><div class="coach" id="status"></div></div>
          <div class="moves" id="moves"></div>
          <div class="controls play-ctl">
            <button id="hint" title="Dica">💡 Dica</button>
            <button id="undo" title="Voltar lance">↶ Voltar</button>
            <button id="flip" title="Virar (F)">⇅</button>
            <button id="evalT" title="Avaliação ao vivo">${showEval ? "📊 on" : "📊 off"}</button>
            <button id="resign" class="danger" title="Desistir">⚑ Desistir</button>
          </div>
        </aside>
      </div>`;
    const $ = (id) => root.querySelector(`#${id}`);

    const cg = Chessground($("board"), {
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 260 },
      movable: { free: false, color: me, showDests: true, events: { after: onUserMove } },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, visible: true },
    });

    function dests() {
      const d = new Map();
      for (const m of chess.moves({ verbose: true })) {
        if (!d.has(m.from)) d.set(m.from, []);
        d.get(m.from).push(m.to);
      }
      return d;
    }

    const fmt = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };

    function material() {
      const start = { p: 8, n: 2, b: 2, r: 2, q: 1 }, val = { p: 1, n: 3, b: 3, r: 5, q: 9 };
      const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
      for (const row of chess.board()) for (const p of row) if (p && p.type !== "k") cnt[p.color][p.type]++;
      const glyph = { w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕" }, b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" } };
      const lost = (c) => ["p", "n", "b", "r", "q"].map((t) => glyph[c][t].repeat(Math.max(0, start[t] - cnt[c][t]))).join("");
      const score = (c) => Object.entries(cnt[c]).reduce((s, [t, k]) => s + val[t] * k, 0);
      return { lostW: lost("w"), lostB: lost("b"), diff: score("w") - score("b") };
    }

    function players() {
      const m = material();
      const line = (c) => {
        const isMe = c === myC;
        const name = isMe ? "Você" : botName;
        const caps = c === "w" ? m.lostB : m.lostW;
        const adv = c === "w" ? m.diff : -m.diff;
        const active = !over && chess.turn() === c;
        return `<span class="avatar ${c}">${isMe ? "🙂" : "🤖"}</span>
          <span class="pname"><b>${name}</b>${isMe ? "" : ` <small>${lvl.elo}</small>`}
          <span class="caps">${caps}${adv > 0 ? ` <small>+${adv}</small>` : ""}</span></span>
          ${clock.on ? `<span class="clock ${active ? "run" : ""} ${clock[c] < 20000 ? "low" : ""}">${fmt(clock[c])}</span>` : ""}`;
      };
      $("pTop").innerHTML = line(orientation === "white" ? "b" : "w");
      $("pBot").innerHTML = line(orientation === "white" ? "w" : "b");
    }

    function moveList() {
      const h = chess.history();
      let html = "";
      for (let i = 0; i < h.length; i += 2) {
        html += `<div class="mrow"><span class="mno">${i / 2 + 1}.</span><span class="mv ${i === h.length - 1 ? "cur" : ""}">${esc(h[i])}</span>${h[i + 1] ? `<span class="mv ${i + 1 === h.length - 1 ? "cur" : ""}">${esc(h[i + 1])}</span>` : "<span></span>"}</div>`;
      }
      $("moves").innerHTML = html || `<p class="muted" style="padding:8px 12px">Nenhum lance ainda.</p>`;
      $("moves").scrollTop = $("moves").scrollHeight;
    }

    function status(text, cls = "") {
      $("status").className = `coach ${cls}`;
      $("status").innerHTML = text;
    }

    function sync(last) {
      const turn = chess.turn() === "w" ? "white" : "black";
      cg.set({
        fen: chess.fen(),
        turnColor: turn,
        orientation,
        lastMove: last ? [last.from, last.to] : undefined,
        check: chess.inCheck() ? turn : false,
        movable: { color: over || thinking ? undefined : me, dests: over || thinking ? new Map() : dests() },
      });
      cg.setAutoShapes([]);
      players();
      moveList();
      if (!over) {
        status(chess.turn() === myC
          ? `<div class="coach-ico" style="--c:#81b64c">♟</div><div><div class="ctitle">Sua vez</div><p>${chess.inCheck() ? "Você está em xeque!" : "Arraste ou clique numa peça pra jogar."}</p></div>`
          : `<div class="coach-ico pending" style="--c:#5c8bb0">🤖</div><div><div class="ctitle">Stockfish pensando…</div><p>Nível ${cfg.level + 1} (${lvl.elo}).</p></div>`);
      }
      if (showEval) liveEval();
    }

    // Full-strength helper engine (hint + live eval), one search at a time.
    let hq = Promise.resolve();
    const helperAnalyse = (fen, depth) => (hq = hq.then(() => (helper ||= new Engine({ multipv: 1 })).analyse(fen, depth)));

    let evalSeq = 0;
    async function liveEval() {
      const seq = ++evalSeq;
      const fen = chess.fen();
      const r = await helperAnalyse(fen, 12);
      if (seq !== evalSeq || !alive || !r.info) return;
      const ev = toWhitePov(r.info, fen.split(" ")[1] === "w");
      const wp = whiteWinPct(ev);
      $("barFill").style.height = `${orientation === "white" ? wp : 100 - wp}%`;
      $("bar").classList.toggle("flipped", orientation === "black");
      $("bar").classList.toggle("black-adv", wp < 50);
      $("barTxt").textContent = formatEval(ev).replace(/^\+/, "");
    }

    function tickClock() {
      if (!clock.on || over) return;
      const now = performance.now();
      const c = chess.turn();
      clock[c] -= now - clock.last;
      clock.last = now;
      if (clock[c] <= 0) {
        clock[c] = 0;
        return finish(c === "w" ? "0-1" : "1-0", "tempo");
      }
      players();
    }
    function switchClock(mover) {
      if (!clock.on) return;
      const now = performance.now();
      if (clock.timer) clock[mover] -= now - clock.last;
      clock[mover] += inc * 1000;
      clock.last = now;
      if (!clock.timer) clock.timer = setInterval(tickClock, 200);
    }

    function applyMove(mv) {
      const played = chess.move(mv);
      switchClock(played.color);
      sound.play(played, { check: chess.inCheck(), mate: chess.isCheckmate() });
      if (chess.isGameOver()) {
        let result = "1/2-1/2", reason = "empate";
        if (chess.isCheckmate()) { result = chess.turn() === "w" ? "0-1" : "1-0"; reason = "xeque-mate"; }
        else if (chess.isStalemate()) reason = "afogamento";
        else if (chess.isThreefoldRepetition()) reason = "repetição";
        else if (chess.isInsufficientMaterial()) reason = "material insuficiente";
        else reason = "regra dos 50 lances";
        sync(played);
        finish(result, reason);
        return played;
      }
      sync(played);
      return played;
    }

    function onUserMove(from, to) {
      const piece = chess.get(from);
      const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
      if (promo) return askPromotion(from, to);
      applyMove({ from, to });
      if (!over) botMove();
    }

    function askPromotion(from, to) {
      const ov = $("overlay");
      ov.innerHTML = `<div class="promo">${["q", "r", "b", "n"].map((t) =>
        `<button data-t="${t}" class="cg-wrap"><piece class="${me} ${PIECE[t]}"></piece></button>`).join("")}</div>`;
      ov.querySelector(".promo").addEventListener("click", (e) => {
        const t = e.target.closest("[data-t]")?.dataset.t;
        if (!t) return;
        ov.innerHTML = "";
        applyMove({ from, to, promotion: t });
        if (!over) botMove();
      });
    }

    async function botMove() {
      thinking = true;
      sync(chess.history({ verbose: true }).at(-1));
      const fen = chess.fen();
      const t0 = performance.now();
      const uci = await engine.move(fen, lvl.ms, lvl.depth);
      const minDelay = 350 - (performance.now() - t0); // feel natural on low levels
      if (minDelay > 0) await new Promise((r) => setTimeout(r, minDelay));
      if (!alive || over || chess.fen() !== fen) { thinking = false; return; }
      thinking = false;
      applyMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }

    function finish(result, reason) {
      if (over) return;
      over = { result, reason };
      clearInterval(clock.timer);
      cg.set({ movable: { color: undefined, dests: new Map() } });
      players();
      const won = (result === "1-0" && myC === "w") || (result === "0-1" && myC === "b");
      const title = result === "1/2-1/2" ? "Empate" : won ? "Você venceu! 🎉" : "Stockfish venceu";
      const key = `offline-${Date.now().toString(36)}`;

      const pgnChess = new Chess();
      for (const m of chess.history({ verbose: true })) pgnChess.move(m.san);
      const headers = {
        Event: "Chess Review · Offline", Site: "Chess Review", Date: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
        White: myC === "w" ? "Você" : botName, Black: myC === "b" ? "Você" : botName, Result: result,
        TimeControl: cfg.clock, Termination: reason,
      };
      for (const [k, v] of Object.entries(headers)) pgnChess.setHeader(k, v);
      const game = {
        key, src: "offline", id: key, pgn: pgnChess.pgn(), white: headers.White, black: headers.Black,
        whiteElo: myC === "w" ? "" : lvl.elo, blackElo: myC === "b" ? "" : lvl.elo, result, end: Date.now(),
        speed: "offline", tc: cfg.clock === "none" ? "" : CLOCKS[cfg.clock], fen: chess.fen(), moves: Math.ceil(chess.history().length / 2),
        opening: "", ending: reason, acc: null, orient: me,
      };
      openings().then((map) => {
        const c = new Chess();
        for (const m of chess.history()) { c.move(m); const n = map[c.fen().split(" ").slice(0, 2).join(" ")]; if (n) game.opening = n.replace(/^\S+\s/, ""); }
      }).finally(() => saveOffline(game));
      saveOffline(game);

      $("overlay").innerHTML = `
        <div class="endmodal card-in">
          <div class="em-title ${won ? "win" : result === "1/2-1/2" ? "draw" : "loss"}">${title}</div>
          <div class="muted">por ${esc(reason)} · ${chess.history().length ? Math.ceil(chess.history().length / 2) : 0} lances</div>
          <button class="start" id="toReview">⭐ Revisar partida</button>
          <div class="em-row"><button id="again">↻ Revanche</button><button id="newg">⚙ Nova partida</button></div>
        </div>`;
      status(`<div class="coach-ico" style="--c:${won ? "#81b64c" : result === "1/2-1/2" ? "#97af8b" : "#ca3431"}">${won ? "🏆" : result === "1/2-1/2" ? "½" : "🤖"}</div><div><div class="ctitle">${title}</div><p>Fim por ${esc(reason)}. Revise pra ver onde a partida foi decidida.</p></div>`);
      $("toReview").addEventListener("click", () => { location.hash = `#/review/${encodeURIComponent(key)}`; });
      $("again").addEventListener("click", () => { teardown(); cleanup = game(); });
      $("newg").addEventListener("click", () => { teardown(); setup(); });
    }

    $("resign").addEventListener("click", () => { if (!over && chess.history().length) finish(myC === "w" ? "0-1" : "1-0", "abandono"); });
    $("undo").addEventListener("click", () => {
      if (over || thinking) return;
      const n = chess.history().length;
      if (!n) return;
      chess.undo();
      if (chess.turn() !== myC && chess.history().length) chess.undo();
      sync(chess.history({ verbose: true }).at(-1));
      if (chess.turn() !== myC) botMove();
    });
    $("flip").addEventListener("click", () => { orientation = orientation === "white" ? "black" : "white"; sync(chess.history({ verbose: true }).at(-1)); });
    $("evalT").addEventListener("click", (e) => {
      showEval = !showEval; store.set("playEval", showEval);
      e.currentTarget.textContent = showEval ? "📊 on" : "📊 off";
      $("bar").classList.toggle("off", !showEval);
      if (showEval) liveEval();
    });
    $("hint").addEventListener("click", async () => {
      if (over || thinking || chess.turn() !== myC) return;
      const fen = chess.fen();
      $("hint").disabled = true;
      const r = await helperAnalyse(fen, 14);
      $("hint").disabled = false;
      if (chess.fen() !== fen || !r.bestmove) return;
      cg.setAutoShapes([{ orig: r.bestmove.slice(0, 2), dest: r.bestmove.slice(2, 4), brush: "blue" }]);
    });
    const onKey = (e) => { if ((e.key === "f" || e.key === "F") && !e.target.closest("input")) $("flip").click(); };
    window.addEventListener("keydown", onKey);

    function teardown() {
      alive = false;
      clearInterval(clock.timer);
      engine.terminate();
      helper?.terminate();
      cg.destroy();
      window.removeEventListener("keydown", onKey);
    }

    sync();
    if (me === "black") botMove();
    return teardown;
  }

  setup();
  return () => cleanup();
}
