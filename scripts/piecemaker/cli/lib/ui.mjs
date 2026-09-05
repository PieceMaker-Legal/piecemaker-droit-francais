const supportsColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

const paint = (code) => (text) => (supportsColor ? `\u001b[${code}m${text}\u001b[0m` : String(text));

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  cyan: paint('36'),
};

export function banner(text) {
  process.stdout.write(`\n${c.bold(c.cyan(text))}\n\n`);
}

export function step(text) {
  process.stdout.write(`${c.blue('•')} ${text}\n`);
}

export function ok(text) {
  process.stdout.write(`${c.green('✓')} ${text}\n`);
}

export function warn(text) {
  process.stdout.write(`${c.yellow('!')} ${text}\n`);
}

export function fail(text) {
  process.stderr.write(`${c.red('✗')} ${text}\n`);
}

export function detail(text) {
  process.stdout.write(`  ${c.dim(text)}\n`);
}

export function blank() {
  process.stdout.write('\n');
}
