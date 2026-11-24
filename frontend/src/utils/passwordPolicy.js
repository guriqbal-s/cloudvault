// Mirrors the backend policy (backend/src/validators/auth.validators.js): 10-128 chars, a letter and a digit, <=72 bytes.
// UI feedback only: the server is the authority.
export function checkPassword(password) {
  const bytes = new TextEncoder().encode(password).length;
  return {
    length: password.length >= 10 && password.length <= 128,
    letter: /[A-Za-z]/.test(password),
    digit: /\d/.test(password),
    bytes: bytes <= 72,
  };
}

export function passwordProblem(password) {
  const c = checkPassword(password);
  if (!c.length) return password.length < 10 ? 'Use at least 10 characters.' : 'Use at most 128 characters.';
  if (!c.bytes) return 'This password is too long (72 bytes maximum).';
  if (!c.letter || !c.digit) return 'Include at least one letter and one number.';
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
