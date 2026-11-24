// Minimal leveled logger (no dependency). Quiet during tests.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info');
const threshold = LEVELS[configured] ?? LEVELS.info;

function write(level, args) {
  if (LEVELS[level] > threshold) return;
  const stamp = new Date().toISOString();
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(`${stamp} ${level.toUpperCase().padEnd(5)}`, ...args);
}

const logger = {
  error: (...a) => write('error', a),
  warn: (...a) => write('warn', a),
  info: (...a) => write('info', a),
  debug: (...a) => write('debug', a),
};

export default logger;
