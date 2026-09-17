import { Worker } from "bullmq";
import connectDB from "../config/db.js";
import Notification from "../models/Notification.js";
import {
  sendEmail,
  sendSms,
  sendPush,
} from "../services/notificationHandler.js";

const startWorker = async () => {
  await connectDB();

  const worker = new Worker(
    "notifications",
    async (job) => {
      console.log("Job received:", job.id);

      const { notificationId } = job.data;

      const notification = await Notification.findById(notificationId);

      if (!notification) {
        throw new Error("Notification not found");
      }

      switch (notification.type) {
        case "email":
          await sendEmail(notification.message, notification.recipient);
          break;
        case "sms":
          await sendSms(notification.message, notification.recipient);
          break;
        case "push":
          await sendPush(notification.message, notification.recipient);
          break;

        default:
          throw new Error("Unsupported notification type");
      }

      notification.status = "sent";
      await notification.save();
    },
    {
      connection: {
        host: "localhost",
        port: 6379,
      },
      limiter: {
        max: 10,
        duration: 1000,
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    console.error(`Job ${job?.id} failed:`, err.message);

    if (job.attemptsMade === job.opts.attempts) {
      const { notificationId } = job.data;

      const notification = await Notification.findById(notificationId);

      if (notification) {
        notification.status = "failed";
        await notification.save();
      }
    }
  });

  console.log("Worker started");
};

startWorker();
