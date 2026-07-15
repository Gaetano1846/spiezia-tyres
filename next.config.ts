import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  // ssh2 (via ssh2-sftp-client, importer AdTyres) carica un binding nativo
  // (crypto/build/Release/sshcrypto.node): Turbopack non riesce a bundlarlo
  // in un chunk ESM ("asset is not placeable in ESM chunks"). Va richiesto
  // a runtime da node_modules, non bundlato — stesso motivo per cui pacchetti
  // come sharp/bcrypt vanno esclusi dal bundle server.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.tyre-shopping.com" },
      { protocol: "https", hostname: "**.tyresbay.net" },
      { protocol: "https", hostname: "**.tyres.net" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      // NB: rimosso il wildcard "**" — trasformava /_next/image in un proxy
      // aperto verso qualsiasi host. Le immagini prodotto usano <img> nativo,
      // quindi non sono impattate. Aggiungere qui eventuali nuovi host fidati.
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // Lo scanner magazzino usa la fotocamera: la consentiamo solo a self.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
