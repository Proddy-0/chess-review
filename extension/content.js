// Chess Review — chess.com helper.
// Shows a "Revisar no Chess Review" button ONLY after the game is finished
// (server-side game.isFinished). During a live game nothing is shown or analysed.
(() => {
  const SITE = "https://proddy-0.github.io/chess-review/";
  const GAME_RE = /\/game\/(?:(live|daily)\/)?(\d+)/;
  const POLL_MS = 5000;

  let currentId = null;
  let pollTimer = null;
  let btn = null;
  let finished = null; // { type, game }

  const gameRef = () => {
    const m = location.pathname.match(GAME_RE);
    return m ? { type: m[1] || null, id: m[2] } : null;
  };

  async function fetchGame(ref) {
    for (const t of ref.type ? [ref.type] : ["live", "daily"]) {
      try {
        const r = await fetch(`/callback/${t}/game/${ref.id}`, { credentials: "include" });
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.game) return { type: t, game: j.game };
      } catch (_) { /* next */ }
    }
    return null;
  }

  const boardFlipped = () => {
    const b = document.querySelector("wc-chess-board, chess-board");
    return !!(b && b.classList.contains("flipped"));
  };

  function reviewUrl(ref, game) {
    const h = game.pgnHeaders || {};
    const p = new URLSearchParams({
      src: "chesscom", id: ref.id, tcn: game.moveList || "",
      w: h.White || "", b: h.Black || "", we: h.WhiteElo || "", be: h.BlackElo || "",
      res: h.Result || "*", orient: boardFlipped() ? "black" : "white",
    });
    return `${SITE}#/import?${p.toString()}`;
  }

  function showButton(ref, game) {
    if (btn) return;
    btn = document.createElement("a");
    btn.textContent = "♞ Revisar no Chess Review";
    btn.href = reviewUrl(ref, game);
    btn.target = "_blank";
    btn.rel = "noopener";
    Object.assign(btn.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: 2147483646,
      background: "#81b64c", color: "#fff", borderRadius: "8px", padding: "10px 16px",
      font: "600 14px system-ui, sans-serif", textDecoration: "none",
      boxShadow: "0 4px 16px rgba(0,0,0,.35)",
    });
    btn.addEventListener("mouseenter", () => { btn.href = reviewUrl(ref, game); });
    document.body.appendChild(btn);
  }

  function hideButton() { if (btn) { btn.remove(); btn = null; } }

  async function poll() {
    const ref = gameRef();
    if (!ref || finished || document.visibilityState !== "visible") return;
    const res = await fetchGame(ref);
    if (!res || !res.game.isFinished) return;
    finished = res;
    clearInterval(pollTimer); pollTimer = null;
    showButton(ref, res.game);
  }

  function onRoute() {
    const ref = gameRef();
    const id = ref ? ref.id : null;
    if (id === currentId) return;
    currentId = id;
    finished = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    hideButton();
    if (!ref) return;
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  onRoute();
  setInterval(onRoute, 1000); // chess.com is an SPA
})();
