require("dotenv").config();
const express = require("express");
const cors = require("cors");
const analyzeJobMatchRoute = require("./routes/analyzeJobMatch");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Only the origins listed in ALLOWED_ORIGINS may call this API — never a
// wildcard, since this server holds a paid AI credential behind it.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (e.g. curl, server-to-server, same-origin) or an
      // explicitly allowed origin — otherwise reject.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

// The request is already fully blocked by the cors() middleware above —
// this just maps that rejection to a proper 403 instead of letting it
// fall through to the generic 500 handler, without exposing anything
// beyond "this origin isn't allowed."
app.use((err, req, res, next) => {
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "This origin is not allowed to access this API." });
  }
  next(err);
});

// Body size is capped well above what a resume/job-description pair
// should ever need (real per-field limits are enforced in the route),
// just to stop obviously oversized payloads early.
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", analyzeJobMatchRoute);

// 404 for anything else under /api
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JobTrack AI backend listening on port ${PORT}`);
});

module.exports = app;
