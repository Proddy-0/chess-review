# Chess Review

Ad-free game review for chess.com and Lichess games, running entirely in the browser.

**Site:** https://proddy-0.github.io/chess-review/

- Animated replay of the game (play/pause, speed, keyboard arrows, flip board)
- Stockfish 19 (WASM, single-thread) analysis of every position: eval bar, eval graph, accuracy per side
- Move classification (best / inaccuracy / mistake / blunder) with the best move drawn as an arrow
- Plain-language explanations (pt-BR) built only from Stockfish lines — no LLM, nothing invented
- Import by username (chess.com / Lichess public APIs) or paste a PGN

## Browser extension (chess.com)

`extension/` adds a **Revisar no Chess Review** button on chess.com game pages **only after the game is finished**
(it checks the server-side `isFinished` flag). Nothing is shown or analysed during a live game, in line with
chess.com's fair-play rules.

Install: download `extension.zip` from the site, extract it, open `chrome://extensions`, enable Developer mode,
click **Load unpacked** and pick the folder.

## Dev

```bash
npm install
npm run dev      # http://localhost:5173/chess-review/
npm run build
npm test         # TCN decoder vs real chess.com games (needs network)
```

## License

GPL-3.0 — includes [Stockfish.js](https://github.com/nmrugg/stockfish.js) and
[chessground](https://github.com/lichess-org/chessground), both GPL-3.0.
