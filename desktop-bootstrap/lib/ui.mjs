import { noteProgress } from './progress.mjs';

const CYAN = '\u001b[1;36m';
const GREEN = '\u001b[1;32m';
const YELLOW = '\u001b[1;33m';
const RED = '\u001b[1;31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

export const ui = {
  step(message) {
    console.log(`\n${CYAN}==${RESET} ${message}`);
    noteProgress({ step: message, increment: true });
  },
  ok(message) {
    console.log(`${GREEN}OK${RESET} ${message}`);
    noteProgress({ detail: message });
  },
  warn(message) {
    console.log(`${YELLOW}!${RESET} ${message}`);
    noteProgress({ detail: message });
  },
  fail(message) {
    console.error(`${RED}!!${RESET} ${message}`);
    noteProgress({ detail: message });
  },
  detail(message) {
    console.log(`${DIM}   ${message}${RESET}`);
    noteProgress({ detail: message });
  },
};
