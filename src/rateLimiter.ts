import { Redis } from "ioredis";
import { Request, Response, NextFunction } from "express";

const redis = new Redis({
  host: "localhost",
  port: 6379,
});

export const rateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const ip = req.ip;
    const key = `rate-limit:${ip}`;

    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count > 3) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Try again later.",
      });
    }

    next();
  } catch (error) {
    console.error("Rate limiter error:", error);

    return res.status(500).json({
      success: false,
      message: "Rate limiter error",
    });
  }
};

