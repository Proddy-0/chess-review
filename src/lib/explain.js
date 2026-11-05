import { Chess } from "chess.js";
import { formatEval } from "./analysis.js";

// Deterministic pt-BR coach text built only from Stockfish lines (no LLM, nothing invented).

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: "peão", n: "cavalo", b: "bispo", r: "torre", q: "dama", k: "rei" };
const ART = { p: "o", n: "o", b: "o", r: "a", q: "a", k: "o" };
const piece = (t) => `${ART[t]} ${NAME[t]}`;

const toMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

export function playLine(fen, ucis = [], max = 8) {
  const c = new Chess(fen);
  const san = [];
  const caps = [];
  const verbose = [];
  for (const u of ucis.slice(0, max)) {
    let mv;
    try { mv = c.move(toMove(u)); } catch { break; }
    san.push(mv.san);
    verbose.push(mv);
    if (mv.captured) caps.push({ by: mv.color, piece: mv.captured, san: mv.san });
  }
  return { c, san, caps, verbose };
}

function material(c, color) {
  let s = 0;
  for (const row of c.board()) for (const p of row) if (p) s += (p.color === color ? 1 : -1) * VAL[p.type];
  return s;
}

function stand(ev, color) {
  if (!ev) return "";
  if (ev.mate !== undefined) return (ev.mate > 0) === (color === "w") ? "com mate forçado" : "perdida";
  const cp = (color === "w" ? 1 : -1) * ev.cp;
  if (cp > 300) return "ganha";
  if (cp > 120) return "bem melhor";
  if (cp > 40) return "um pouco melhor";
  if (cp > -40) return "equilibrada";
  if (cp > -120) return "um pouco pior";
  if (cp > -300) return "bem pior";
  return "perdida";
}

const TITLE = {
  brilliant: (s) => `${s} é brilhante!!`,
  great: (s) => `${s} é um ótimo lance!`,
  best: (s) => `${s} é o melhor lance`,
  excellent: (s) => `${s} é excelente`,
  good: (s) => `${s} é bom`,
  book: (s) => `${s} é teoria`,
  inacc: (s) => `${s} é uma imprecisão`,
  mistake: (s) => `${s} é um erro`,
  miss: (s) => `${s} é uma oportunidade perdida`,
  blunder: (s) => `${s} é uma capivarada`,
};

/**
 * @param fenBefore position before the move
 * @param played    { uci, san, color }
 * @param a         { kind, evalBefore, evalAfter, evalSecond, bestPv, replyPv, opening }
 * @returns {{ title, text, bestSan }}
 */
export function explain(fenBefore, played, a) {
  const me = played.color;
  const opp = me === "w" ? "b" : "w";
  const sign = me === "w" ? 1 : -1;
  const best = a.bestPv?.length ? playLine(fenBefore, a.bestPv, 1).san[0] : null;
  const title = TITLE[a.kind](played.san);
  const after = a.evalAfter, before = a.evalBefore;
  const pos = `A posição fica ${stand(after, me)} pra você (${formatEval(after)}).`;

  if (after?.final === "mate") return { title: `${played.san} é xeque-mate!`, text: "Fim de jogo.", bestSan: null };
  if (a.kind === "book") return { title, text: a.opening ? `Lance conhecido de abertura: ${a.opening}.` : "Lance conhecido de abertura.", bestSan: null };

  if (a.kind === "brilliant") {
    const mv = playLine(fenBefore, [played.uci], 1).verbose[0];
    return { title, text: `Sacrifício que funciona: ${piece(mv.promotion || mv.piece)} fica pra ser capturad${ART[mv.promotion || mv.piece]}, mas o motor confirma que vale a pena. ${pos}`, bestSan: null };
  }
  if (a.kind === "great") {
    return { title, text: `Único lance bom aqui: a segunda melhor opção deixava a posição em ${formatEval(a.evalSecond)}. ${pos}`, bestSan: null };
  }
  if (a.kind === "best") return { title, text: `É exatamente o que o Stockfish jogaria. ${pos}`, bestSan: null };
  if (a.kind === "excellent") return { title, text: `Praticamente tão bom quanto ${best}. ${pos}`, bestSan: best };
  if (a.kind === "good") return { title, text: `Lance sólido. O motor preferia ${best}, mas a diferença é pequena. ${pos}`, bestSan: best };

  const parts = [];
  if (a.kind === "miss") parts.push("O adversário tinha errado no lance anterior e aqui dava pra punir.");

  if (after?.mate !== undefined && Math.sign(after.mate) === -sign) {
    const fenAfter = playLine(fenBefore, [played.uci], 1).c.fen();
    parts.push(`Isso permite mate em ${Math.abs(after.mate)}: ${playLine(fenAfter, a.replyPv, Math.abs(after.mate) * 2 - 1).san.join(" ")}.`);
  } else if (before?.mate !== undefined && Math.sign(before.mate) === sign) {
    parts.push(`Você tinha mate em ${Math.abs(before.mate)}: ${playLine(fenBefore, a.bestPv, Math.abs(before.mate) * 2 - 1).san.join(" ")}.`);
  } else {
    const fullPlayed = playLine(fenBefore, [played.uci, ...(a.replyPv || [])], 7);
    const fullBest = playLine(fenBefore, a.bestPv || [], 7);
    const len = Math.min(fullPlayed.san.length, fullBest.san.length);
    const pl = playLine(fenBefore, [played.uci, ...(a.replyPv || [])], len);
    const bl = playLine(fenBefore, a.bestPv || [], len);
    const loss = material(bl.c, me) - material(pl.c, me);
    const oppCap = pl.caps.find((x) => x.by === opp && VAL[x.piece] >= 3);
    const myCap = bl.caps.find((x) => x.by === me && VAL[x.piece] >= 3);

    if (loss >= 2 && oppCap) parts.push(`Depois disso o adversário ganha ${piece(oppCap.piece)}: ${pl.san.slice(1, 5).join(" ")}.`);
    else if (loss >= 1) parts.push(`Perde material (~${loss} ponto${loss > 1 ? "s" : ""}): ${pl.san.slice(1, 5).join(" ")}.`);

    if (best && myCap && loss >= 2) parts.push(`Melhor era ${best}, que ganha ${piece(myCap.piece)}.`);
    else if (best) parts.push(`Melhor era ${best}, com a ideia ${bl.san.slice(0, 4).join(" ")}.`);
  }
  parts.push(`Avaliação: ${formatEval(before)} → ${formatEval(after)}.`);
  return { title, text: parts.join(" "), bestSan: best };
}
