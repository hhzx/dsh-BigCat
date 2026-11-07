/**
 * dsh-BigCat — server half.
 *
 *   GET  /api/bigcat/pin
 *   POST /api/bigcat/pin     { "on": true|false }
 *   POST /api/bigcat/locate  { "sessionId", "text", "nth" }
 *
 * @module dsh-BigCat
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const pinScript = path.join(here, 'pin.ps1')
const locateScript = path.join(here, 'locate.py')

function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
}

function statePath() {
  return path.join(dshHome(), 'dsh-bigcat.json')
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return { pinned: parsed?.pinned === true }
  } catch {
    return { pinned: false }
  }
}

function writeState(pinned) {
  fs.mkdirSync(dshHome(), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify({ pinned: pinned === true }) + '\n')
}

function isLoopback(req) {
  const host = String(req.headers.host ?? '').trim().toLowerCase()
  if (host === 'localhost' || host.startsWith('localhost:')) return true
  const bare = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const octets = bare.split('.')
  return octets.length === 4 && octets[0] === '127'
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function lastLine(stdout) {
  const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout)
  return text.replace(/\u0000/g, '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
}

function executePin(action) {
  return execFileAsync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pinScript, '-Action', action,
  ], { windowsHide: true, timeout: 15000, encoding: 'buffer' }).then((result) => {
    const packed = result && typeof result === 'object' && !Buffer.isBuffer(result) ? result : { stdout: result }
    const line = lastLine(packed.stdout ?? packed.stderr ?? '')
    if (line === 'missing') {
      const error = new Error('找不到 DSH Desktop 窗口')
      error.status = 404
      throw error
    }
    return line === 'on'
  })
}

let pinChain = Promise.resolve()

function pinWindow(action) {
  const run = pinChain.then(() => executePin(action))
  pinChain = run.then(() => {}, () => {})
  return run
}

async function locateMessage(body) {
  const sessionId = String(body.sessionId ?? '')
  const text = String(body.text ?? '')
  const nth = Number.isInteger(body.nth) ? body.nth : 0
  if (!/^session-[0-9a-f-]{8,}$/i.test(sessionId)) {
    const error = new Error('会话 id 不正确')
    error.status = 400
    throw error
  }
  if (!text.trim()) {
    const error = new Error('消息是空的')
    error.status = 400
    throw error
  }
  const { stdout } = await execFileAsync('python', [locateScript, sessionId, text, String(nth)], {
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, DSH_HOME: dshHome(), PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(String(stdout).trim().split(/\r?\n/).pop())
}

export const name = 'dsh-bigcat'
export const inject = ['webServer']

export function apply(ctx) {
  const server = ctx.webServer
  const desired = readState()
  pinWindow(desired.pinned ? 'on' : 'off').catch(() => {})

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/bigcat/pin',
    handler: async (req, res) => {
      if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'foreign-caller' }); return }
      try {
        if (req.method === 'GET') {
          const on = await pinWindow('get')
          json(res, 200, { ok: true, on })
          return
        }
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return }
        const body = await readBody(req)
        const on = await pinWindow(body.on === true ? 'on' : 'off')
        writeState(on)
        json(res, 200, { ok: true, on })
      } catch (error) {
        json(res, error.status || 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'bigcat: pin route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/bigcat/locate',
    handler: async (req, res) => {
      if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'foreign-caller' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return }
      try {
        json(res, 200, await locateMessage(await readBody(req)))
      } catch (error) {
        json(res, error.status || 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'bigcat: locate route')
}
