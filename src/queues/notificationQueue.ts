import { Queue } from "bullmq";

const notificationQueue = new Queue("notifications", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});

export default notificationQueue;
