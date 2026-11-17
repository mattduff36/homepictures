import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTCPServer } from "node:net";
import { channel } from "node:diagnostics_channel";
import { test } from "node:test";
import { createGatewayDiagnostics, transportCodes } from "./gateway-diagnostics";

test("a real failed TLS handshake is linked to the exact request before headers are sent", async () => {
  const server = createTCPServer(socket => socket.once("data", () => socket.destroy()));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `https://127.0.0.1:${address.port}`;
  const logs: Record<string, unknown>[] = [];
  const diagnostics = createGatewayDiagnostics(origin, record => logs.push(record));
  try {
    await assert.rejects(diagnostics.run("d".repeat(32), "session", async () => {
      await fetch(`${origin}/v1/session`, {method:"POST", body:'{"password":"not-sent-private"}'});
    }, () => undefined));
    const connection = logs.find(record => record.phase === "connect_error");
    const end = logs.find(record => record.phase === "end");
    assert.ok(connection);
    assert.equal(end?.trace_id, "d".repeat(32));
    assert.equal(end?.connection_id, connection.connection_id);
    assert.equal(end?.last_stage, "request_created");
    assert.equal(end?.upstream_status, null);
    assert.ok((end?.transport_codes as string[]).includes("ECONNRESET"));
    assert.equal(logs.some(record => record.phase === "headers_sent"), false);
    assert.doesNotMatch(JSON.stringify(logs), /not-sent-private/);
  } finally {
    diagnostics.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("concurrent real fetches correlate their own socket and HTTP result without logging credentials", async () => {
  const server = createServer((request, response) => {
    request.resume();
    setTimeout(() => { response.writeHead(request.url === "/v1/heartbeat" ? 401 : 200,
      { "Content-Type": "application/json" }); response.end('{"ok":true}'); }, 15);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const logs: Record<string, unknown>[] = [];
  const diagnostics = createGatewayDiagnostics(origin, record => logs.push(record));
  try {
    await Promise.all(["session", "heartbeat"].map(async (action, index) => {
      let status: number | undefined;
      await diagnostics.run(String(index + 1).repeat(32), action, async () => {
        const result = await fetch(`${origin}/v1/${action}`, { method: "POST",
          headers: { "X-Viewer-Nonce": String(index + 1).repeat(32), "X-Viewer-Signature": "signature-private",
            Cookie: "session-private", Authorization: "Bearer private-token" },
          body: '{"password":"password-private","sdp":"private-sdp"}' });
        status = result.status;
        await result.json();
      }, () => status);
    }));
    const ends = logs.filter(record => record.event === "viewer_gateway_attempt" && record.phase === "end");
    assert.equal(ends.length, 2);
    for (const [index, action] of ["session", "heartbeat"].entries()) {
      const end = ends.find(record => record.trace_id === String(index + 1).repeat(32));
      assert.equal(end?.action, action);
      assert.equal(end?.upstream_status, index === 0 ? 200 : 401);
      assert.equal(end?.last_stage, "body_complete");
      assert.equal(end?.network_events_observed, true);
      assert.equal(end?.remote_address, "127.0.0.1");
      assert.equal(end?.remote_port, address.port);
      assert.match(String(end?.connection_id), /^[0-9a-f]{16}$/);
      assert.ok(logs.some(record => record.phase === "connected" && record.connection_id === end?.connection_id));
    }
    assert.doesNotMatch(JSON.stringify(logs), /signature-private|session-private|private-token|password-private|private-sdp|Authorization|Cookie/);
  } finally {
    diagnostics.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("connection failure links only an identical error, redacts raw messages and ignores other targets", async () => {
  const logs: Record<string, unknown>[] = [];
  const origin = "https://gateway.example:10000";
  const diagnostics = createGatewayDiagnostics(origin, record => logs.push(record));
  const params = { hostname: "gateway.example", port: "10000", protocol: "https:" };
  const failure = Object.assign(new Error("private-token (attempted addresses: 203.0.113.7:10000, [2001:db8::1]:10000, 2001:db8::2:10000, timeout: 10000ms), private-password"),
    { code: "UND_ERR_CONNECT_TIMEOUT" });
  try {
    await assert.rejects(diagnostics.run("a".repeat(32), "poll", async () => {
      channel("undici:client:beforeConnect").publish({ connectParams: params });
      channel("undici:client:connectError").publish({ connectParams: params, error: failure });
      channel("undici:client:connectError").publish({ connectParams: { ...params, hostname: "other.example" }, error: failure });
      throw new TypeError("fetch failed private-body", { cause: failure });
    }, () => undefined));
    const connection = logs.find(record => record.phase === "connect_error");
    const end = logs.find(record => record.phase === "end");
    assert.equal(logs.filter(record => record.phase === "connect_error").length, 1);
    assert.equal(end?.trace_id, "a".repeat(32));
    assert.equal(end?.connection_id, connection?.connection_id);
    assert.equal(end?.last_stage, "fetch_start");
    assert.equal(end?.upstream_status, null);
    assert.deepEqual(end?.transport_codes, ["UND_ERR_CONNECT_TIMEOUT"]);
    assert.deepEqual(connection?.attempted_addresses, ["203.0.113.7", "2001:db8::1", "2001:db8::2"]);
    assert.doesNotMatch(JSON.stringify(logs), /private-token|private-password|private-body|other.example/);
    await assert.rejects(diagnostics.run("b".repeat(32), "session", async () => {
      throw Object.assign(new Error("unrelated private-body"), { code: "ECONNRESET" });
    }, () => undefined));
    assert.equal(logs.at(-1)?.connection_id, undefined);
  } finally { diagnostics.dispose(); }
});

test("late callbacks and logging failures cannot change the operation or expose exception payloads", async () => {
  const diagnostics = createGatewayDiagnostics("https://gateway.example", () => { throw new Error("logger unavailable"); });
  try {
    assert.equal(await diagnostics.run("a".repeat(32), "session", async () => 42, () => 200), 42);
    await assert.rejects(diagnostics.run("malformed-secret", "session", async () => 42, () => 200), /Invalid/);
    await assert.rejects(diagnostics.run("a".repeat(32), "private-action", async () => 42, () => 200), /Invalid/);
    const cycle = Object.assign(new Error("password-private"), { code: "ECONNRESET", cause: {} as unknown });
    cycle.cause = cycle;
    assert.deepEqual(transportCodes(cycle), ["ECONNRESET"]);
    assert.deepEqual(transportCodes({ code: "password-private", errors: [{ code: "EAI_AGAIN" }] }), ["EAI_AGAIN"]);
  } finally { diagnostics.dispose(); }
});

test("unrelated and late request events are ignored; a body failure retains HTTP status", async () => {
  const logs: Record<string, unknown>[] = [];
  const diagnostics = createGatewayDiagnostics("https://gateway.example", record => logs.push(record));
  const request = {origin:"https://gateway.example", path:"/v1/session", method:"POST"};
  try {
    await assert.rejects(diagnostics.run("c".repeat(32), "session", async () => {
      channel("undici:request:create").publish({request:{...request, origin:"https://unrelated.example"}});
      channel("undici:request:create").publish({request});
      channel("undici:request:headers").publish({request});
      throw Object.assign(new Error("private-response-body"), {event:"viewer_body_timeout"});
    }, () => 200));
    const end = logs.at(-1);
    assert.equal(end?.upstream_status, 200);
    assert.equal(end?.last_stage, "response_headers");
    assert.equal(end?.failure_event, "viewer_body_timeout");
    const count = logs.length;
    channel("undici:client:sendHeaders").publish({request, socket:{remoteAddress:"203.0.113.5",remotePort:443}});
    channel("undici:request:error").publish({request, error:new Error("late-password")});
    assert.equal(logs.length, count);
    assert.doesNotMatch(JSON.stringify(logs), /private-response-body|late-password|203.0.113.5|unrelated.example/);
  } finally { diagnostics.dispose(); }
});
