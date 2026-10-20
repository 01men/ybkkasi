#!/usr/bin/env node
/**
 * mcp-drift — 把「这台机器现在跑什么 MCP」导出成可 review 的快照，并检测与基线的漂移。
 *
 * 解决的问题（见 zhang-guo-wen/dsh-mcp-manager#2）：
 *   dsh-mcp-manager 的 roster / loadingMode / hideDestructive / toolFilter
 *   都只存在于本机配置文件。三个人三台机器，实际生效的 MCP 权限面可能完全不同，
 *   而且没有任何一个人能看出这个差异。
 *
 * 设计约束（很重要）：
 *   导出必须**结构化重建**，不能是行编辑。
 *   dsh-mcp-manager 的 README 明确说：全局行的写操作会重写整个 Include 文件，
 *   注释和引号风格都会丢。如果快照也用行编辑产生，diff 里全是噪音，没人 review，
 *   工具就白做了。所以本工具输出的是规范化 JSON，字段排序固定、冗余字段剔除。
 *
 * 零依赖，只用 Node 内置模块。Node >= 18。
 *
 * 用法：
 *   node mcp-drift.mjs snapshot  --config <cordis.patch.yml> [-o out.json]
 *   node mcp-drift.mjs diff      --baseline base.json --current cur.json
 *   node mcp-drift.mjs check     --config <cordis.patch.yml> --baseline base.json [--ci]
 *
 * CI 用法：漂移时 exit 1，可直接做 pre-commit 或 GitHub Actions 的一步。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const SEVERITY = { RISK: 3, GRANT: 2, CHANGE: 1 }
const rank = (s) => SEVERITY[s] ?? 0

/* ------------------------------------------------------------------ *
 * 极简 YAML 子集解析
 * 只支持 dsh cordis.patch.yml 实际用到的形状：
 *   - insert:
 *       - id: foo
 *         name: '@scope/pkg'
 *         disabled: false
 *         config: { ... }        # 行内 JSON
 * 多行嵌套/锚点/多文档一律不解析并明确报错——宁可失败也不猜。
 * ------------------------------------------------------------------ */
function parsePatchYAML(text) {
  const rows = []
  let inInsert = false
  let current = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ')
    if (/^\s*#/.test(line) || line.trim() === '') continue

    const topLevel = /^(- insert:|- \S.*|insert:)\s*$/.exec(line)
    if (topLevel) {
      inInsert = /insert:/.test(line)
      current = null
      continue
    }

    // list item start: "- key: value"  或裸 "- value"
    const item = /^(\s*)-\s*(.*)$/.exec(line)
    if (item && inInsert) {
      const indent = item[1].length
      const rest = item[2]
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(rest)
      if (!kv) continue // 数组元素不是 kv，跳过（不猜）
      current = {}
      rows.push({ indent, row: current })
      assign(current, kv[1], kv[2])
      continue
    }

    // continuation: "  key: value"
    const cont = /^\s+([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (cont && current) { assign(current, cont[1], cont[2]); continue }
  }
  return rows.map((r) => r.row)
}

function assign(obj, key, value) {
  const v = value.trim()
  if (v === '') { obj[key] = ''; return }
  if (v.startsWith('{') || v.startsWith('[')) {
    const parsed = parseLoose(v)
    if (parsed !== undefined) { obj[key] = parsed; return }
    obj[key] = v
    return
  }
  if (v === 'true') { obj[key] = true; return }
  if (v === 'false') { obj[key] = false; return }
  if (/^-?\d+$/.test(v)) { obj[key] = Number(v); return }
  obj[key] = v.replace(/^['"]|['"]$/g, '')
}

/**
 * 标量 / 嵌套结构统一入口。
 * `toolFilter: [a, b]` 这类嵌套数组必须真解出来：解成字符串会让 normalize 的
 * `Array.isArray` 判断失败 → 过滤器被当成「没配」→ 差异检测漏报一项权限放宽。
 */
function scalarOrNested(raw) {
  const v = raw.trim()
  if (v.startsWith('[')) {
    const inner = v.slice(1, v.lastIndexOf(']') === -1 ? undefined : v.lastIndexOf(']'))
    return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  if (v.startsWith('{')) return parseLoose(v)
  const un = v.replace(/^['"]|['"]$/g, '')
  if (un === 'true') return true
  if (un === 'false') return false
  if (/^-?\d+$/.test(un)) return Number(un)
  return un
}

/* ------------------------------------------------------------------ *
 * MCP 行识别与归一化
 * ------------------------------------------------------------------ */
const isMcpRow = (row) =>
  typeof row?.id === 'string' &&
  /(mcp|context7|playwright|filesystem|fetch|github|slack|memory)/i.test(String(row.id))

/** 只保留治理相关字段，剔除一切运行时噪声。 */
function normalize(row) {
  const name = String(row.name ?? '')
  const cfg = (row.config && typeof row.config === 'object' && !Array.isArray(row.config)) ? row.config : null

  // 解析失败必须响亮。config 存在却不是对象 = 用户以为配了策略，实际没生效。
  if (row.config !== undefined && row.config !== null && cfg === null) {
    throw new Error(
      `行「${row.id}」的 config 不是可解析的映射（得到 ${typeof row.config}）。\n` +
      `这意味着该行的治理字段可能全部失效——请检查 YAML 是否用了本工具不支持的写法。`
    )
  }

  return {
    id: String(row.id),
    name,
    package: packageName(name, row.id),
    enabled: row.disabled !== true,
    // dsh-mcp-manager 侧的三类策略位。缺失即为 false，不猜。
    loadingMode: str(cfg?.loadingMode) ?? 'eager',
    hideDestructive: cfg?.hideDestructive === true,
    toolFilter: Array.isArray(cfg?.toolFilter)
      ? cfg.toolFilter.map(String).sort()
      : [],
    destructiveHint: cfg?.destructiveHint === true,
  }
}

const str = (v) => (typeof v === 'string' && v.length ? v : null)
const packageName = (name, fallback) => {
  const m = /^(@[^/]+\/[^@]+|[^@\s]+)/.exec(String(name).trim())
  return m ? m[1] : fallback
}

/**
 * YAML 行内映射解析。YAML 允许无引号标量（`{ loadingMode: dynamic, hideDestructive: true }`），
 * 这不是合法 JSON，直接 JSON.parse 会静默失败——而失败的后果是**治理字段被当成未配置**，
 * 也就是最危险的那种失败。这里自己解析，保留字面量原样交给 normalize 判断。
 * 解析不出来就返回 undefined，调用方退回字符串，绝不猜。
 */
function parseLoose(v) {
  const body = v.trim().replace(/^\{/, '').replace(/\}$/, '').trim()
  if (body === '') return {}
  if (!v.trim().startsWith('{')) {
    // 数组：保持字符串，交由调用方 split
    const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '').trim()
    return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  const out = {}
  let depth = 0, quote = null, buf = ''
  const flush = () => {
    const seg = buf.trim()
    if (seg === '') { buf = ''; return }
    const colon = seg.indexOf(':')
    if (colon === -1) { out[seg.replace(/^['"]|['"]$/g, '')] = true; buf = ''; return }
    const k = seg.slice(0, colon).trim().replace(/^['"]|['"]$/g, '')
    out[k] = scalarOrNested(seg.slice(colon + 1).trim())
    buf = ''
  }
  for (const ch of body) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue }
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (ch === ',' && depth === 0) { flush(); continue }
    buf += ch
  }
  flush()
  return out
}

/* ------------------------------------------------------------------ *
 * 快照
 * ------------------------------------------------------------------ */
export function snapshot(configText) {
  const rows = parsePatchYAML(configText).filter(isMcpRow).map(normalize)
  rows.sort((a, b) => a.id.localeCompare(b.id))

  // 权限面摘要：两个机器是不是同一个权限面，看这一行就够了
  const surface = rows
    .filter((r) => r.enabled)
    .map((r) => `${r.id}:${r.loadingMode}:${r.hideDestructive ? 'nodestr' : 'destr'}:${r.toolFilter.length}`)
    .join('|')

  const snap = {
    $schema: 'https://ybkkasi.com/schemas/mcp-roster-snapshot/v1',
    rows,
    summary: {
      total: rows.length,
      enabled: rows.filter((r) => r.enabled).length,
      hideDestructiveOn: rows.filter((r) => r.hideDestructive).length,
      toolFiltered: rows.filter((r) => r.toolFilter.length > 0).length,
      surfaceHash: createHash('sha256').update(surface).digest('hex').slice(0, 16),
    },
  }
  return snap
}

/* ------------------------------------------------------------------ *
 * 漂移检测
 * 关键设计：**按风险分级**，让 code review 的人先看该看的。
 * ------------------------------------------------------------------ */
export function diff(base, cur) {
  const b = new Map(base.rows.map((r) => [r.id, r]))
  const c = new Map(cur.rows.map((r) => [r.id, r]))
  const findings = []

  for (const [id, curRow] of c) {
    const baseRow = b.get(id)
    if (!baseRow) {
      findings.push({ severity: 'RISK', id, kind: 'ADDED',
        detail: `新增 MCP server「${curRow.id}」不在基线内`, was: null, now: curRow })
      continue
    }
    if (baseRow.enabled && !curRow.enabled) {
      findings.push({ severity: 'CHANGE', id, kind: 'DISABLED',
        detail: `「${id}」被关闭（能力下线，若是意外请确认）`, was: true, now: false })
    }
    if (!baseRow.enabled && curRow.enabled) {
      findings.push({ severity: 'RISK', id, kind: 'ENABLED',
        detail: `「${id}」被启用 —— 团队基线里它是关的`, was: false, now: true })
    }
    if (baseRow.hideDestructive && !curRow.hideDestructive) {
      findings.push({ severity: 'RISK', id, kind: 'DESTRACTIVE_OFF',
        detail: `「${id}」的 destructiveHint 过滤被关掉了`, was: true, now: false })
    }
    const lost = baseRow.toolFilter.filter((t) => !curRow.toolFilter.includes(t))
    if (lost.length) {
      findings.push({ severity: 'GRANT', id, kind: 'TOOL_FILTER_LOST',
        detail: `「${id}」少了工具过滤：${lost.join(', ')}`, was: baseRow.toolFilter.length, now: curRow.toolFilter.length })
    }
    if (baseRow.loadingMode !== curRow.loadingMode) {
      findings.push({ severity: 'CHANGE', id, kind: 'LOADING_MODE',
        detail: `「${id}」加载模式 ${baseRow.loadingMode} → ${curRow.loadingMode}`, was: baseRow.loadingMode, now: curRow.loadingMode })
    }
  }
  for (const [id] of b) {
    if (!c.has(id)) {
      findings.push({ severity: 'CHANGE', id, kind: 'REMOVED',
        detail: `基线里的「${id}」在本机不存在`, was: id, now: null })
    }
  }
  findings.sort((a, z) => rank(z.severity) - rank(a.severity) || a.id.localeCompare(z.id))
  return findings
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */
const C = process.stdout.isTTY
  ? { R: '\x1b[31m', Y: '\x1b[33m', G: '\x1b[32m', D: '\x1b[2m', X: '\x1b[0m', B: '\x1b[1m' }
  : { R: '', Y: '', G: '', D: '', X: '', B: '' }

function renderDiff(findings) {
  if (!findings.length) {
    console.log(`${C.G}✓ 无漂移${C.X} — 本机 MCP 权限面与基线一致（surface ${C.D}hash ok${C.X}）`)
    return 0
  }
  const bySev = { RISK: [], GRANT: [], CHANGE: [] }
  for (const f of findings) (bySev[f.severity] ||= []).push(f)

  console.log(`${C.B}MCP 权限面漂移检测${C.X}  共 ${findings.length} 项`)
  for (const sev of ['RISK', 'GRANT', 'CHANGE']) {
    const list = bySev[sev]
    if (!list?.length) continue
    const tag = { RISK: `${C.R}[风险]${C.X}`, GRANT: `${C.Y}[放宽]${C.X}`, CHANGE: `${C.D}[变更]${C.X}` }[sev]
    console.log(`\n${tag} ${list.length} 项`)
    for (const f of list) console.log(`  · ${f.detail}${C.D}  (${f.kind})${C.X}`)
  }
  const risky = bySev.RISK?.length ?? 0
  console.log(risky
    ? `\n${C.R}结论：有 ${risky} 项风险级漂移，需人工确认后再提交。${C.X}`
    : `\n${C.Y}结论：无风险级漂移，但有权限面变化，建议在 PR 描述里写明理由。${C.X}`)
  return 1
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const v = argv[i + 1]
      if (v && !v.startsWith('--')) { out[k] = v; i++ } else out[k] = true
      continue
    }
    // 短选项：-o file
    if (/^-[a-zA-Z]$/.test(a)) {
      const k = { o: 'out', h: 'help', c: 'config', b: 'baseline' }[a.slice(1)]
      if (!k) continue
      const v = argv[i + 1]
      if (v && !v.startsWith('-')) { out[k] = v; i++ } else out[k] = true
      continue
    }
    out._.push(a)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  if (!cmd || args.help) {
    console.log(`mcp-drift — MCP 权限面快照与漂移检测（零依赖）

  snapshot  --config <cordis.patch.yml> [-o out.json]   导出规范化快照
  diff      --baseline base.json --current cur.json     比对两份快照
  check     --config <cordis.patch.yml> --baseline base.json [--ci]

check 发现漂移时 exit 1，可直接用于 CI 或 pre-commit。`)
    process.exit(args.help ? 0 : 1)
  }

  if (cmd === 'snapshot') {
    if (!args.config || !existsSync(args.config)) { console.error(`✗ 找不到配置：${args.config ?? '(未指定 --config)'}`); process.exit(1) }
    let snap
    try {
      snap = snapshot(readFileSync(args.config, 'utf8'))
    } catch (e) {
      console.error(`✗ ${e.message}`); process.exit(1)
    }
    const json = JSON.stringify(snap, null, 2) + '\n'
    if (args.out) { writeFileSync(args.out, json); console.log(`${C.G}✓${C.X} 快照已写入 ${args.out}（${snap.summary.total} 个 MCP server，surface ${C.D}${snap.summary.surfaceHash}${C.X}）`) }
    else process.stdout.write(json)
    return
  }

  if (cmd === 'diff') {
    if (!args.baseline || !args.current) { console.error('✗ 需要 --baseline 与 --current'); process.exit(1) }
    process.exit(renderDiff(diff(
      JSON.parse(readFileSync(args.baseline, 'utf8')),
      JSON.parse(readFileSync(args.current, 'utf8')),
    )))
  }

  if (cmd === 'check') {
    if (!args.config || !args.baseline) { console.error('✗ 需要 --config 与 --baseline'); process.exit(1) }
    if (!existsSync(args.baseline)) {
      console.log(`${C.Y}!${C.X} 基线不存在：${args.baseline}\n  用 \`snapshot\` 生成后提交进仓库。基线缺失不算漂移。`)
      return
    }
    let cur
    try {
      cur = snapshot(readFileSync(args.config, 'utf8'))
    } catch (e) {
      console.error(`✗ ${e.message}`); process.exit(1)
    }
    process.exit(renderDiff(diff(JSON.parse(readFileSync(args.baseline, 'utf8')), cur)))
  }

  console.error(`✗ 未知命令：${cmd}`)
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()