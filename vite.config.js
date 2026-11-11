import { defineConfig, loadEnv } from 'vite'
import { ARCHIVE } from './src/config/archive.config.js'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Serves the /api/*.js Vercel functions during `vite dev` so local matches prod.
// In production Vercel runs these files natively; this only affects local dev.
function devApi() {
  return {
    name: 'dev-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '')
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          req.query = Object.fromEntries(url.searchParams.entries())
          res.status = (code) => {
            res.statusCode = code
            return res
          }
          res.json = (obj) => {
            if (!res.getHeader('content-type'))
              res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          await mod.default(req, res)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(e?.message || e) }))
        }
      })
    },
  }
}

// Local stand-in for functions/<year>/[[path]].js: proxy /<year>/* to the archived
// tracker so the archive links work in `vite dev`. Set ARCHIVE_<year>_ORIGIN in
// .env.local to point at a locally served build instead of the deployed one.
function archiveProxy(env) {
  return Object.fromEntries(
    ARCHIVE.map((t) => [
      `/${t.year}/`,
      {
        target: env[`ARCHIVE_${t.year}_ORIGIN`] || t.origin,
        changeOrigin: true,
        rewrite: (p) => p.slice(`/${t.year}`.length) || '/',
      },
    ])
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devApi()],
  server: { proxy: archiveProxy(loadEnv(mode, process.cwd(), 'ARCHIVE_')) },
}))
