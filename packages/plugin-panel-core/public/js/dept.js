/**
 * 部门深链解析（2026-10-22）：控制台「部门面板」登记项以 ?dept=<id> 直达某个部门看板。
 *
 * 抽成纯函数的原因：面板 SPA 是 ES module，jsdom 无法执行 module script，
 * 端到端冒烟覆盖不到这条分支；把决议逻辑独立出来后可由 Node 直接单测
 * （dept.test.mjs），保证「深链优先、越权回落、脏参数忽略」三条口径不漂移。
 */

/**
 * 部门标识合法字符：与 panel-core 服务端 DEPT_RE（/^[a-z]{2,12}$/）同口径。
 * 前端不能放宽——否则 ?dept=RD / ?dept=rd-team 这类值会先通过前端、再被
 * /api/panel/* 以 400「部门标识非法」拒绝，表现为点进面板后空白。
 */
const DEPT_ID_RE = /^[a-z]{2,12}$/

/**
 * 解析请求的部门标识（?dept=）。
 * @param {string} search location.search
 * @returns {string} 合法标识原样返回；缺失或形态不合法返回 ''
 */
export function requestedDept(search) {
  let raw = ''
  try {
    raw = new URLSearchParams(String(search ?? '')).get('dept') ?? ''
  } catch {
    return ''
  }
  return DEPT_ID_RE.test(raw) ? raw : ''
}

/**
 * 决议当前部门：深链（且该部门在可见范围内）优先 → 记忆值 → 首个可见部门 → 记忆值兜底。
 * 越权部门按「不存在」处理：不报错、不跳转，静默回落，避免深链成为探针。
 * @param {{ requested?: string, remembered?: string, allowedDepts: Array<{id: string}> }} input
 */
export function resolveDept({ requested = '', remembered = '', allowedDepts = [] }) {
  const ids = allowedDepts.map((dept) => dept.id)
  if (requested && ids.includes(requested)) return requested
  if (remembered && ids.includes(remembered)) return remembered
  return ids[0] ?? remembered
}