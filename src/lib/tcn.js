// Decodes chess.com TCN moveList (2 chars per move) into {from,to,promotion?}.
const T = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=";
const sq = (i) => "abcdefgh"[i % 8] + (Math.floor(i / 8) + 1);

export function decodeTCN(list) {
  const moves = [];
  for (let i = 0; i < list.length; i += 2) {
    const a = T.indexOf(list[i]);
    let b = T.indexOf(list[i + 1]);
    const m = { from: sq(a) };
    if (b > 63) {
      m.promotion = "qnrbkp"[Math.floor((b - 64) / 3)];
      b = a + (a < 16 ? -8 : 8) + ((b - 1) % 3) - 1;
    }
    m.to = sq(b);
    moves.push(m);
  }
  return moves;
}
