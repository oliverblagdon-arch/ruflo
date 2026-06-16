/** Minimal structured-ish logger. No deps. */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info(msg: string): void {
    console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.cyan}›${COLORS.reset} ${msg}`);
  },
  step(stage: string, msg: string): void {
    console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.green}■ ${stage.padEnd(9)}${COLORS.reset} ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.yellow}! ${msg}${COLORS.reset}`);
  },
  error(msg: string): void {
    console.error(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.red}✗ ${msg}${COLORS.reset}`);
  },
};
