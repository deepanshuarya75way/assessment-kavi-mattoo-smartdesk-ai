import type { Health, NewTicket, ReplySuggestion, Stats, Ticket, TicketFilters, TicketPatch } from "./types";

// Empty by default: requests go to /api on the same origin (Vite proxies it in development).
// Set VITE_API_URL (e.g. https://api.example.com) in client/.env if the API is hosted elsewhere.
const BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

export class ApiError extends Error {
  status: number;
  details: Record<string, string>;
  constructor(message: string, status: number, details: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("Cannot reach the server. Make sure the API is running (npm run dev).", 0);
  }

  if (!response.ok) {
    let body: { error?: string; details?: Record<string, string> } = {};
    try {
      body = await response.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(body.error || `Request failed (HTTP ${response.status}).`, response.status, body.details ?? {});
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

export const getHealth = () => request<Health>("/health");
export const getStats = (signal?: AbortSignal) => request<Stats>("/stats", { signal });

export function listTickets(filters: TicketFilters, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== "All") params.set("status", filters.status);
  if (filters.priority !== "All") params.set("priority", filters.priority);
  if (filters.category !== "All") params.set("category", filters.category);
  const query = params.toString();
  return request<Ticket[]>(`/tickets${query ? `?${query}` : ""}`, { signal });
}

export const getTicket = (id: string, signal?: AbortSignal) => request<Ticket>(`/tickets/${enc(id)}`, { signal });
export const createTicket = (data: NewTicketz) =>
  request<Ticket>("/tickets", { method: "POST", body: JSON.stringify(data) });
export const updateTicket = (id: string, patch: TicketPatch) =>
  request<Ticket>(`/tickets/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteTicket = (id: string) => request<void>(`/tickets/${enc(id)}`, { method: "DELETE" });
export const suggestReply = (id: string) =>
  request<ReplySuggestion>(`/tickets/${enc(id)}/suggest-reply`, { method: "POST" });
