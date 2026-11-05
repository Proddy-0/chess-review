// Puzzle extraction on a synthetic analysis: white hangs the queen at move 3.
import assert from "node:assert";
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k],
  key: (i) => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
const { setOpenings } = await import("../src/lib/pipeline.js");
setOpenings({});
const { puzzlesFromGame, queue, record, status, progress } = await import("../src/lib/puzzles.js");

// 1.e4 e5 2.Qh5 Nc6 3.Qxf7+?? — wait, use a clear blunder: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
const pgn = `[White "eu"]\n[Black "rival"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;
// res[i] = eval before move i (white POV). Black is "me": 3...Nf6?? allows mate; best was 3...g6.
const ev = (cp) => ({ cp }), mate = (m) => ({ mate: m });
const res = [
  { ev: ev(30), best: "e2e4", pv: ["e2e4"], second: ev(25) },
  { ev: ev(30), best: "e7e5", pv: ["e7e5"], second: ev(35) },
  { ev: ev(20), best: "d1h5", pv: ["d1h5"], second: ev(15) },
  { ev: ev(0), best: "b8c6", pv: ["b8c6"], second: ev(10) },
  { ev: ev(10), best: "f1c4", pv: ["f1c4"], second: ev(5) },
  { ev: ev(30), best: "g7g6", pv: ["g7g6", "h5f3", "g8f6"], second: mate(1) },
  { ev: mate(1), best: "h5f7", pv: ["h5f7"], second: ev(900) },
  { ev: { cp: 100000, final: "mate" }, best: null, pv: [], second: null },
];
const game = { key: "t-1", pgn, white: "eu", black: "rival", end: 1 };
// me = black ("rival")
const pz = await puzzlesFromGame(game, res, ["rival"]);
console.log(pz.map((p) => `${p.id} ${p.kind} ${p.theme} line=${p.line.join(",")} played=${p.played}`));
assert.equal(pz.length, 1, "one puzzle");
assert.equal(pz[0].ply, 5);
assert.equal(pz[0].line[0], "g7g6");
assert.equal(pz[0].line.length, 1, "quiet follow-up trimmed");
assert.equal(pz[0].played, "Nf6");
assert.equal(pz[0].color, "b");
// me = white: no white blunder
assert.equal((await puzzlesFromGame(game, res, ["eu"])).length, 0);
// ambiguous: second almost as good => skipped
const res2 = res.map((r) => ({ ...r })); res2[5] = { ...res2[5], second: ev(25) };
assert.equal((await puzzlesFromGame(game, res2, ["rival"])).length, 0, "ambiguous skipped");

// spaced repetition
assert.equal(status(progress()[pz[0].id]), "new");
record(pz[0].id, false); assert.equal(status(progress()[pz[0].id]), "failed");
assert.equal(queue(pz, "failed").length, 1);
record(pz[0].id, true); record(pz[0].id, true); assert.equal(status(progress()[pz[0].id]), "mastered");
assert.equal(queue(pz, "train").length, 0); assert.equal(queue(pz, "all").length, 1);
console.log("ok");
