/**
 * Catches anything not already handled by a route, and makes sure we
 * never send a stack trace or internal error detail to the frontend.
 */
function errorHandler(err, req, res, next) {
  console.error("Unhandled server error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
}

module.exports = errorHandler;
