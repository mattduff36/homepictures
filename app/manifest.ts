import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MPDEE Vision - Home cameras",
    short_name: "MPDEE Vision",
    start_url: "/watch",
    scope: "/",
    display: "standalone",
    background_color: "#0c0d0f",
    theme_color: "#0c0d0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/viewer-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/viewer-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
