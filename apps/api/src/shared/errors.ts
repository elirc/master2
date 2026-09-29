import { DomainError } from "@billing/domain";
import { ZodError } from "zod";
import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorMiddleware(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof DomainError) {
    const status = { validation: 400, conflict: 409, forbidden: 403 }[error.category];
    response.status(status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Request validation failed.", code: "request.invalid" });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && (error as { status?: number }).status === 400) {
    response.status(400).json({ error: "Malformed JSON request body.", code: "request.invalid" });
    return;
  }
  response.status(500).json({ error: "Internal server error.", code: "server.internal" });
}
