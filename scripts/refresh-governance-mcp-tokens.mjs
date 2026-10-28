#!/usr/bin/env node
/**
 * refresh-governance-mcp-tokens.mjs —— 治理双身份 MCP 令牌自愈刷新（DSH 侧）。
 *
 * 背景：平台机器令牌（client-credentials 换牌）有效期 2 小时（authn.verify 固定 TTL），
 * 客户端侧存的是静态 Bearer，过期即调用失败。DSH 不会自行续期，故需主动刷新。
 *
 * 本脚本做三件事（幂等、可反复跑）：
 *   ① 读 ~/.ybkkasi/../ybkkasi/data/governance-credentials.json 取 clientId/clientSecret（不轮换 secret）
 *   ② 经 POST /api/auth/client-credentials 为 operator / reviewer 各换一把新令牌
 *   ③ 经 DSH 连接器 HTTP API（POST http://127.0.0.1:7777/mcp-connector/api，method=configure）
 *      把新令牌写回 DSH 连接并重建 MCP 客户端（DSH 侧重建后即刻生效，无需重启宿主）
 *
 * 不打印任何 secret/令牌原文，只报到期时刻。
 *
 * 用法：
 *   node scripts/refresh-governance-mcp-tokens.mjs [--data-dir <dir>] [--dsh-url http://127.0.0.1:7777]
 *       [--skip-if-fresh] [--fresh-window-min 30] [--force]
 *
 *   --skip-if-fresh   仅当 DSH 里存的令牌剩余寿命 < fresh-window-min 时才换牌+重建（定时器用，避免无谓重建连接）
 *   --force           无条件刷新（忽略新鲜度判断）
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : fallback
}
const PLATFORM_URL = (arg('--platform-url', process.env.YBKK_GOV_PLATFORM ?? 'https://ybkkasi.com')).replace(/\/+$/, '')
const DSH_URL = (arg('--dsh-url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:7777')).replace(/\/+$/, '')
const DATA_DIR = resolve(arg('--data-dir', join(homedir(), 'ybkkasi', 'data')))
const CRED_FILE = join(DATA_DIR, 'governance-credentials.json')
const DSH_STORE = resolve(arg('--dsh-store', join(homedir(), '.dsh', 'storages', 'mcp_connector.json')))
const SKIP_IF_FRESH = argv.includes('--skip-if-fresh')
const FORCE = argv.includes('--force')
const FRESH_WINDOW_MIN = Number(arg('--fresh-window-min', '30'))

const log = (msg) => console.log(`[gov-refresh] ${msg}`)
const fail = (msg) => { console.error(`[gov-refresh] ✘ ${msg}`); process.exit(1) }

if (!existsSync(CRED_FILE)) fail(`凭证文件不存在：${CRED_FILE}（先跑 scripts/register-governance-credentials.mjs）`)
const cred = JSON.parse(readFileSync(CRED_FILE, 'utf8'))

/** 换牌取机器令牌（client-credentials）。 */
const exchange = async (entry, label) => {
  const response = await fetch(`${PLATFORM_URL}/api/auth/client-credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: entry.clientId, clientSecret: entry.clientSecret }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false) fail(`${label} 换牌失败：${payload?.error?.message ?? response.status}`)
  return payload.data
}

/** 通过 DSH 连接器 API 更新连接并重建客户端。 */
const configure = async (params, label) => {
  const response = await fetch(`${DSH_URL}/mcp-connector/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'configure', params }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false) fail(`${label} 配置失败：${payload?.message ?? response.status}`)
  return payload
}

const targets = [
  { key: 'operator', serverName: 'ybkk-governance', label: 'ybkk-governance（执行官）', dshKey: 'custom-ybkk-governance' },
  { key: 'reviewer', serverName: 'ybkk-governance-review', label: 'ybkk-governance-review（评审官）', dshKey: 'custom-ybkk-governance-review' },
]

/** 读 DSH 连接存储里已配置的令牌，算剩余寿命（分钟）。读不到返回 null（按「不新鲜」处理）。 */
const storedTokenTtlMin = (dshKey) => {
  try {
    if (!existsSync(DSH_STORE)) return null
    const store = JSON.parse(readFileSync(DSH_STORE, 'utf8'))
    const token = store?.tables?.connections?.[dshKey]?.auth?.bearerToken
    if (!token) return null
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString('utf8'))
    if (!payload?.exp) return null
    return (payload.exp * 1000 - Date.now()) / 60000
  } catch {
    return null
  }
}

let refreshed = 0
let skipped = 0
for (const target of targets) {
  const entry = cred[target.key]
  if (!entry?.clientId) fail(`凭证文件缺少 ${target.key} 条目`)

  if (SKIP_IF_FRESH && !FORCE) {
    const ttl = storedTokenTtlMin(target.dshKey)
    if (ttl !== null && ttl > FRESH_WINDOW_MIN) {
      log(`${target.label}：令牌仍新鲜（剩余约 ${Math.round(ttl)} 分钟 > ${FRESH_WINDOW_MIN} 分钟），跳过重建`)
      skipped += 1
      continue
    }
  }

  const issued = await exchange(entry, target.label)
  await configure({
    name: target.serverName,
    serverName: target.serverName,
    transport: 'streamable-http',
    url: `${PLATFORM_URL}/mcp`,
    authMode: 'bearer',
    bearerToken: issued.token,
    scope: 'global',
  }, target.label)
  log(`${target.label}：已刷新并重建（到期 ${issued.expiresAt}）`)
  refreshed += 1
}

log(`完成：刷新 ${refreshed} 条、跳过 ${skipped} 条（secret 未轮换，无需重新登记）`)
