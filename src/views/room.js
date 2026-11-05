import { Chess } from "chess.js";
import { Chessground } from "chessground";
import { Peer } from "peerjs";
import { sound } from "../lib/sound.js";
import { saveOffline, store } from "../lib/sources.js";
import { esc } from "../util.js";

// Two-player room over WebRTC (PeerJS public signalling server). No account needed.
const CLOCKS = { none: "Sem relógio", "3+2": "3+2", "5+3": "5+3", "10+0": "10 min", "15+10": "15+10" };
const PIECE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PREFIX = "chessreview-";

const ss = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const defaultNick = () => {
  const u = store.get("users") || {};
  return store.get("nick") || u.chesscom || u.lichess || "Jogador";
};

export function renderRoom(root, roomId, query) {
  let teardown = () => {};
  const invite = new URLSearchParams(query).get("invite");

  if (!roomId) setupScreen();
  else start(roomId, ss.get(`room-host:${roomId}`));

  function setupScreen() {
    const cfg = { color: "random", clock: "10+0", ...(store.get("roomCfg") || {}) };
    root.innerHTML = `
      <section class="setup card-in">
        <h1>👥 Criar sala</h1>
        <p class="muted">Você cria a sala, manda o link${invite ? ` pro <b>${esc(invite)}</b>` : ""} e vocês jogam aqui mesmo, navegador com navegador. Não conta rating.</p>
        <h3>Seu apelido</h3>
        <input id="nick" value="${esc(defaultNick())}" maxlength="24">
        <h3>Você joga de</h3>
        <div class="opts" id="oColor">
          ${[["white", "♔", "Brancas"], ["random", "⚄", "Aleatório"], ["black", "♚", "Pretas"]]
            .map(([k, i, l]) => `<button class="opt ${cfg.color === k ? "on" : ""}" data-v="${k}"><span class="oi">${i}</span>${l}</button>`).join("")}
        </div>
        <h3>Relógio</h3>
        <div class="opts" id="oClock">
          ${Object.entries(CLOCKS).map(([k, v]) => `<button class="opt ${cfg.clock === k ? "on" : ""}" data-v="${k}">${v}</button>`).join("")}
        </div>
        <button class="start" id="go">Criar sala e gerar link</button>
      </section>`;
    const pick = (id, key) => root.querySelector(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      cfg[key] = b.dataset.v;
      root.querySelectorAll(`${id} .opt`).forEach((x) => x.classList.toggle("on", x === b));
    });
    pick("#oColor", "color"); pick("#oClock", "clock");
    root.querySelector("#go").addEventListener("click", () => {
      const nick = root.querySelector("#nick").value.trim() || "Jogador";
      store.set("nick", nick); store.set("roomCfg", cfg);
      const id = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
      const hostColor = cfg.color === "random" ? (Math.random() < 0.5 ? "white" : "black") : cfg.color;
      const host = { hostColor, clock: cfg.clock, nick, invite };
      ss.set(`room-host:${id}`, host);
      history.replaceState(null, "", `#/room/${id}`);
      start(id, host);
    });
  }

  function start(id, host) {
    const isHost = !!host;
    const link = `${location.origin}${location.pathname}#/room/${id}`;
    let nick = isHost ? host.nick : defaultNick();
    let oppNick = isHost ? host.invite || "Oponente" : "Anfitrião";
    let myColor = isHost ? host.hostColor : null; // guest learns it from "start"
    let clockCfg = isHost ? host.clock : "none";
    let chess = new Chess();
    let conn = null;
    let over = null;
    let started = false;
    let drawOffer = null; // "me" | "them"
    let orientation = myColor || "white";
    let alive = true;
    const clock = { w: 0, b: 0, last: 0, timer: null, on: false, inc: 0 };
    const chat = [];

    root.innerHTML = `
      <div class="review play room">
        <div class="board-col">
          <div class="player" id="pTop"></div>
          <div class="board-row">
            <div class="board-wrap" id="wrap" data-theme="${store.get("theme") || "verde"}">
              <div class="board" id="board"></div>
              <div class="overlay" id="overlay"></div>
            </div>
          </div>
          <div class="player" id="pBot"></div>
        </div>
        <aside class="panel">
          <div class="panel-head"><span class="ph-title">👥 Sala <small class="muted">${esc(id)}</small></span><span class="conn" id="conn">conectando…</span></div>
          <div class="share" id="share">
            <small>Mande este link pro seu amigo:</small>
            <div class="share-row"><input id="link" value="${esc(link)}" readonly><button id="copy">Copiar</button></div>
            <div class="share-row">
              <a class="wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Bora jogar xadrez? ${link}`)}">WhatsApp</a>
              ${navigator.share ? `<button id="nshare">Compartilhar…</button>` : ""}
            </div>
          </div>
          <div class="stage"><div class="coach" id="status"></div></div>
          <div class="moves" id="moves"></div>
          <div class="chat">
            <div class="chat-log" id="chatLog"></div>
            <form id="chatF"><input id="chatIn" placeholder="Mensagem…" maxlength="200" autocomplete="off"><button>➤</button></form>
          </div>
          <div class="controls play-ctl">
            <button id="draw">½ Empate</button>
            <button id="flip">⇅</button>
            <button id="resign" class="danger">⚑ Desistir</button>
          </div>
        </aside>
      </div>`;
    const $ = (s) => root.querySelector(`#${s}`);

    const cg = Chessground($("board"), {
      orientation, coordinates: true,
      animation: { enabled: true, duration: 240 },
      movable: { free: false, color: undefined, showDests: true, events: { after: onMyMove } },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
    });

    const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    const myC = () => (myColor ? myColor[0] : null);

    function setConn(text, ok) { $("conn").textContent = text; $("conn").className = `conn ${ok ? "ok" : ""}`; }

    function players() {
      const line = (c) => {
        const mine = c === myC();
        const active = started && !over && chess.turn() === c;
        return `<span class="avatar ${c}">${esc((mine ? nick : oppNick)[0]?.toUpperCase() || "?")}</span>
          <span class="pname"><b>${esc(mine ? nick : oppNick)}</b><small>${mine ? "você" : conn?.open ? "conectado" : "aguardando…"}</small></span>
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

    function status(icon, color, title, text) {
      $("status").innerHTML = `<div class="coach-ico" style="--c:${color}">${icon}</div><div><div class="ctitle">${title}</div><p>${text}</p></div>`;
    }

    function dests() {
      const d = new Map();
      for (const m of chess.moves({ verbose: true })) { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); }
      return d;
    }

    function sync() {
      const last = chess.history({ verbose: true }).at(-1);
      const turn = chess.turn() === "w" ? "white" : "black";
      const canMove = started && !over && conn?.open && chess.turn() === myC();
      cg.set({
        fen: chess.fen(), orientation, turnColor: turn,
        lastMove: last ? [last.from, last.to] : undefined,
        check: chess.inCheck() ? turn : false,
        movable: { color: canMove ? myColor : undefined, dests: canMove ? dests() : new Map() },
      });
      players(); moveList();
      $("share").hidden = started && conn?.open;
      if (over) return;
      if (!started) status("⏳", "#5c8bb0", isHost ? "Esperando o amigo entrar…" : "Entrando na sala…", isHost ? "Assim que ele abrir o link a partida começa." : "Conectando ao anfitrião.");
      else if (!conn?.open) status("⚠", "#e58f2a", "Oponente desconectado", "Esperando reconectar…");
      else if (drawOffer === "them") status("½", "#97af8b", `${esc(oppNick)} ofereceu empate`, `<button id="accDraw" class="primary">Aceitar</button> <button id="decDraw">Recusar</button>`);
      else if (chess.turn() === myC()) status("♟", "#81b64c", "Sua vez", chess.inCheck() ? "Você está em xeque!" : "Arraste ou clique numa peça.");
      else status("⌛", "#5c8bb0", `Vez de ${esc(oppNick)}`, drawOffer === "me" ? "Você ofereceu empate." : "Aguardando o lance.");
      $("accDraw")?.addEventListener("click", () => { send({ t: "draw-accept" }); finish("1/2-1/2", "acordo"); });
      $("decDraw")?.addEventListener("click", () => { drawOffer = null; send({ t: "draw-decline" }); sync(); });
    }

    function persist() {
      if (isHost) ss.set(`room-state:${id}`, { pgn: chess.pgn(), clock: { w: clock.w, b: clock.b }, oppNick, hostColor: myColor, over });
    }

    // ---- clocks ----
    function resetClock() {
      clock.on = clockCfg !== "none";
      const [base, inc] = clock.on ? clockCfg.split("+").map(Number) : [0, 0];
      clock.w = clock.b = base * 60000; clock.inc = inc * 1000;
      clearInterval(clock.timer); clock.timer = null;
    }
    function tick() {
      if (!clock.on || over || !chess.history().length) return;
      const now = performance.now();
      const c = chess.turn();
      clock[c] -= now - clock.last; clock.last = now;
      if (clock[c] <= 0) {
        clock[c] = 0;
        if (c === myC()) send({ t: "flag" });
        return finish(c === "w" ? "0-1" : "1-0", "tempo");
      }
      players();
    }
    function afterMove(mover, remote) {
      if (!clock.on) return;
      if (remote) Object.assign(clock, { w: remote.w, b: remote.b });
      else if (clock.timer) clock[mover] -= performance.now() - clock.last;
      if (!remote) clock[mover] += clock.inc;
      clock.last = performance.now();
      if (!clock.timer) clock.timer = setInterval(tick, 200);
    }

    // ---- moves ----
    function apply(move, remoteClock) {
      const played = chess.move(move);
      drawOffer = null;
      afterMove(played.color, remoteClock);
      sound.play(played, { check: chess.inCheck(), mate: chess.isCheckmate() });
      if (chess.isGameOver()) {
        let result = "1/2-1/2", reason = "empate";
        if (chess.isCheckmate()) { result = chess.turn() === "w" ? "0-1" : "1-0"; reason = "xeque-mate"; }
        else if (chess.isStalemate()) reason = "afogamento";
        else if (chess.isThreefoldRepetition()) reason = "repetição";
        else if (chess.isInsufficientMaterial()) reason = "material insuficiente";
        else reason = "regra dos 50 lances";
        sync(); finish(result, reason);
      } else sync();
      persist();
      return played;
    }

    function onMyMove(from, to) {
      const p = chess.get(from);
      if (p?.type === "p" && (to[1] === "8" || to[1] === "1")) return askPromotion(from, to);
      const played = apply({ from, to });
      send({ t: "move", san: played.san, clock: { w: clock.w, b: clock.b } });
    }

    function askPromotion(from, to) {
      const ov = $("overlay");
      ov.innerHTML = `<div class="promo">${["q", "r", "b", "n"].map((t) => `<button data-t="${t}" class="cg-wrap"><piece class="${myColor} ${PIECE[t]}"></piece></button>`).join("")}</div>`;
      ov.querySelector(".promo").addEventListener("click", (e) => {
        const t = e.target.closest("[data-t]")?.dataset.t;
        if (!t) return;
        ov.innerHTML = "";
        const played = apply({ from, to, promotion: t });
        send({ t: "move", san: played.san, clock: { w: clock.w, b: clock.b } });
      });
    }

    function finish(result, reason) {
      if (over) return;
      over = { result, reason };
      clearInterval(clock.timer); clock.timer = null;
      persist();
      sync();
      const won = (result === "1-0" && myC() === "w") || (result === "0-1" && myC() === "b");
      const title = result === "1/2-1/2" ? "Empate" : won ? "Você venceu! 🎉" : `${esc(oppNick)} venceu`;
      const key = `room-${id}-${Date.now().toString(36)}`;
      const pgn = new Chess();
      for (const m of chess.history()) pgn.move(m);
      const white = myC() === "w" ? nick : oppNick, black = myC() === "b" ? nick : oppNick;
      for (const [k, v] of Object.entries({ Event: "Chess Review · Sala", Site: "Chess Review", White: white, Black: black, Result: result, Termination: reason })) pgn.setHeader(k, v);
      if (chess.history().length) {
        saveOffline({ key, src: "offline", id: key, pgn: pgn.pgn(), white, black, result, end: Date.now(), speed: "room",
          tc: clockCfg === "none" ? "" : CLOCKS[clockCfg], fen: chess.fen(), moves: Math.ceil(chess.history().length / 2),
          opening: "", ending: reason, acc: null, orient: myColor });
      }
      status(won ? "🏆" : result === "1/2-1/2" ? "½" : "⚑", won ? "#81b64c" : result === "1/2-1/2" ? "#97af8b" : "#ca3431", title, `Fim por ${esc(reason)}.`);
      $("overlay").innerHTML = `
        <div class="endmodal card-in">
          <div class="em-title ${won ? "win" : result === "1/2-1/2" ? "draw" : "loss"}">${title}</div>
          <div class="muted">por ${esc(reason)}</div>
          ${chess.history().length ? `<button class="start" id="toReview">⭐ Revisar partida</button>` : ""}
          <div class="em-row"><button id="rematch">↻ Revanche</button><button id="closeM">Fechar</button></div>
        </div>`;
      $("toReview")?.addEventListener("click", () => { location.hash = `#/review/${encodeURIComponent(key)}`; });
      $("rematch").addEventListener("click", () => { send({ t: "rematch" }); $("rematch").textContent = "Aguardando…"; $("rematch").disabled = true; });
      $("closeM").addEventListener("click", () => { $("overlay").innerHTML = ""; });
    }

    function newGame(hostColor) {
      if (isHost) { myColor = hostColor; host.hostColor = hostColor; ss.set(`room-host:${id}`, host); }
      else myColor = hostColor === "white" ? "black" : "white";
      chess = new Chess(); over = null; drawOffer = null; started = true; orientation = myColor;
      resetClock(); $("overlay").innerHTML = ""; sync(); persist();
    }

    // ---- chat ----
    function addChat(who, text) {
      chat.push({ who, text });
      $("chatLog").innerHTML = chat.slice(-50).map((m) => `<div class="cm ${m.who === "me" ? "me" : m.who === "sys" ? "sys" : ""}"><b>${m.who === "me" ? "Você" : m.who === "sys" ? "" : esc(oppNick)}</b> ${esc(m.text)}</div>`).join("");
      $("chatLog").scrollTop = $("chatLog").scrollHeight;
    }

    // ---- network ----
    function send(msg) { if (conn?.open) conn.send(msg); }

    function onData(m) {
      if (!m || typeof m !== "object") return;
      switch (m.t) {
        case "hi": // guest → host
          oppNick = String(m.nick || "Oponente").slice(0, 24);
          {
            const st = ss.get(`room-state:${id}`);
            const resume = st && !st.over && st.pgn && started;
            send({ t: "start", hostColor: myColor, clock: clockCfg, nick, pgn: resume ? chess.pgn() : "", clockState: { w: clock.w, b: clock.b } });
            if (!started) newGame(myColor);
            addChat("sys", `${oppNick} entrou na sala.`);
            sync();
          }
          break;
        case "start": // host → guest
          oppNick = String(m.nick || "Anfitrião").slice(0, 24);
          clockCfg = CLOCKS[m.clock] ? m.clock : "none";
          newGame(m.hostColor);
          if (m.pgn) { chess.loadPgn(m.pgn); if (clock.on) Object.assign(clock, m.clockState); sync(); }
          addChat("sys", `${chat.some((x) => x.who === "sys" && x.text.startsWith("Você entrou")) ? "Nova partida!" : `Você entrou na sala de ${oppNick}.`} Você joga de ${myColor === "white" ? "brancas" : "pretas"}.`);
          break;
        case "move":
          if (over || chess.turn() === myC()) return;
          try { apply(m.san, m.clock); } catch { /* ignore illegal */ }
          break;
        case "resign": finish(myC() === "w" ? "1-0" : "0-1", "abandono"); break;
        case "flag": finish(chess.turn() === "w" ? "0-1" : "1-0", "tempo"); break;
        case "draw-offer": drawOffer = "them"; sync(); break;
        case "draw-accept": finish("1/2-1/2", "acordo"); break;
        case "draw-decline": drawOffer = null; addChat("sys", `${oppNick} recusou o empate.`); sync(); break;
        case "rematch":
          if (isHost) { const next = myColor === "white" ? "black" : "white"; newGame(next); send({ t: "start", hostColor: next, clock: clockCfg, nick, pgn: "" }); addChat("sys", "Revanche! Cores trocadas."); }
          else if ($("rematch")?.disabled) { /* host will send start */ }
          else addChat("sys", `${oppNick} quer revanche — clique em Revanche.`);
          break;
        case "chat": addChat("them", String(m.text || "").slice(0, 200)); break;
      }
    }

    function wire(c) {
      conn = c;
      c.on("open", () => { setConn("conectado", true); if (!isHost) send({ t: "hi", nick }); sync(); });
      c.on("data", onData);
      c.on("close", () => { setConn("desconectado", false); if (conn === c) conn = null; addChat("sys", `${oppNick} saiu da sala.`); sync(); });
      c.on("error", () => setConn("erro de conexão", false));
    }

    let peer;
    if (isHost) {
      const st = ss.get(`room-state:${id}`);
      if (st?.pgn && !st.over) { chess.loadPgn(st.pgn); oppNick = st.oppNick || oppNick; started = true; resetClock(); if (clock.on) Object.assign(clock, st.clock); }
      peer = new Peer(PREFIX + id);
      peer.on("open", () => setConn("sala aberta", true));
      peer.on("connection", (c) => { if (conn?.open) { c.on("open", () => { c.send({ t: "chat", text: "Sala cheia." }); setTimeout(() => c.close(), 300); }); return; } wire(c); });
    } else {
      peer = new Peer();
      peer.on("open", () => wire(peer.connect(PREFIX + id, { reliable: true })));
    }
    peer.on("error", (e) => {
      const msg = e.type === "peer-unavailable" ? "Sala não encontrada (o anfitrião fechou a aba?)"
        : e.type === "unavailable-id" ? "Essa sala já está aberta em outra aba." : `Erro: ${e.type}`;
      setConn(msg, false);
      status("⚠", "#ca3431", "Não deu pra conectar", esc(msg));
    });
    peer.on("disconnected", () => { if (alive) peer.reconnect(); });

    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); $("copy").textContent = "Copiado ✓"; } catch { $("link").select(); }
    });
    $("nshare")?.addEventListener("click", () => navigator.share({ title: "Xadrez no Chess Review", url: link }).catch(() => {}));
    $("resign").addEventListener("click", () => { if (started && !over) { send({ t: "resign" }); finish(myC() === "w" ? "0-1" : "1-0", "abandono"); } });
    $("draw").addEventListener("click", () => { if (started && !over && drawOffer !== "me") { drawOffer = "me"; send({ t: "draw-offer" }); sync(); } });
    $("flip").addEventListener("click", () => { orientation = orientation === "white" ? "black" : "white"; sync(); });
    $("chatF").addEventListener("submit", (e) => {
      e.preventDefault();
      const t = $("chatIn").value.trim();
      if (!t) return;
      send({ t: "chat", text: t }); addChat("me", t); $("chatIn").value = "";
    });

    sync();
    teardown = () => { alive = false; clearInterval(clock.timer); try { conn?.close(); peer.destroy(); } catch { /* ignore */ } cg.destroy(); };
  }

  return () => teardown();
}
