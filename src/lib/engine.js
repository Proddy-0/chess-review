import { parseInfo } from "./analysis.js";

// Thin UCI wrapper over the Stockfish WASM worker. One search at a time.
export class Engine {
  constructor({ multipv = 2, skill = null } = {}) {
    this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`);
    this.subs = new Set();
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const f of [...this.subs]) f(line);
    };
    this.ready = this.#init(multipv, skill);
  }

  #wait(pred, onLine) {
    return new Promise((resolve) => {
      const f = (l) => {
        onLine?.(l);
        if (pred(l)) { this.subs.delete(f); resolve(l); }
      };
      this.subs.add(f);
    });
  }

  send(cmd) { this.worker.postMessage(cmd); }

  async #init(multipv, skill) {
    const ok = this.#wait((l) => l === "uciok");
    this.send("uci");
    await ok;
    this.send("setoption name Hash value 32");
    this.send(`setoption name MultiPV value ${multipv}`);
    if (skill !== null) this.send(`setoption name Skill Level value ${skill}`);
    const ready = this.#wait((l) => l === "readyok");
    this.send("isready");
    await ready;
  }

  /** @returns {{ info, second, bestmove }} info/second = last full line for multipv 1/2 */
  async analyse(fen, depth) {
    return this.#go(fen, `depth ${depth}`);
  }

  /** Engine plays a move within a time budget (ms) and optional depth cap. */
  async move(fen, movetime, depth = null) {
    const r = await this.#go(fen, depth ? `depth ${depth} movetime ${movetime}` : `movetime ${movetime}`);
    return r.bestmove;
  }

  async #go(fen, limits) {
    await this.ready;
    const lines = {};
    const done = this.#wait((l) => l.startsWith("bestmove"), (l) => {
      const i = parseInfo(l);
      if (i) lines[i.multipv] = i;
    });
    this.send(`position fen ${fen}`);
    this.send(`go ${limits}`);
    const bm = await done;
    return { info: lines[1] || null, second: lines[2] || null, bestmove: bm.split(" ")[1] };
  }

  terminate() { this.worker.terminate(); this.subs.clear(); }
}
