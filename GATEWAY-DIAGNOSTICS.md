# Correlating a gateway interruption

The website logs each existing outbound gateway attempt with `trace_id`, using
the existing signed `X-Viewer-Nonce`. The Dell records that same identifier on
request arrival and completion. An unverified arrival is not proof of valid
authentication: inspect the Dell authentication state and completion status.

No extra camera requests, retries, DNS lookups, dispatcher changes, connection
limits or timeout changes are introduced. Ring policy and all viewing limits
are unchanged. Logging never includes request/response bodies, cookies,
signatures, passwords, usernames, SDP, images, or raw exception text/stacks.

## During a failure

1. Save the Vercel runtime records promptly, with the UTC incident window and
   deployment ID. Find `viewer_gateway_attempt` with `phase=end`, then retain
   its matching `phase=start` record and the exact `trace_id`.
2. Find that trace in `journalctl -u mpdee-web-viewer` on the Dell. Match arrival,
   authentication state and completion; compare UTC times and `elapsed_ms`.
3. On Vercel, follow `connection_id` into `viewer_gateway_connection` records.
   `headers_sent` captures the socket's actual remote gateway address and port.
   Connection errors retain bounded transport codes and attempted IP addresses
   only when the runtime explicitly supplies them. These are not a DNS snapshot.
4. A missing Dell arrival alone does not prove an off-device failure: check
   uncorrelated parse errors and `worker_limit` rejections in the same window.
   Pre-parse saturation cannot safely extract a request identifier. Do not
   enlarge limits or restart services just to clear evidence.

Connections and requests are not one-to-one. A connection event has no trace
identifier until a real socket or identical propagated error links it to a
request. Reused connections may serve several traces. Unknown attribution is
left unknown; timing proximity is not asserted as a causal link.

Connection-start events are deliberately not joined: the runtime does not
guarantee stable parameter-object identity across connection events. Connection
setup duration is therefore `null`, not zero or a guessed match. Request elapsed
times and time to headers remain measured; these include queueing and connection
setup rather than claiming a separate DNS/TCP/TLS duration.

`network_events_observed=false` means the runtime did not expose the Undici
request events (for example a fetch test double); attempt-level records still
exist. `upstream_status=null` means fetch never returned response headers, not
that the Dell necessarily received nothing. A non-null status with an error
outcome can instead indicate HTTP rejection or response-body validation failure.

Retain both sides and the deployment commit before considering a provider
support request. The records narrow the failed stage; provider-side packet or
relay evidence may still be needed to identify the exact network hop.
