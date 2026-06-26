import express from "express";
import cors from "cors";
import helmet from "helmet";

import topicsRouter from "./routes/topics";
import mentorsRouter from "./routes/mentors";
import menteesRouter from "./routes/mentees";
import requestsRouter from "./routes/requests";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import notificationsRouter from "./routes/notifications";

const app = express();

app.use(helmet());

// Restrict CORS to the configured frontend origin (falls back to same-origin in prod)
const allowedOrigin = process.env.CORS_ORIGIN ?? process.env.SITE_URL ?? "https://maakaf.com";
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server calls (no Origin header) and the configured frontend
    if (!origin || origin === allowedOrigin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "50kb" }));

app.use("/auth", authRouter);
app.use("/topics", topicsRouter);
app.use("/mentors", mentorsRouter);
app.use("/mentees", menteesRouter);
app.use("/requests", requestsRouter);
app.use("/admin", adminRouter);
app.use("/notifications", notificationsRouter);

if (process.env.ENABLE_DEV_ENDPOINTS === "true") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const devRouter = require("./dev/routes").default;
  app.use("/auth/dev", devRouter);
}

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND" } });
});

export default app;
