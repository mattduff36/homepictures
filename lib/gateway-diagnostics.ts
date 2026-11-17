import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { isIP } from "node:net";
import { VIEWER_ACTIONS, VIEWER_GATEWAY_ORIGIN } from "./viewer-protocol";

type RecordValue = Record<string, unknown>;
type Log = (record: RecordValue) => void;
function object(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT",
  "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETDOWN",
  "EADDRNOTAVAIL", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "ABORT_ERR"]);

// Never serialize an exception: messages, stacks and nested objects may contain secrets.
export function transportCodes(error: unknown): string[] {
  const found = new Set<string>();
  walkErrors(error, item => {
    const code = item.code;
    if (typeof code === "string" && (NETWORK_CODES.has(code) ||
        /^(?:UND_ERR_|ERR_TLS_|ERR_SSL_)[A-Z0-9_]{1,48}$/.test(code))) found.add(code);
    if (item.name === "TimeoutError") found.add("TIMEOUT");
    if (item.name === "AbortError") found.add("ABORT_ERR");
  });
  return [...found].slice(0, 8);
}

function walkErrors(error: unknown, visit: (item: RecordValue) => void) {
  const queue = [error], seen = new Set<unknown>();
  for (let count = 0; queue.length && count < 16; count++) {
    const item = queue.shift();
    if (!object(item) || seen.has(item)) continue;
    seen.add(item);
    try {
      visit(item);
      if (item.cause) queue.push(item.cause);
      if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
    } catch { /* Ignore unusual exception accessors. */ }
  }
}

function peer(socket: unknown) {
  if (!object(socket)) return {};
  return {
    ...(typeof socket.remoteAddress === "string" && isIP(socket.remoteAddress)
      ? { remote_address: socket.remoteAddress } : {}),
    ...(Number.isInteger(socket.remotePort) && Number(socket.remotePort) > 0 && Number(socket.remotePort) <= 65535
      ? { remote_port: socket.remotePort } : {}),
  };
}

// These are explicitly reported attempted addresses, not a later DNS lookup or a claimed selected peer.
function attemptedAddresses(error: unknown): string[] {
  const addresses = new Set<string>();
  walkErrors(error, item => {
    if (typeof item.address === "string" && isIP(item.address)) addresses.add(item.address);
    if (typeof item.message !== "string") return;
    const match = /attempted address(?:es)?: ([^)]{1,512})\)/.exec(item.message.slice(0, 1024));
    for (const candidate of match?.[1].split(", ") ?? []) {
      const separator = candidate.lastIndexOf(":");
      const address = candidate.slice(0, separator).replace(/^\[|\]$/g, "");
      const port = candidate.slice(separator + 1);
      if (separator > 0 && isIP(address) && /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535) {
        addresses.add(address);
      }
    }
  });
  return [...addresses].slice(0, 8);
}

type Connection = { id: string; started: number };
type Trace = { id: string; action: string; started: number; phase: string; active: boolean;
  observed?: boolean; connection?: string; remote?: RecordValue; headersMs?: number; codes?: string[] };

/** Passive observers only: no dispatcher, DNS, TLS, retry or timeout changes. */
export function createGatewayDiagnostics(origin: string, emit: Log = record => console.info(JSON.stringify(record))) {
  const target = new URL(origin);
  const context = new AsyncLocalStorage<Trace>();
  const requests = new WeakMap<object, Trace>();
  const connections = new WeakMap<object, Connection>();
  const sockets = new WeakMap<object, Connection>();
  const failures = new WeakMap<object, Connection>();
  const subscriptions: Array<[string, (message: unknown) => void]> = [];
  function log(record: RecordValue) {
    try { emit({ time: new Date().toISOString(), ...record }); } catch { /* Logging cannot break viewing. */ }
  }
  function subscribe(name: string, callback: (value: RecordValue) => void) {
    const listener = (message: unknown) => {
      try { if (object(message)) callback(message); } catch { /* Observers must never throw. */ }
    };
    channel(name).subscribe(listener);
    subscriptions.push([name, listener]);
  }
  function matches(params: unknown): params is RecordValue {
    return object(params) && params.hostname === target.hostname &&
      String(params.port) === (target.port || (target.protocol === "https:" ? "443" : "80")) &&
      params.protocol === target.protocol;
  }
  function connection(params: RecordValue): Connection {
    let value = connections.get(params);
    if (!value) {
      value = { id: randomBytes(8).toString("hex"), started: performance.now() };
      connections.set(params, value);
    }
    return value;
  }
  function linkError(trace: Trace, error: unknown) {
    trace.codes = [...new Set([...(trace.codes ?? []), ...transportCodes(error)])].slice(0, 8);
    walkErrors(error, item => {
      const value = failures.get(item);
      if (value) trace.connection = value.id;
    });
  }
  subscribe("undici:client:beforeConnect", ({ connectParams }) => {
    if (!matches(connectParams)) return;
    const value = connection(connectParams);
    log({ event: "viewer_gateway_connection", phase: "connect_start", connection_id: value.id });
  });
  subscribe("undici:client:connected", ({ connectParams, socket }) => {
    if (!matches(connectParams)) return;
    const value = connection(connectParams);
    if (object(socket)) sockets.set(socket, value);
    log({ event: "viewer_gateway_connection", phase: "connected", connection_id: value.id,
      elapsed_ms: Math.round(performance.now() - value.started), ...peer(socket) });
  });
  subscribe("undici:client:connectError", ({ connectParams, socket, error }) => {
    if (!matches(connectParams)) return;
    const value = connection(connectParams);
    if (object(error)) failures.set(error, value);
    log({ event: "viewer_gateway_connection", phase: "connect_error", connection_id: value.id,
      elapsed_ms: Math.round(performance.now() - value.started), transport_codes: transportCodes(error),
      attempted_addresses: attemptedAddresses(error), ...peer(socket) });
  });
  subscribe("undici:request:create", ({ request }) => {
    const trace = context.getStore();
    if (!trace?.active || !object(request) || String(request.origin) !== origin ||
        request.path !== `/v1/${trace.action}` || request.method !== "POST") return;
    requests.set(request, trace);
    trace.observed = true;
    trace.phase = "request_created";
  });
  subscribe("undici:client:sendHeaders", ({ request, socket }) => {
    if (!object(request)) return;
    const trace = requests.get(request);
    if (!trace?.active) return;
    trace.phase = "headers_sent";
    trace.remote = peer(socket);
    const value = object(socket) ? sockets.get(socket) : undefined;
    trace.connection = value?.id;
    log({ event: "viewer_gateway_request", phase: trace.phase, trace_id: trace.id, action: trace.action,
      elapsed_ms: Math.round(performance.now() - trace.started),
      ...(trace.connection ? { connection_id: trace.connection } : {}), ...trace.remote });
  });
  subscribe("undici:request:headers", ({ request }) => {
    const trace = object(request) ? requests.get(request) : undefined;
    if (trace?.active) { trace.phase = "response_headers"; trace.headersMs = Math.round(performance.now() - trace.started); }
  });
  subscribe("undici:request:error", ({ request, error }) => {
    const trace = object(request) ? requests.get(request) : undefined;
    if (trace?.active) linkError(trace, error);
  });
  subscribe("undici:request:trailers", ({ request }) => {
    const trace = object(request) ? requests.get(request) : undefined;
    if (trace?.active) trace.phase = "body_complete";
  });
  return {
    async run<T>(id: string, action: string, operation: () => Promise<T>, status: () => number | undefined): Promise<T> {
      if (!/^[0-9a-f]{32}$/.test(id) || !VIEWER_ACTIONS.some(value => value === action)) {
        throw new Error("Invalid gateway diagnostic context");
      }
      const trace: Trace = { id, action, started: performance.now(), phase: "fetch_start", active: true };
      log({ event: "viewer_gateway_attempt", phase: "start", trace_id: id, action });
      let outcome = "success";
      let failureEvent: string | undefined;
      try {
        return await context.run(trace, operation);
      } catch (error) {
        outcome = "error";
        linkError(trace, error);
        try {
          if (object(error) && typeof error.event === "string" &&
              /^viewer_(?:body_timeout|body_too_large|invalid_json|gateway_denied)$/.test(error.event)) {
            failureEvent = error.event;
          }
        } catch { /* Do not let an exception accessor replace the real failure. */ }
        throw error;
      } finally {
        trace.active = false;
        const upstreamStatus = status();
        log({ event: "viewer_gateway_attempt", phase: "end", trace_id: id, action, outcome,
          last_stage: upstreamStatus !== undefined && trace.phase === "fetch_start" ? "response_headers" : trace.phase,
          network_events_observed: trace.observed === true, elapsed_ms: Math.round(performance.now() - trace.started),
          upstream_status: upstreamStatus ?? null, headers_ms: trace.headersMs ?? null,
          ...(failureEvent ? { failure_event: failureEvent } : {}),
          transport_codes: trace.codes ?? [], ...(trace.connection ? { connection_id: trace.connection } : {}),
          ...trace.remote });
      }
    },
    dispose() { for (const [name, listener] of subscriptions) channel(name).unsubscribe(listener); context.disable(); },
  };
}

const processState = globalThis as typeof globalThis & {
  __mpdeeGatewayDiagnostics?: ReturnType<typeof createGatewayDiagnostics>;
};
export function gatewayDiagnostics() {
  return processState.__mpdeeGatewayDiagnostics ??= createGatewayDiagnostics(VIEWER_GATEWAY_ORIGIN);
}
