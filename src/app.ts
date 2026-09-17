import express from "express";
import dotenv from "dotenv";
import router from "./routes/notificationRoutes.js";

dotenv.config();
const app = express();

app.use(express.json());

app.use("/api/notifications", router);

app.get("/", (req, res) => {
  res.json({
    message: "Notification Service API is running",
  });
});

export default app;
