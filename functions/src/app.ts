import express from "express";
import cors from "cors";

import topicsRouter from "./routes/topics";
import mentorsRouter from "./routes/mentors";
import menteesRouter from "./routes/mentees";
import requestsRouter from "./routes/requests";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import notificationsRouter from "./routes/notifications";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use("/auth", authRouter);
app.use("/topics", topicsRouter);
app.use("/mentors", mentorsRouter);
app.use("/mentees", menteesRouter);
app.use("/requests", requestsRouter);
app.use("/admin", adminRouter);
app.use("/notifications", notificationsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
