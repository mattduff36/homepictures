import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || request.path.startsWith("/api/diagnostics")) return;
  try {
    const [{reportServerIncident}, {incidentPage}] = await Promise.all([
      import("./lib/diagnostics-server"), import("./lib/diagnostics"),
    ]);
    reportServerIncident({code: "server_exception", page: incidentPage(request.path), operation: "render", error});
  } catch { /* Reporting cannot replace the original framework error. */ }
};
