import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["email", "sms", "push"],
    required: true,
  },
  recipient: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "sent", "failed"],
    default: "pending",
  },
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
