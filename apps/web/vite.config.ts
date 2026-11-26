import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Audit A-037. Production builds get a Content-Security-Policy <meta> tag.
 * The one inline script (the theme switch in index.html) is allowed by its
 * SHA-256, computed from the final HTML, so editing it cannot silently break
 * the policy. Dev builds are left alone, since Vite's dev server injects
 * inline scripts. frame-ancestors cannot be set from a <meta> tag: the host
 * serving the build should send it (or X-Frame-Options: DENY) as a header.
 */
const contentSecurityPolicy = (): Plugin => ({
  name: "re-hydra-csp",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1] ?? "").digest("base64")}'`
      )
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(" ")}`.trim(),
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join("; ")
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    }
  }
})

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  }
})
