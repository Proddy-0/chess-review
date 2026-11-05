import { myGames, store } from "../lib/sources.js";
import { esc } from "../util.js";

// Friends = usernames you save here (chess.com has no public friends API).
const UA_OK = { headers: { Accept: "application/json" } };

const chesscomChallenge = (u) => `https://www.chess.com/play/online/new?opponent=${encodeURIComponent(u)}`;
const lichessChallenge = (u) => `https://lichess.org/?user=${encodeURIComponent(u)}#friend`;

function ago(ms) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 300) return "online agora";
  if (s < 3600) return `visto há ${Math.round(s / 60)} min`;
  if (s < 86400) return `visto há ${Math.round(s / 3600)} h`;
  return `visto há ${Math.round(s / 86400)} dia(s)`;
}

async function chesscomProfile(u) {
  const [p, s] = await Promise.all([
    fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}`).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}/stats`).then((r) => (r.ok ? r.json() : {})),
  ]);
  if (!p) throw new Error(`"${u}" não existe no chess.com`);
  const r = (k) => s[`chess_${k}`]?.last?.rating;
  return {
    name: p.username, display: p.name || "", avatar: p.avatar || "", title: p.title || "",
    seen: p.last_online * 1000, online: null, url: p.url,
    ratings: { Bullet: r("bullet"), Blitz: r("blitz"), Rápida: r("rapid"), Diária: r("daily") },
  };
}

async function lichessProfile(u) {
  const p = await fetch(`https://lichess.org/api/user/${encodeURIComponent(u)}`, UA_OK).then((r) => (r.ok ? r.json() : null));
  if (!p || p.disabled) throw new Error(`"${u}" não existe no Lichess`);
  const r = (k) => p.perfs?.[k]?.rating;
  return {
    name: p.username, display: [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(" "), avatar: "", title: p.title || "",
    seen: p.seenAt, online: null, url: p.url,
    ratings: { Bullet: r("bullet"), Blitz: r("blitz"), Rápida: r("rapid"), Clássica: r("classical") },
  };
}

export function renderFriends(root) {
  const users = store.get("users") || {};
  let friends = store.get("friends") || [];
  const profiles = new Map();

  root.innerHTML = `
    <section class="friends">
      <div class="fr-head">
        <h1>👥 Amigos</h1>
        <a class="btn-room" href="#/room">＋ Criar sala pra jogar com alguém</a>
      </div>
      <form class="card fr-add" id="add">
        <select name="src"><option value="chesscom">chess.com</option><option value="lichess">Lichess</option></select>
        <input name="user" placeholder="Usuário do amigo" autocomplete="off" required>
        <button class="primary">Adicionar</button>
        <span class="err" id="addErr"></span>
      </form>
      <div class="frgrid" id="grid"></div>
      <p class="muted small">O chess.com não libera a lista de amigos pela API, então você adiciona aqui quem quiser acompanhar.
        "Desafiar" abre o chess.com / Lichess com o adversário já preenchido: confira o ritmo e clique em enviar lá.</p>
    </section>`;
  const $ = (s) => root.querySelector(s);

  let h2h = new Map(); // "src:user" -> { w, l, d }
  myGames(users).then((out) => {
    const me = [users.chesscom, users.lichess].filter(Boolean).map((x) => x.toLowerCase());
    for (const r of out) if (r.status === "fulfilled") for (const g of r.value) {
      const wl = String(g.white).toLowerCase(), bl = String(g.black).toLowerCase();
      const myC = me.includes(wl) ? "w" : me.includes(bl) ? "b" : null;
      if (!myC) continue;
      const opp = `${g.src}:${myC === "w" ? bl : wl}`;
      const rec = h2h.get(opp) || { w: 0, l: 0, d: 0 };
      if (g.result === "1/2-1/2") rec.d++;
      else if ((g.result === "1-0") === (myC === "w")) rec.w++;
      else rec.l++;
      h2h.set(opp, rec);
    }
    draw();
  });

  function card(f) {
    const p = profiles.get(`${f.src}:${f.user}`);
    const rec = h2h.get(`${f.src}:${f.user.toLowerCase()}`);
    if (p === undefined) return `<div class="frcard loading"><span class="muted">Carregando ${esc(f.user)}…</span></div>`;
    if (p instanceof Error) return `<div class="frcard"><span class="err">${esc(p.message)}</span><button class="ghost" data-del="${esc(f.src)}:${esc(f.user)}">remover</button></div>`;
    const online = p.online ?? (Date.now() - (p.seen || 0) < 300000);
    const ratings = Object.entries(p.ratings).filter(([, v]) => v);
    return `<div class="frcard">
      <div class="fr-top">
        <div class="fr-av ${online ? "on" : ""}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc(p.name[0].toUpperCase())}</div>
        <div class="fr-id">
          <b>${p.title ? `<span class="ftitle">${esc(p.title)}</span> ` : ""}${esc(p.name)}</b>
          <small>${esc(p.display)}</small>
          <small class="${online ? "fr-on" : ""}">${online ? "● online agora" : esc(ago(p.seen))}</small>
        </div>
        <span class="src ${f.src}">${f.src === "chesscom" ? "chess.com" : "Lichess"}</span>
      </div>
      <div class="fr-ratings">${ratings.map(([k, v]) => `<span><small>${k}</small><b>${v}</b></span>`).join("") || `<span class="muted">sem rating</span>`}</div>
      ${rec ? `<div class="fr-h2h">Contra você (últimas partidas): <b class="w">${rec.w}V</b> <b class="d">${rec.d}E</b> <b class="l">${rec.l}D</b></div>` : `<div class="fr-h2h muted">Sem partidas recentes entre vocês.</div>`}
      <div class="fr-act">
        <a class="primary" href="${f.src === "chesscom" ? chesscomChallenge(p.name) : lichessChallenge(p.name)}" target="_blank" rel="noopener">⚔ Desafiar no ${f.src === "chesscom" ? "chess.com" : "Lichess"}</a>
        <a href="#/room?invite=${encodeURIComponent(p.name)}">👥 Sala aqui</a>
        <a href="#/?q=${encodeURIComponent(p.name)}">Partidas</a>
        <a href="${esc(p.url)}" target="_blank" rel="noopener" title="Perfil">↗</a>
        <button class="ghost" data-del="${esc(f.src)}:${esc(f.user)}" title="Remover">✕</button>
      </div>
    </div>`;
  }

  function draw() {
    $("#grid").innerHTML = friends.length ? friends.map(card).join("")
      : `<p class="muted empty-msg">Nenhum amigo ainda. Adicione o usuário de alguém do chess.com ou Lichess acima.</p>`;
  }

  async function load(f) {
    const k = `${f.src}:${f.user}`;
    try { profiles.set(k, await (f.src === "chesscom" ? chesscomProfile(f.user) : lichessProfile(f.user))); }
    catch (e) { profiles.set(k, e); }
    draw();
  }

  async function lichessOnline() {
    const ids = friends.filter((f) => f.src === "lichess").map((f) => f.user);
    if (!ids.length) return;
    try {
      const st = await fetch(`https://lichess.org/api/users/status?ids=${ids.map(encodeURIComponent).join(",")}`, UA_OK).then((r) => r.json());
      for (const s of st) {
        const f = friends.find((x) => x.src === "lichess" && x.user.toLowerCase() === s.id);
        const p = f && profiles.get(`lichess:${f.user}`);
        if (p && !(p instanceof Error)) p.online = !!s.online;
      }
      draw();
    } catch { /* status is optional */ }
  }

  $("#add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const f = { src: fd.get("src"), user: String(fd.get("user")).trim() };
    if (!f.user) return;
    if (friends.some((x) => x.src === f.src && x.user.toLowerCase() === f.user.toLowerCase())) { $("#addErr").textContent = "Já está na lista."; return; }
    $("#addErr").textContent = "";
    try {
      const p = await (f.src === "chesscom" ? chesscomProfile(f.user) : lichessProfile(f.user));
      f.user = p.name;
      profiles.set(`${f.src}:${f.user}`, p);
      friends = [f, ...friends];
      store.set("friends", friends);
      e.target.reset();
      draw();
      lichessOnline();
    } catch (err) {
      $("#addErr").textContent = err.message;
    }
  });

  $("#grid").addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]")?.dataset.del;
    if (!d) return;
    const i = d.indexOf(":");
    const [src, user] = [d.slice(0, i), d.slice(i + 1)];
    friends = friends.filter((f) => !(f.src === src && f.user === user));
    store.set("friends", friends);
    draw();
  });

  draw();
  Promise.all(friends.map(load)).then(lichessOnline);
  const t = setInterval(lichessOnline, 60000);
  return () => clearInterval(t);
}
