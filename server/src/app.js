import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { generateReply } from "./replies.js";
import { firstError, validateCreate, validateListQuery, validatePatch } from "./validation.js";

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function badRequest(res, details) {
  return res.status(400).json({ error: firstError(details), details });
}

/**
 * Builds the Express app. Dependencies are injected so tests can use a temporary
 * data file and a mocked AI provider.
 */
export function createApp({ store, config, fetchImpl = globalThis.fetch, logger = console }) {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, same-origin, tests) are always allowed.
        callback(null, !origin || config.corsOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "SmartDesk AI API",
      aiEnabled: Boolean(config.ai.apiKey),
      time: new Date().toISOString(),
    });
  });

  app.get("/api/stats", wrap(async (_req, res) => res.json(await store.stats())));

  app.get(
    "/api/tickets",
    wrap(async (req, res) => {
      const { value, details } = validateListQuery(req.query);
      if (!value) return badRequest(res, details);
      res.json(await store.list(value));
    }),
  );

  app.get(
    "/api/tickets/:id",
    wrap(async (req, res) => {
      const ticket = await store.get(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found." });
      res.json(ticket);
    }),
  );

  app.post(
    "/api/tickets",
    wrap(async (req, res) => {
      const { value, details } = validateCreate(req.body);
      if (!value) return badRequest(res, details);
      const normalize = (text)=>
        String (text ?? "").trim().toLowerCase().replace(/\s+/g," ");
      if (req.query.allowDuplicate !=="true"){
        const tickets = await store.list({});
        console.log("ticket loaded for duplicate check ")
        const duplicate = tickets.find((ticket) =>
          ticket.status!== "Resolved " && 
        normalize(ticket.email)=== normalize(value.email) &&
        normalize(tickets.subject)=== normalize(value.subject)
        );
        if (duplicate){


          return res.status(409).json({
            error:" a duplicate error ",
            duplicatedId:duplicate.id,
            subject:duplicate.subject,
            status : duplicate.status




          });

        }
 



      }



      res.status(201).json(await store.create(value));
    }),
  );

  app.patch(
    "/api/tickets/:id",
    wrap(async (req, res) => {
      const { value, details } = validatePatch(req.body);
      if (!value) return badRequest(res, details);
      const updated = await store.update(req.params.id, value);
      if (!updated) return res.status(404).json({ error: "Ticket not found." });
      res.json(updated);
    }),
  );

  app.delete(
    "/api/tickets/:id",
    wrap(async (req, res) => {
      const removed = await store.remove(req.params.id);
      if (!removed) return res.status(404).json({ error: "Ticket not found." });
      res.status(204).end();
    }),
  );

  app.post(
    "/api/tickets/:id/suggest-reply",
    wrap(async (req, res) => {
      const ticket = await store.get(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found." });
      const suggestion = await generateReply(ticket, config.ai, { fetchImpl, logger });
      res.json({ ticketId: ticket.id, ...suggestion });
    }),
  );

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));

  // Optional: serve the production client build (npm run build) from the same server.
  const indexHtml = path.join(config.clientDist ?? "", "index.html");
  if (config.clientDist && existsSync(indexHtml)) {
    app.use(express.static(config.clientDist));
    app.get("*", (_req, res) => res.sendFile(indexHtml));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body must be valid JSON." });
    }
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body is too large." });
    }
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: "Bad request." });
    }
    logger.error?.(error);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
