import { Chess } from "chess.js";
import { Chessground } from "chessground";
import { Engine } from "../lib/engine.js";
import { toWhitePov, whiteWinPct, formatEval, classify, KINDS, KIND_ORDER } from "../lib/analysis.js";
import { explain, playLine } from "../lib/explain.js";
import { sound } from "../lib/sound.js";
import { store } from "../lib/sources.js";
import { esc } from "../util.js";

const DEPTHS = [12, 16, 20];
const THEMES = { verde: "Verde", marrom: "Madeira", azul: "Azul" };
const GLYPH = { w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕" }, b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" } };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const KEY_KINDS = ["brilliant", "great", "miss", "mistake", "blunder"];

export const badge = (kind, cls = "") =>
  kind ? `<span class="ico ${cls}" style="--c:${KINDS[kind].color}" title="${KINDS[kind].name}">${KINDS[kind].tag}</span>` : "";

let openingsP = null;
const openings = () => (openingsP ||= import("../data/openings.json").then((m) => m.default));
const posKey = (fen) => fen.split(" ").slice(0, 2).join(" ");

export function renderReview(root, game, me = []) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const n = moves.length;
  const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];

  const isMe = (name) => name && me.includes(String(name).toLowerCase());
  let orientation = game.orient || (isMe(game.black) && !isMe(game.white) ? "black" : "white");
  let depth = store.get("depth") || 16;
  let theme = store.get("theme") || "verde";
  let cur = 0;
  let timer = null;
  let preview = null; // { timer }
  let engine = null;
  let alive = true;
  let done = false;
  const res = new Array(n + 1).fill(null); // { ev, best, pv, second }
  const cls = new Array(n).fill(null); // { kind, accuracy, drop }
  const book = new Array(n).fill(false);
  const openingName = new Array(n).fill(null);

  root.innerHTML = `
    <div class="review">
      <div class="board-col">
        <div class="player" id="pTop"></div>
        <div class="board-row">
          <div class="evalbar" id="bar"><div class="fill" id="barFill"></div><span id="barTxt"></span></div>
          <div class="board-wrap" id="wrap" data-theme="${theme}">
            <div class="board" id="board"></div>
            <div class="overlay" id="overlay"></div>
          </div>
        </div>
        <div class="player" id="pBot"></div>
      </div>
      <aside class="panel">
        <div class="panel-head">
          <span class="ph-title">♞ Revisão da partida</span>
          <div class="menu">
            <button id="menuBtn" class="kebab" title="Opções" aria-haspopup="true" aria-expanded="false">⋯</button>
            <div class="menu-pop" id="menuPop" hidden>
              <label>Tabuleiro
                <select id="theme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}" ${k === theme ? "selected" : ""}>${v}</option>`).join("")}</select></label>
              <label>Profundidade
                <select id="depth">${DEPTHS.map((d) => `<option value="${d}" ${d === depth ? "selected" : ""}>${d}</option>`).join("")}</select></label>
              <button id="mute">${sound.muted ? "🔇 Som desligado" : "🔊 Som ligado"}</button>
              <button data-a="flip">⇅ Virar tabuleiro <kbd>F</kbd></button>
              <button id="reanalyse">↻ Reanalisar</button>
              ${game.url ? `<a href="${esc(game.url)}" target="_blank" rel="noopener">↗ Partida original</a>` : ""}
              <div class="menu-status" id="engineInfo"></div>
            </div>
          </div>
        </div>
        <div class="progress" id="progress"><div class="pbar"><i id="pfill"></i></div><span id="ptxt"></span></div>
        <div class="stage" id="stage"></div>
        <div class="graph-wrap">
          <svg class="graph" id="graph" viewBox="0 0 600 110" preserveAspectRatio="none"></svg>
          <div class="gtip" id="gtip"></div>
        </div>
        <div class="moves" id="moves"></div>
        <div class="controls">
          <button data-a="first" title="Início (Home)">⏮</button>
          <button data-a="prev" title="Voltar (←)">◀</button>
          <button data-a="play" id="play" class="primary" title="Reproduzir (espaço)">▶</button>
          <button data-a="next" title="Avançar (→)">▶</button>
          <button data-a="last" title="Fim (End)">⏭</button>
          <select id="speed" title="Velocidade"><option value="1800">lento</option><option value="1100" selected>normal</option><option value="550">rápido</option></select>
        </div>
      </aside>
    </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const cg = Chessground($("board"), {
    viewOnly: true,
    coordinates: true,
    orientation,
    animation: { enabled: true, duration: 320 },
    drawable: { enabled: false, visible: true },
    highlight: { lastMove: true, check: true },
  });

  // ---------- players & material ----------
  function material(fen) {
    const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const ch of fen.split(" ")[0]) {
      const t = ch.toLowerCase();
      if (cnt.w[t] === undefined) continue;
      cnt[ch === t ? "b" : "w"][t]++;
    }
    const score = (c) => Object.entries(cnt[c]).reduce((s, [t, k]) => s + VAL[t] * k, 0);
    const captured = (c) => { // pieces of color c that are gone
      let s = "";
      for (const t of ["p", "n", "b", "r", "q"]) s += GLYPH[c][t].repeat(Math.max(0, START_COUNT[t] - cnt[c][t]));
      return s;
    };
    return { diff: score("w") - score("b"), capturedW: captured("w"), capturedB: captured("b") };
  }

  function players() {
    const m = material(fens[cur]);
    const acc = (c) => {
      const a = cls.filter((x, i) => x && moves[i].color === c).map((x) => x.accuracy);
      return done && a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : null;
    };
    const line = (color) => {
      const name = color === "w" ? game.white : game.black;
      const elo = color === "w" ? game.whiteElo : game.blackElo;
      const caps = color === "w" ? m.capturedB : m.capturedW;
      const adv = color === "w" ? m.diff : -m.diff;
      const r = game.result === "1-0" ? (color === "w" ? "1" : "0") : game.result === "0-1" ? (color === "w" ? "0" : "1") : game.result === "1/2-1/2" ? "½" : "";
      const a = acc(color);
      return `<span class="avatar ${color}">${esc(String(name || "?")[0].toUpperCase())}</span>
        <span class="pname"><b>${esc(name || "?")}</b>${elo ? ` <small>(${esc(elo)})</small>` : ""}
        <span class="caps">${caps}${adv > 0 ? ` <small>+${adv}</small>` : ""}</span></span>
        ${a ? `<span class="pacc" title="Precisão">${a}</span>` : ""}
        <span class="res">${r}</span>`;
    };
    $("pTop").innerHTML = line(orientation === "white" ? "b" : "w");
    $("pBot").innerHTML = line(orientation === "white" ? "w" : "b");
  }

  // ---------- move list ----------
  function moveList() {
    let html = "";
    for (let i = 0; i < n; i += 2) {
      html += `<div class="mrow"><span class="mno">${i / 2 + 1}.</span>${cell(i)}${i + 1 < n ? cell(i + 1) : "<span></span>"}</div>`;
    }
    $("moves").innerHTML = html;
  }
  function cell(i) {
    const k = cls[i]?.kind;
    return `<span class="mv ${i + 1 === cur ? "cur" : ""}" data-p="${i + 1}">${k ? badge(k, "sm") : ""}${esc(moves[i].san)}</span>`;
  }
  function updateCell(i) {
    const el = root.querySelector(`.mv[data-p="${i + 1}"]`);
    if (el) el.outerHTML = cell(i);
  }

  // ---------- eval bar & graph ----------
  function evalBar(ev) {
    const wp = whiteWinPct(ev);
    $("barFill").style.height = `${orientation === "white" ? wp : 100 - wp}%`;
    $("bar").classList.toggle("flipped", orientation === "black");
    $("bar").classList.toggle("black-adv", wp < 50);
    $("barTxt").textContent = ev ? formatEval(ev).replace(/^\+/, "") : "";
  }

  const gx = (i) => (i / Math.max(1, n)) * 600;
  const gy = (ev) => 110 - (whiteWinPct(ev) / 100) * 110;
  function graph() {
    const pts = [];
    for (let i = 0; i <= n; i++) if (res[i]) pts.push([gx(i), gy(res[i].ev)]);
    let svg = `<line x1="0" y1="55" x2="600" y2="55" class="mid"/>`;
    if (pts.length > 1) {
      const d = pts.map((p, j) => `${j ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
      svg += `<path class="area" d="M0,110 ${d.replace(/^M/, "L")} L${pts[pts.length - 1][0]},110 Z"/>`;
      svg += `<path class="line" d="${d}"/>`;
    }
    svg += `<line x1="${gx(cur)}" y1="0" x2="${gx(cur)}" y2="110" class="cursor"/>`;
    for (let i = 0; i < n; i++) {
      const k = cls[i]?.kind;
      if (KEY_KINDS.includes(k) && res[i + 1]) {
        svg += `<circle cx="${gx(i + 1)}" cy="${gy(res[i + 1].ev)}" r="${i + 1 === cur ? 6 : 4.5}" fill="${KINDS[k].color}" stroke="#1f1e1b" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
      }
    }
    $("graph").innerHTML = svg;
  }

  // ---------- board decorations ----------
  function squarePos(sq) {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
    return orientation === "white" ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
  }

  function decorate() {
    const mv = moves[cur - 1];
    const k = cls[cur - 1]?.kind;
    const custom = new Map();
    if (mv && k) {
      custom.set(mv.from, `hl hl-${k}`);
      custom.set(mv.to, `hl hl-${k}`);
    }
    cg.set({ highlight: { lastMove: !k, check: true, custom } });

    const shapes = [];
    if (mv && k && !["best", "brilliant", "great", "book"].includes(k) && res[cur - 1]?.best) {
      const b = res[cur - 1].best;
      shapes.push({ orig: b.slice(0, 2), dest: b.slice(2, 4), brush: "green" });
    }
    cg.setAutoShapes(shapes);

    const ov = $("overlay");
    if (mv && k) {
      const { col, row } = squarePos(mv.to);
      ov.innerHTML = `<div class="board-badge" style="--c:${KINDS[k].color};left:${(col + 1) * 12.5}%;top:${row * 12.5}%">${KINDS[k].tag}</div>`;
    } else ov.innerHTML = "";
  }

  // ---------- coach / summary stage ----------
  function accuracyOf(c) {
    const a = cls.filter((x, i) => x && moves[i].color === c).map((x) => x.accuracy);
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  }

  function summary() {
    const count = (c, k) => cls.filter((x, i) => x && moves[i].color === c && x.kind === k).length;
    const key = [];
    cls.forEach((x, i) => { if (x && KEY_KINDS.includes(x.kind)) key.push(i); });
    $("stage").innerHTML = `
      <div class="summary card-in">
        <div class="sum-acc">
          <div class="sa"><span class="avatar w">${esc(String(game.white || "?")[0].toUpperCase())}</span><small>${esc(game.white)}</small><b data-count="${accuracyOf("w").toFixed(1)}">0.0</b><small>precisão</small></div>
          <div class="sa-vs">${esc(game.result || "")}</div>
          <div class="sa"><span class="avatar b">${esc(String(game.black || "?")[0].toUpperCase())}</span><small>${esc(game.black)}</small><b data-count="${accuracyOf("b").toFixed(1)}">0.0</b><small>precisão</small></div>
        </div>
        <table class="kinds">
          ${KIND_ORDER.map((k) => `<tr class="${count("w", k) + count("b", k) ? "" : "zero"}"><td class="kc">${count("w", k)}</td><td class="kn">${badge(k)}<span style="color:${KINDS[k].color}">${KINDS[k].name}</span></td><td class="kc">${count("b", k)}</td></tr>`).join("")}
        </table>
        ${key.length ? `<div class="keym"><small>Momentos-chave</small><div class="kcards">${key.map((i) => `
          <button class="kcard" data-p="${i + 1}" style="--c:${KINDS[cls[i].kind].color}">
            ${badge(cls[i].kind)}
            <span class="kc-body">
              <b>${Math.ceil((i + 1) / 2)}${moves[i].color === "w" ? "." : "..."} ${esc(moves[i].san)}</b>
              <small>${KINDS[cls[i].kind].name}</small>
            </span>
            <span class="kc-ev">${formatEval(res[i].ev)} → ${formatEval(res[i + 1].ev)}</span>
          </button>`).join("")}</div></div>` : ""}
        <button class="start" id="start">▶ Começar revisão</button>
      </div>`;
    root.querySelectorAll("[data-count]").forEach((el) => countUp(el, +el.dataset.count));
    $("start").addEventListener("click", () => { goto(1); play(); });
  }

  function countUp(el, target) {
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      el.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(1);
      if (p < 1 && alive) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function coach() {
    const mv = moves[cur - 1];
    const stage = $("stage");
    root.querySelector(".panel").classList.toggle("summary-mode", !mv && done);
    if (!mv) {
      if (done) return summary();
      stage.innerHTML = `<div class="coach card-in"><div class="coach-ico">♞</div><div><div class="ctitle">Analisando a partida…</div><p>O Stockfish está avaliando cada lance. Você já pode navegar pela partida enquanto isso.</p></div></div>`;
      return;
    }
    const k = cls[cur - 1]?.kind;
    const no = `${Math.ceil(cur / 2)}${mv.color === "w" ? "." : "..."}`;
    if (!k) {
      stage.innerHTML = `<div class="coach card-in"><div class="coach-ico pending">…</div><div><div class="ctitle">${no} ${esc(mv.san)}</div><p>Analisando esse lance…</p></div></div>`;
      return;
    }
    const r0 = res[cur - 1], r1 = res[cur];
    const e = explain(fens[cur - 1], { uci: mv.lan, san: mv.san, color: mv.color }, {
      kind: k, evalBefore: r0.ev, evalAfter: r1.ev, evalSecond: r0.second, bestPv: r0.pv, replyPv: r1.pv, opening: openingName[cur - 1],
    });
    const canBest = r0.pv?.length && !["best", "brilliant", "great", "book"].includes(k);
    stage.innerHTML = `
      <div class="coach card-in" style="--c:${KINDS[k].color}">
        <div class="coach-ico" style="--c:${KINDS[k].color}">${KINDS[k].tag}</div>
        <div class="cbody">
          <div class="ctitle"><small>${no}</small> ${esc(e.title)}</div>
          <p>${esc(e.text)}</p>
          <div class="cact">
            ${canBest ? `<button id="showBest">💡 Ver melhor lance${e.bestSan ? ` (${esc(e.bestSan)})` : ""}</button>` : ""}
            <span class="ceval">${formatEval(r1.ev)}</span>
          </div>
        </div>
      </div>`;
    $("showBest")?.addEventListener("click", () => showLine(fens[cur - 1], r0.pv));
  }

  // ---------- engine line preview ----------
  function stopPreview() {
    if (!preview) return false;
    clearInterval(preview.timer);
    preview = null;
    root.querySelector(".board-wrap").classList.remove("previewing");
    return true;
  }

  function showLine(fen, pv) {
    stop(); stopPreview();
    const line = playLine(fen, pv, 6);
    if (!line.verbose.length) return;
    let j = 0;
    root.querySelector(".board-wrap").classList.add("previewing");
    $("overlay").innerHTML = `<div class="preview-tag">Linha do motor · <a href="#" id="exitPrev">voltar à partida</a></div>`;
    $("exitPrev").addEventListener("click", (ev) => { ev.preventDefault(); stopPreview(); goto(cur); });
    cg.set({ fen, lastMove: undefined, highlight: { lastMove: true, custom: new Map() } });
    cg.setAutoShapes([]);
    const step = () => {
      if (j >= line.verbose.length) { clearInterval(preview?.timer); return; }
      const m = line.verbose[j++];
      const c = new Chess(m.after);
      cg.set({ fen: m.after, lastMove: [m.from, m.to], check: c.inCheck() ? (c.turn() === "w" ? "white" : "black") : false });
      cg.setAutoShapes([{ orig: m.from, dest: m.to, brush: m.color === line.verbose[0].color ? "green" : "red" }]);
      sound.play(m, { check: c.inCheck(), mate: c.isCheckmate() });
    };
    step();
    preview = { timer: setInterval(step, 1000) };
  }

  // ---------- navigation ----------
  function goto(p, { withSound = false } = {}) {
    stopPreview();
    const prev = cur;
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
    if (withSound || (cur === prev + 1 && mv)) sound.play(mv, { check: c.inCheck(), mate: c.isCheckmate(), kind: cls[cur - 1]?.kind });
    decorate();
    evalBar(res[cur]?.ev);
    root.querySelectorAll(".mv.cur").forEach((e) => e.classList.remove("cur"));
    const el = root.querySelector(`.mv[data-p="${cur}"]`);
    if (el) {
      el.classList.add("cur");
      const box = $("moves");
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2;
    }
    graph();
    coach();
    players();
  }

  // ---------- analysis ----------
  async function markBook() {
    const map = await openings();
    for (let i = 0; i < n; i++) {
      const name = map[posKey(fens[i + 1])];
      if (!name) break;
      book[i] = true;
      openingName[i] = name;
    }
  }

  function updateMove(i) {
    if (i < 0 || i >= n || !res[i] || !res[i + 1]) return;
    cls[i] = classify({
      before: res[i].ev, after: res[i + 1].ev, second: res[i].second, mover: moves[i].color,
      played: moves[i].lan, best: res[i].best, fenBefore: fens[i], book: book[i], prevKind: cls[i - 1]?.kind,
    });
  }

  function setProgress(i) {
    const pct = Math.round((i / (n + 1)) * 100);
    $("pfill").style.width = `${pct}%`;
    $("ptxt").textContent = `Analisando ${i}/${n + 1} posições · ${pct}%`;
    $("engineInfo").textContent = done ? `Stockfish 19 · profundidade ${depth}` : `Analisando… ${pct}%`;
    $("progress").classList.toggle("done", done);
  }

  async function analyse() {
    engine?.terminate();
    engine = null;
    done = false;
    res.fill(null); cls.fill(null);
    await markBook();
    if (!alive) return;
    const cached = store.get(`an2:${game.key}:${depth}`);
    if (cached && cached.length === n + 1) {
      cached.forEach((r, i) => (res[i] = r));
      for (let i = 0; i < n; i++) updateMove(i);
      done = true;
      setProgress(n + 1);
      moveList(); goto(cur);
      return;
    }
    const mine = (engine = new Engine());
    moveList(); goto(cur);
    for (let i = 0; i <= n; i++) {
      if (!alive || engine !== mine) return;
      setProgress(i);
      const c = new Chess(fens[i]);
      if (c.isCheckmate()) res[i] = { ev: { cp: c.turn() === "w" ? -100000 : 100000, final: "mate" }, best: null, pv: [], second: null };
      else if (c.isDraw() || c.isStalemate()) res[i] = { ev: { cp: 0, final: "draw" }, best: null, pv: [], second: null };
      else {
        const r = await mine.analyse(fens[i], depth);
        if (engine !== mine || !alive) return;
        const wtm = c.turn() === "w";
        res[i] = {
          ev: r.info ? toWhitePov(r.info, wtm) : { cp: 0 },
          best: r.bestmove,
          pv: r.info?.pv || [],
          second: r.second ? toWhitePov(r.second, wtm) : null,
        };
      }
      updateMove(i - 1);
      if (i >= 1) updateCell(i - 1);
      if (i === cur || i === cur - 1) { decorate(); evalBar(res[cur]?.ev); coach(); }
      graph();
    }
    mine.terminate();
    engine = null;
    done = true;
    store.set(`an2:${game.key}:${depth}`, res);
    setProgress(n + 1);
    players();
    if (cur === 0) coach();
  }

  // ---------- playback ----------
  function stop() { clearInterval(timer); timer = null; $("play").textContent = "▶"; $("play").classList.remove("on"); }
  function play() {
    if (timer) return stop();
    if (cur >= n) goto(0);
    $("play").textContent = "⏸";
    $("play").classList.add("on");
    const tick = () => { if (cur >= n) return stop(); goto(cur + 1); };
    tick();
    timer = setInterval(tick, +$("speed").value);
  }

  const act = {
    first: () => { stop(); goto(0); }, prev: () => { stop(); goto(cur - 1); },
    next: () => { stop(); goto(cur + 1); }, last: () => { stop(); goto(n); },
    play, flip: () => { orientation = orientation === "white" ? "black" : "white"; goto(cur); },
  };
  root.querySelector(".review").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-a]")?.dataset.a;
    if (a) return act[a]();
    const p = e.target.closest("[data-p]")?.dataset.p;
    if (p) { stop(); goto(+p); }
  });
  $("speed").addEventListener("change", () => { if (timer) { stop(); play(); } });
  $("theme").addEventListener("change", (e) => { theme = e.target.value; store.set("theme", theme); $("wrap").dataset.theme = theme; });
  $("mute").addEventListener("click", (e) => { e.currentTarget.textContent = sound.toggle() ? "🔇 Som desligado" : "🔊 Som ligado"; });

  // "⋯" options menu
  const menuBtn = $("menuBtn"), menuPop = $("menuPop");
  const setMenu = (open) => { menuPop.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menuPop.hidden); });
  const onDocClick = (e) => { if (!e.target.closest(".menu")) setMenu(false); };
  document.addEventListener("click", onDocClick);

  const gIndex = (e) => {
    const r = $("graph").getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)));
  };
  $("graph").addEventListener("click", (e) => { stop(); goto(gIndex(e)); });
  $("graph").addEventListener("mousemove", (e) => {
    const i = gIndex(e);
    const tip = $("gtip");
    const r = $("graph").getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = `${Math.min(r.width - 120, Math.max(0, e.clientX - r.left - 60))}px`;
    tip.innerHTML = i === 0 ? "Início" : `${Math.ceil(i / 2)}${moves[i - 1].color === "w" ? "." : "..."} ${esc(moves[i - 1].san)} ${badge(cls[i - 1]?.kind, "sm")} <b>${formatEval(res[i]?.ev)}</b>`;
  });
  $("graph").addEventListener("mouseleave", () => { $("gtip").style.display = "none"; });
  $("depth").addEventListener("change", (e) => { depth = +e.target.value; store.set("depth", depth); analyse(); });
  $("reanalyse").addEventListener("click", () => { try { localStorage.removeItem(`cr:an2:${game.key}:${depth}`); } catch { /* ignore */ } analyse(); });

  const onKey = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    const k = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last", " ": "play", f: "flip", F: "flip" }[e.key];
    if (e.key === "Escape") return setMenu(false);
    if (k) { e.preventDefault(); act[k](); }
  };
  window.addEventListener("keydown", onKey);

  moveList();
  goto(0);
  analyse();

  return () => { alive = false; stop(); stopPreview(); engine?.terminate(); cg.destroy(); window.removeEventListener("keydown", onKey); document.removeEventListener("click", onDocClick); };
}
