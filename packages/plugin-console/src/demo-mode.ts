/**
 * 免登录演示模式（DEMO_MODE=1，公开发布用，2026-10-17）。
 *
 * 定位：官网 / Product Hunt / 冷启动期的「免登陆只读体验」入口。
 * 让访客不注册、不输口令就能看见真实控制台与面板，消除 GitHub 0 star 期的信任死循环。
 *
 * 安全设计（关键——这不是后门）：
 *   1. **不新增任何鉴权面**。本模块只在既有 console 鉴权中间件内部，
 *      于「无 Bearer 头」这一唯一分支注入一个固定 principal；带 Bearer 头的请求
 *      路径完全不变（真登录用户在演示实例上的权限语义不变）。
 *   2. **权限集是白名单枚举**（26 个 `.read` 权限点），不含 `*`。
 *      因此后续每个 guarded 路由的 requirePermission 照常生效——
 *      任何 `.write` / `.approve` / `.invoke` 路由自然 403，无需另写拦截。
 *   3. **写方法在入口直接 fail-closed**：非 GET/HEAD 请求一律 405，
 *      杜绝「路由未声明权限点」这类遗漏面（纵深防御第二道）。
 *   4. **fail-closed 优先**：DEMO_MODE 值不严格等于 '1' 时不启用（默认关闭）。
 *   5. **默认关闭**：未设 DEMO_MODE 环境变量的任何部署行为与本改动前完全一致。
 *
 * 明确不做的事：不放开写权限、不暴露 data/ 目录、不生成新令牌。
 * 演示实例的数据必须由 DEMO_SEED=1 注入的演示种子提供（见 seed.ts）。
 */

/** 演示只读身份标识（固定值，便于审计日志与前端识别）。 */
export const DEMO_PRINCIPAL_ID = 'demo-visitor'
export const DEMO_PRINCIPAL_NAME = '演示访客'

/**
 * 演示只读权限白名单：与 PermissionCatalog 中 `.read` 权限点一一对应。
 *
 * 维护约束（改动须过评审）：
 *   - 只能增补 `.read` 结尾的点；任何 `.write` / `.approve` / `.invoke` / `.admin`
 *     进入本表即视为安全缺陷（demo 会静默获得写能力）。
 *   - 新增业务域权限点时若为只读，需同步补进本表，否则演示态该页 403。
 *   - selftest 有断言锁定「本表不含任何写类权限点」，改动即红。
 */
export const DEMO_READONLY_PERMISSIONS: readonly string[] = [
  // 资产台账与拓扑
  'agent.read',
  'app.read',
  'mcp.service.read',
  'skill.read',
  'nas.read',
  'nas.authz.read',
  'panel.read',
  // 计量与成本
  'usage.read',
  'modelgw.read',
  // 审计与流程
  'audit.read',
  'approval.read',
  'flow.read',
  'exec.read',
  'workforce.read',
  'scenegraph.read',
  // 身份与组织（只读面，用于演示组织树与角色可见性）
  'iam.org.read',
  'iam.roster.read',
  'iam.user.read',
  'authn.principal.read',
  'authn.oidc.read',
  // 连接器与市场
  'connector.catalog.read',
  'connector.connection.read',
  'connector.runs.read',
  'market.read',
  // A2A/UHP 协作面（协作方案 §14.7：新端点只读面重跑演示路由审计后有意增补——
  // a2a.directory.read 覆盖目录/任务治理视图/履约/巡检报告等纯读路由；uhp.read 覆盖
  // harness 注册表与执行记录读面。写/验收/执行类（a2a.admin、a2a.task.accept、uhp.admin、
  // uhp.invoke、agent.a2a.invoke）全部不进本表，写方法另有 405 闸门双保险）
  'a2a.directory.read',
  'uhp.read',
  // 平台运维（只读面：版本、更新检查、健康）
  'platform.update.read',
  // 控制台只读基线（2026-10-17）：工作台聚合/通知/平台信息/工具目录/最近调用五个纯读路由的
  // 声明点，被 console.login 蕴含（真实用户零感知，见 platform-core rest-gate.ts IMPLIED_POINTS）。
  // 访客持本点可读工作台，但不持 console.login 本身——登录级语义（写类 console.login 路由：
  // 反馈回传/自助入场票据/工具执行）依然不可达，且被写方法 405 闸门双保险拦截。
  'console.read',
]

/** 只读方法（演示态允许）。其余一律 405。 */
export const READONLY_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/**
 * 演示态是否启用。严格取值 '1'——避免 DEMO_MODE=true/yes/on 之类的歧义写法
 * 在生产环境被误当作启用（宁可漏启用，不可误启用）。
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['DEMO_MODE'] === '1'
}

/** 演示态主体（每次请求新建对象，避免调用方持有可变共享实例）。 */
export function demoPrincipal(): {
  kind: 'human'
  principalId: string
  userId: string
  name: string
  permissions: readonly string[]
  actChain: Array<{ name: string; type: string }>
} {
  return {
    kind: 'human',
    principalId: DEMO_PRINCIPAL_ID,
    userId: DEMO_PRINCIPAL_ID,
    name: DEMO_PRINCIPAL_NAME,
    permissions: DEMO_READONLY_PERMISSIONS,
    actChain: [],
  }
}

/** 自检用：权限表是否混入了写/审批/调用类权限点（供 selftest 与启动探针断言）。 */
export function findWritePermissionLeaks(permissions: readonly string[] = DEMO_READONLY_PERMISSIONS): string[] {
  return permissions.filter((point) => !point.endsWith('.read') && !point.endsWith('.read-v1'))
}
/**
 * 演示态权限收敛（P0-04，2026-11-17）：把任意主体的权限集夹紧到只读白名单。
 *
 * 背景：index.ts 的演示只读闸门只作用于 `/api/` 前缀（`!exchange.path.startsWith('/api/')` 直接
 * return），而平台自带的 MCP Server 端点在 `/mcp`——不在该前缀内，于是 `/mcp` 的 `tools/call`
 * 完全绕过了 405 与权限交集两道闸。实测：demo 实例上用仓库里公开的种子口令登录拿会话令牌，
 * 经 `/mcp` 调 `iam_org_create` 成功写入组织（同一操作走 REST 被正确拒为 DEMO_READONLY）。
 *
 * 收敛口径与 index.ts 的 Bearer 分支逐字一致：`'*'` 先展开为白名单全集（通配不参与交集），
 * 其余按白名单过滤。两个入口共用本函数，避免再次出现「一处加固、另一处漏网」。
 */
export function demoReadonlyPermissions(permissions: readonly string[]): string[] {
  const allow = new Set([...DEMO_READONLY_PERMISSIONS, 'console.login'])
  const expanded = permissions.includes('*') ? [...allow] : permissions
  return expanded.filter((point) => allow.has(point))
}
