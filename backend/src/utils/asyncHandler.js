// Express 4 does not catch rejected promises from async handlers; this forwards them to next().
// Wrapping the call in .then() also routes synchronous throws to next().
export default function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
}
