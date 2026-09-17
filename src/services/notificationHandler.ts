import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async (
  message: string,
  recipient: string,
): Promise<void> => {
  console.log(`Sending email to ${recipient}: ${message}`);

  const { data, error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: recipient,
    subject: "Notification Service Test",
    text: message,
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error("Email sending failed");
  }

  console.log("Email sent:", data);
};

export const sendSms = async (
  message: string,
  recipient: string,
): Promise<void> => {
  console.log(`Sending SMS to ${recipient}: ${message}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`SMS sent to ${recipient}`);
};

export const sendPush = async (
  message: string,
  recipient: string,
): Promise<void> => {
  console.log(`Sending push notification to ${recipient}: ${message}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`Push notification sent to ${recipient}`);
};
