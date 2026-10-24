// Private test gateway: /api can only reach the API process created below,
// never Vite's normal /api proxy or the user's running demo services.
import { createServer, request } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const apiDir = path.join(root, 'artifacts/api-server')
const requireApi = createRequire(path.join(apiDir, 'package.json'))
const requireWeb = createRequire(path.join(root, 'artifacts/veracity/package.json'))
const temp = await mkdtemp(path.join(tmpdir(), 'veracity-e2e-'))
const token = randomUUID()
const buildFile = path.join(apiDir, 'generated-artifacts', `${token}.mjs`)
let api, vite, gateway
let stopping = false

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  gateway?.closeAllConnections()
  gateway?.close()
  await vite?.close()
  if (api && api.exitCode === null && api.signalCode === null) {
    const exited = new Promise(resolve => api.once('exit', resolve))
    api.kill('SIGTERM')
    const timer = setTimeout(() => api.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(timer)
  }
  // Only directories/files created by this run are removed.
  await rm(temp, { recursive: true, force: true })
  await rm(buildFile, { force: true })
  process.exit(code)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
process.on('disconnect', () => void stop())

try {
  await writeFile(path.join(temp, 'isolation-token'), token, { mode: 0o600 })
  await mkdir(path.dirname(buildFile), { recursive: true })
  const { build } = requireApi('esbuild')
  const dependencies = Object.keys(requireApi('./package.json').dependencies)
  await build({
    entryPoints: [path.join(apiDir, 'src/index.ts')],
    outfile: buildFile, bundle: true, platform: 'node', format: 'esm',
    external: dependencies.filter(name => !name.startsWith('@workspace/')),
    logLevel: 'warning',
  })
  // Reserve then release a kernel-selected API port; binding failure is fatal, never reused.
  const reservation = createNetServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const apiPort = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  gateway = createServer((req, res) => {
    // Catch even malformed/encoded API paths so they cannot reach Vite's demo proxy.
    if (req.url?.startsWith('/api')) {
      // A gateway-owned upstream; never forward to a configured external URL.
      const upstream = request({
        hostname: '127.0.0.1', port: apiPort, method: req.method,
        path: req.url, headers: req.headers,
      }, response => {
        res.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(res)
      })
      upstream.on('error', () => { res.writeHead(502); res.end('Isolated API unavailable') })
      req.pipe(upstream)
    } else if (vite) vite.middlewares(req, res)
    else { res.writeHead(503); res.end() }
  })
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${gateway.address().port}`
  api = spawn(process.execPath, [buildFile], {
    cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(apiPort), LOG_LEVEL: 'warn',
      VERACITY_LOCAL_DEV: '1', VERACITY_E2E: '1', VERACITY_E2E_ROOT: temp,
      VERACITY_E2E_TOKEN: token, VERACITY_DB: path.join(temp, 'test.sqlite3'),
      VERACITY_STORAGE: 'local', VERACITY_LOCAL_UPLOAD_DIR: path.join(temp, 'evidence'),
      APP_ORIGIN: url,
    },
  })
  api.once('error', error => { console.error(error); void stop(1) })
  api.once('exit', () => { if (!stopping) void stop(1) })
  let ready = false
  for (let i = 0; i < 150 && !stopping; i++) {
    try {
      const result = await fetch(`${url}/api/__test/isolation`, { signal: AbortSignal.timeout(500) })
      if (result.ok && (await result.json()).token === token) { ready = true; break }
    } catch { /* wait for the dedicated API only */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Isolated API failed to start')
  // import() needs a file:// URL; a bare Windows path (C:\...) is rejected.
  const { createServer: createViteServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href)
  // Load the existing frontend config, but no public port and no normal API proxy.
  process.env.BASE_PATH = '/'
  process.env.NODE_ENV = 'development'
  process.env.VERACITY_LOCAL_DEV = '1'
  vite = await createViteServer({
    configFile: path.join(root, 'artifacts/veracity/vite.config.ts'),
    server: { middlewareMode: true, hmr: false, proxy: {} },
  })
  process.send({ url, token })
} catch (error) {
  console.error(error)
  await stop(1)
}
