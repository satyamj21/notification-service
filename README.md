# Notification Service

A backend-focused mini-project built to understand how **asynchronous / background processing** works in real-world backend systems — using **BullMQ**, **Redis**, and **MongoDB** to decouple notification delivery from the main API request cycle.

Instead of sending emails/SMS/push notifications synchronously inside an API request (which can slow down or block the request while waiting on external providers), this service accepts the request, validates it, persists it, and hands the actual delivery work off to a background worker via a job queue.

---

## Table of Contents

- [Why This Project Exists](#why-this-project-exists)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [API Endpoints](#api-endpoints)
- [Queue & Worker Flow](#queue--worker-flow)
- [Retry Mechanism](#retry-mechanism)
- [Rate Limiting](#rate-limiting)
- [Known Limitations](#known-limitations)
- [Getting Started](#getting-started)
- [Running the System](#running-the-system)
- [What I Learned](#what-i-learned)

---

## Why This Project Exists

A naive notification implementation puts everything inside the request-response cycle:

```
Client → POST /api/notifications → Send email/SMS/push → Wait for external provider → Response
```

The problem: external delivery calls are slow and failure-prone. If the API waits on them directly, request latency increases and the server is put under unnecessary load at scale.

This project solves that by splitting the flow into two independent pieces:

```
API:     Client → Validate → Store → Queue job → Respond immediately
Worker:  Queue → Process job → Deliver notification → Update status
```

---

## Architecture

```
                         Client
                           |
                           | POST /api/notifications
                           v
                    +---------------+
                    | Express API   |
                    +---------------+
                           |
                      Validation
                           |
                    +------+------+
                    |             |
                    v             v
                 MongoDB      BullMQ Queue
                (pending)          |
                                   v
                                 Redis
                                   |
                                   v
                                Worker
                                   |
                          notification.type
                             /     |     \
                            v      v      v
                        Email     SMS     Push
                           |       |       |
                           v       v       v
                        Resend   Mock    Mock
                           |
                           v
                     MongoDB = sent
```

**On failure:** Worker → Error → BullMQ retry → up to 3 attempts → all exhausted → `MongoDB = failed`

### Design principle: separation of responsibilities

| Layer                 | Responsibility                                               |
| --------------------- | ------------------------------------------------------------ |
| **Controller**        | Handle HTTP requests, validate input                         |
| **Model**             | Represent notification data in MongoDB                       |
| **Queue**             | Represent a background work instruction                      |
| **Worker**            | Consume jobs and perform the actual work                     |
| **Service / Handler** | Execute the channel-specific delivery logic (email/SMS/push) |

A **notification** (persistent business data in MongoDB) and a **job** (background work instruction in BullMQ/Redis) are treated as two distinct concepts — the job only carries a `notificationId`, and the worker re-fetches the full record from MongoDB. This avoids duplicating data across systems.

---

## Tech Stack

- **Node.js** — JavaScript runtime
- **TypeScript** — static typing
- **Express.js** — REST API framework
- **MongoDB + Mongoose** — persistent storage and ODM
- **Redis** — backing store for BullMQ and for API rate limiting
- **BullMQ** — job queue / background worker library
- **ioredis** — Redis client (used directly for rate limiting)
- **Resend** — email delivery provider
- **Docker** — running Redis locally

> BullMQ does not send notifications itself — it manages queues, jobs, retries, and worker coordination. The application code (worker + handlers) performs the actual delivery.

---

## Project Structure

```
notification-service/
│
├── src/
│   ├── config/
│   │   └── db.ts                     # MongoDB connection
│   │
│   ├── controllers/
│   │   └── notificationController.ts # Request handling & validation
│   │
│   ├── models/
│   │   └── Notification.ts           # Mongoose schema
│   │
│   ├── routes/
│   │   └── notificationRoutes.ts     # Route → controller mapping
│   │
│   ├── queues/
│   │   └── notificationQueue.ts      # BullMQ queue definition
│   │
│   ├── workers/
│   │   └── notificationWorker.ts     # BullMQ worker (separate process)
│   │
│   ├── services/
│   │   └── notificationHandler.ts    # sendEmail / sendSms / sendPush
│   │
│   ├── rateLimiter.ts                # Redis-based rate-limit middleware
│   ├── app.ts                        # Express app setup
│   └── server.ts                     # Entry point (env, DB, server start)
│
├── .env
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

**Note:** The API process and the worker process are independent Node.js processes. Each establishes its own MongoDB connection and its own environment configuration — starting one does not start the other.

---

## Data Model

```json
{
  "userId": "U123",
  "message": "Your order has shipped",
  "type": "email",
  "recipient": "user@example.com",
  "status": "pending"
}
```

| Field       | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `userId`    | Identifies the notification's owner                                      |
| `message`   | Notification content                                                     |
| `type`      | `email` \| `sms` \| `push`                                               |
| `recipient` | Meaning depends on `type` — email address, phone number, or device token |
| `status`    | `pending` → `sent` or `failed`                                           |

---

## API Endpoints

### Create a notification

```
POST /api/notifications
```

**Body:**

```json
{
  "userId": "U123",
  "message": "Your order has shipped",
  "type": "email",
  "recipient": "user@example.com"
}
```

**Flow:** Rate limiter → Controller → Field validation → Type validation → Recipient validation (regex per channel) → MongoDB create (`status: pending`) → Add BullMQ job → Respond immediately (does **not** wait for delivery)

Validation happens **before** the MongoDB document and the queue job are created, so invalid requests never enter the pipeline.

| Response | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| `201`    | Notification accepted and queued                                  |
| `400`    | Missing/invalid fields, invalid type, or invalid recipient format |
| `429`    | Rate limit exceeded                                               |

---

### Get a notification by ID

```
GET /api/notifications/:id
```

Uses `req.params.id` → `Notification.findById(id)`

| Response | Meaning                     |
| -------- | --------------------------- |
| `200`    | Notification found          |
| `404`    | Notification does not exist |

---

### Get notifications by user

```
GET /api/notifications?userId=U123
```

Uses `req.query.userId` → `Notification.find({ userId })`

Returns `[]` (not an error) when no notifications match.

---

## Queue & Worker Flow

The API is the **producer** — it adds a job containing only the notification's ID:

```json
{ "notificationId": "68abc123..." }
```

The **worker** is a separate process that:

1. Listens to the `notifications` queue
2. Reads `job.data.notificationId`
3. Fetches the full notification from MongoDB
4. Routes based on `notification.type`:
   - `email` → `sendEmail()` (via Resend)
   - `sms` → `sendSms()` (mocked, provider-ready)
   - `push` → `sendPush()` (mocked, provider-ready)
5. On success → updates `status: sent`
6. On thrown error → lets BullMQ handle the retry

**Mental model:**

```
Queue  = waiting area
Job    = task
Worker = employee processing the task
Redis  = system storing/coordinating queue state
BullMQ = software providing the queue/worker system
```

---

## Retry Mechanism

Configured as:

```ts
attempts: 3
backoff: { type: "fixed", delay: 5000 }
```

There is **no manual retry loop** — the worker simply throws an error on failure, and BullMQ handles retries automatically according to this config.

```
Attempt 1 → fail → wait 5s → Attempt 2 → fail → wait 5s → Attempt 3
```

- If any attempt succeeds → `status: sent`
- If all 3 attempts fail → `status: failed`

The worker tracks `job.attemptsMade` (0 before execution, incrementing on each failure) and checks `job.attemptsMade === job.opts.attempts` to determine when retries are exhausted — a notification only moves to `failed` after the **final** attempt fails, not after the first.

> **Current limitation:** all thrown errors are treated as retryable. A production version would distinguish retryable failures (timeouts, temporary provider outages) from non-retryable ones (invalid credentials, malformed recipient, permanent config errors like `403`) — this is identified but not yet implemented.

---

## Rate Limiting

Two distinct concepts are involved, and this project implements only the first:

| Type                            | Question it answers                      | Implemented?         |
| ------------------------------- | ---------------------------------------- | -------------------- |
| **API rate limiting**           | How many requests can a client send?     | ✅ Yes (Redis-based) |
| **BullMQ worker rate limiting** | How fast should the worker process jobs? | ❌ Not implemented   |

**Current limit:** 3 requests / 60 seconds / IP, implemented as Express middleware using Redis directly (via `ioredis`).

**Flow:**

```
Client → POST → Rate limiter → Redis INCR on key "rate-limit:<ip>"
  count <= 3 → next() → controller
  count > 3  → 429 Too Many Requests
```

The key is given a 60-second TTL on first creation; once it expires, the counter resets.

---

## Known Limitations

This project intentionally leaves the following unimplemented, as identified areas for future/production hardening:

- Real SMS provider (currently mocked)
- Real push notification provider (currently mocked)
- Retryable vs. non-retryable error classification
- **Transactional Outbox Pattern** — currently, MongoDB writes and `queue.add()` are two separate operations. If the MongoDB write succeeds but the queue add fails, a notification can remain `pending` forever with no corresponding job. This is a known distributed-systems consistency gap.
- Authentication / authorization
- Advanced monitoring / observability
- Full production-grade graceful shutdown handling
- Automated test suite
- Pagination on list endpoints

---

## Getting Started

### Prerequisites

- Node.js
- Docker (for running Redis locally)
- A MongoDB connection string
- A Resend API key

### Environment Variables

Create a `.env` file at the project root:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
RESEND_API_KEY=your_resend_api_key
```

`.env` is git-ignored (along with `node_modules` and `dist`). Since the API and worker run as separate processes, **both** need access to these environment variables.

### Start Redis

```bash
docker run --name notification-redis -p 6379:6379 -d redis
```

Verify it's running:

```bash
docker exec -it notification-redis redis-cli
PING
# → PONG
```

---

## Running the System

This project runs as **two separate processes** — both must be running for the full flow to work.

**Terminal 1 — API server:**

```bash
npm run dev
```

**Terminal 2 — Background worker:**

```bash
npx tsx src/workers/notificationWorker.ts
```

---

## What I Learned

- **Async/await in TypeScript:** an `async` function returns a `Promise`; `await` pauses for a `Promise` to settle; `Promise<void>` means it completes without a return value.
- **`req.body` vs `req.params` vs `req.query`** — and when to use each (creation payloads, single-resource lookups, and filtering, respectively).
- **Mongoose `findById()` vs `find()`** — the latter returns `[]`, not `null`, when nothing matches.
- **HTTP status codes** in practice: `400` (bad input), `404` (not found), `429` (rate limited), `500` (server error).
- **Middleware fundamentals:** `req`, `res`, `next` — and how to short-circuit a request with a rejection response.
- **Queue vs. record:** a job is a lightweight instruction; the notification itself is the persistent business record. Keeping them separate (and passing only an ID) avoids data duplication.
- **Redis's actual role:** it's not the queue library — BullMQ uses Redis as its coordination/storage backend, and Redis is separately useful for fast, temporary state like rate-limit counters.
- **Why background workers matter:** decoupling slow/unreliable external work from the request-response cycle is a core scalability pattern in real backend systems.

---

## Interview Summary

> I built a Notification Service as a backend mini-project to understand asynchronous processing behind the scenes. In a basic implementation, the API server would directly handle email, SMS, or push delivery, meaning every request could stay open while waiting on external services. I separated that background work using BullMQ. The API validates the notification, stores it in MongoDB with a `pending` status, and adds a job to a BullMQ queue backed by Redis. A separate worker consumes the job, checks the notification type, and calls the appropriate handler — email is integrated with Resend, while SMS and push use mock handlers. On success, MongoDB is updated to `sent`; if the worker throws an error, BullMQ automatically retries based on the configured attempts and backoff, and marks the notification `failed` once all attempts are exhausted. I also added Redis-based API rate limiting to prevent excessive notification creation requests.

---

**One-sentence purpose:** Decouple notification delivery from the main API request using a Redis-backed BullMQ job queue and separate background workers, while providing retries, failure tracking, and rate limiting.
