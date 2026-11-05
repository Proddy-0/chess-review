// Builds src/data/openings.json: position key (board + side to move) -> "ECO Name".
// Source: lichess-org/chess-openings (CC0). Run: node scripts/build-openings.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chess.js";

const rows = readFileSync(new URL("./openings.tsv", import.meta.url), "utf8").split("\n").slice(1).filter(Boolean);
const out = {};
for (const row of rows) {
  const [eco, name, pgn] = row.split("\t");
  if (eco === "eco") continue;
  const c = new Chess();
  c.loadPgn(pgn);
  const key = c.fen().split(" ").slice(0, 2).join(" ");
  out[key] = `${eco} ${name}`;
}
writeFileSync(new URL("../src/data/openings.json", import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(out).length} positions`);
