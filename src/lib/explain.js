import { Chess } from "chess.js";
import { formatEval } from "./analysis.js";

// Deterministic pt-BR explanations built only from Stockfish lines (no LLM, nothing invented).

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: "peão", n: "cavalo", b: "bispo", r: "torre", q: "dama", k: "rei" };
const ART = { p: "o", n: "o", b: "o", r: "a", q: "a", k: "o" };

const toMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

export function playLine(fen, ucis, max = 8) {
  const c = new Chess(fen);
  const san = [];
  const caps = [];
  for (const u of ucis.slice(0, max)) {
    let mv;
    try { mv = c.move(toMove(u)); } catch { break; }
    san.push(mv.san);
    if (mv.captured) caps.push({ by: mv.color, piece: mv.captured, san: mv.san });
  }
  return { c, san, caps };
}

function material(c, color) {
  let s = 0;
  for (const row of c.board()) for (const p of row) if (p) s += (p.color === color ? 1 : -1) * VAL[p.type];
  return s;
}

export function lineText(fen, ucis, n = 5) {
  return playLine(fen, ucis, n).san.join(" ");
}

/**
 * @param fenBefore position before the move
 * @param played    { uci, san, color }
 * @param a         { kind, evalBefore, evalAfter, bestUci, bestPv, replyPv }
 */
export function explain(fenBefore, played, a) {
  const me = played.color;
  const opp = me === "w" ? "b" : "w";
  const sign = me === "w" ? 1 : -1;
  const bestSan = a.bestPv?.length ? playLine(fenBefore, a.bestPv, 1).san[0] : null;

  if (a.evalAfter?.final === "mate") return `${played.san} dá xeque-mate. Fim de jogo.`;
  if (a.kind === "best") return `${played.san} é o lance que o Stockfish escolheria aqui.`;
  if (a.kind === "good") {
    return bestSan
      ? `${played.san} é um bom lance. O motor preferia ${bestSan}, mas a diferença é pequena.`
      : `${played.san} é um bom lance.`;
  }

  const parts = [];
  const after = a.evalAfter, before = a.evalBefore;

  // Allowed a forced mate.
  if (after?.mate !== undefined && Math.sign(after.mate) === -sign) {
    const fenAfter = playLine(fenBefore, [played.uci], 1).c.fen();
    parts.push(`Isso permite mate em ${Math.abs(after.mate)}: ${lineText(fenAfter, a.replyPv, Math.abs(after.mate) * 2 - 1)}.`);
  } else if (before?.mate !== undefined && Math.sign(before.mate) === sign) {
    // Missed own forced mate.
    parts.push(`Você tinha mate em ${Math.abs(before.mate)} com ${lineText(fenBefore, a.bestPv, Math.abs(before.mate) * 2 - 1)}.`);
  } else {
    // Compare material at the end of the played line vs the best line.
    const playedLine = playLine(fenBefore, [played.uci, ...(a.replyPv || [])], 7);
    const bestLine = playLine(fenBefore, a.bestPv || [], 7);
    const len = Math.min(playedLine.san.length, bestLine.san.length);
    const pl = playLine(fenBefore, [played.uci, ...(a.replyPv || [])], len);
    const bl = playLine(fenBefore, a.bestPv || [], len);
    const loss = material(bl.c, me) - material(pl.c, me);

    const oppCap = pl.caps.find((x) => x.by === opp && VAL[x.piece] >= 3);
    if (loss >= 2 && oppCap) {
      parts.push(`Perde material: depois de ${played.san}, o adversário ganha ${ART[oppCap.piece]} ${NAME[oppCap.piece]} (${pl.san.slice(0, 4).join(" ")}).`);
    } else if (loss >= 1) {
      parts.push(`Perde material (~${loss} ponto${loss > 1 ? "s" : ""}). Linha provável: ${pl.san.slice(0, 4).join(" ")}.`);
    }
    const myCap = bl.caps.find((x) => x.by === me && VAL[x.piece] >= 3);
    if (bestSan && myCap && loss >= 2) {
      parts.push(`Melhor era ${bestSan}, que ganha ${ART[myCap.piece]} ${NAME[myCap.piece]} (${bl.san.slice(0, 4).join(" ")}).`);
    } else if (bestSan) {
      parts.push(`Melhor era ${bestSan} (${formatEval(before)}). Ideia: ${bl.san.slice(0, 4).join(" ")}.`);
    }
  }

  parts.push(`Avaliação: ${formatEval(before)} → ${formatEval(after)}.`);
  return parts.join(" ");
}
