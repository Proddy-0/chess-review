import { parseInfo } from "./analysis.js";

// Thin UCI wrapper over the Stockfish WASM worker. One analysis at a time.
export class Engine {
  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`);
    this.subs = new Set();
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const f of [...this.subs]) f(line);
    };
    this.ready = this.#init();
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

  async #init() {
    const ok = this.#wait((l) => l === "uciok");
    this.send("uci");
    await ok;
    this.send("setoption name Hash value 32");
    const ready = this.#wait((l) => l === "readyok");
    this.send("isready");
    await ready;
  }

  async analyse(fen, depth) {
    await this.ready;
    let info = null;
    const done = this.#wait((l) => l.startsWith("bestmove"), (l) => {
      const i = parseInfo(l);
      if (i) info = i;
    });
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    const bm = await done;
    return { info, bestmove: bm.split(" ")[1] };
  }

  terminate() { this.worker.terminate(); this.subs.clear(); }
}
