import express from "express";
import {
  createNotification,
  getNotificationById,
  getNotificationsByUserId,
} from "../controllers/notificationController.js";
import { rateLimiter } from "../rateLimiter.js";
const router = express.Router();

router.post("/", rateLimiter, createNotification);
router.get("/:id", getNotificationById);
router.get("/", getNotificationsByUserId);

export default router;
