import Notification from "../models/Notification.js";
import notificationQueue from "../queues/notificationQueue.js";
import { Request, Response } from "express";

export const createNotification = async (req: Request, res: Response) => {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\+?[1-9]\d{9,14}$/;

    const { userId, message, type, recipient } = req.body;

    if (!userId || !message || !type || !recipient) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    switch (type) {
      case "email":
        if (!emailRegex.test(recipient.trim())) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid email address" });
        }
        break;
      case "sms":
        if (!phoneRegex.test(recipient.trim())) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid phone number" });
        }
        break;
      case "push":
        if (!recipient.trim()) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid device token" });
        }
        break;
      default:
        return res
          .status(400)
          .json({ success: false, message: "Invalid notification type" });
    }

    const notification = await Notification.create({
      userId,
      message,
      type,
      recipient,
    });

    const job = await notificationQueue.add(
      "send-notification",
      {
        notificationId: notification._id.toString(),
      },
      {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 5000,
        },
      },
    );

    console.log("Job added:", job.id);

    return res.status(201).json({
      notification,
      success: true,
      message: "Notification created succesfully!",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
};

export const getNotificationById = async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found!" });
    }

    return res.status(200).json({
      notification,
      success: true,
      message: "Notification found successfully",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
};

export const getNotificationsByUserId = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing ID" });
    }

    const notification = await Notification.find({ userId });

    return res.status(200).json({
      notification,
      success: true,
      message: "Notification found successfully",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
};
