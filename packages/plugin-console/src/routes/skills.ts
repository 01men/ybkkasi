/**
 * Skill 市场域路由（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出——Skill 市场列表/详情/提交/两级审批/发布/编辑/
 * 资源包重传/弃用/删除/安装卸载/评分下载，以及 Skill 包存储配置（local/NAS 后端）。
 * 处理器逐字搬运（行为与迁出前一致）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConsoleRouteDeps } from './deps.ts'

export function registerSkillRoutes(ctx: Context, deps: ConsoleRouteDeps): void {
  const { guarded, body, changeLog, caller } = deps
  // -- Skill 市场 ---------------------------------------------------------
  guarded('GET', '/api/skills', 'skill.read', (exchange) => {
    if (exchange.query.get('mine') === '1') {
      const info = caller(exchange)
      return { skills: ctx.skillHub.skills().find((skill) => skill.authorId === (info.userId ?? info.principalId)) }
    }
    if (exchange.query.get('pending') === '1') {
      return { skills: ctx.skillHub.skills().find((skill) => ['pending_approval', 'scanning', 'rejected'].includes(skill.status)) }
    }
    // 市场列表含在途项（待审批/扫描中，排最前带状态徽标）：审批人无需切页即可看到待办
    const skills = ctx.skillHub.search({
      q: exchange.query.get('q') ?? undefined,
      category: exchange.query.get('category') ?? undefined,
      tag: exchange.query.get('tag') ?? undefined,
      sort: (exchange.query.get('sort') ?? 'downloads') as 'downloads' | 'rating' | 'updated',
      includePending: true,
    })
    return { skills, categories: ctx.skillHub.categories() }
  })

  guarded('GET', '/api/skills/:id', 'skill.read', (exchange) => {
    return ctx.skillHub.detail(exchange.params['id']!)
  })

  guarded('POST', '/api/skills', 'skill.submit', (exchange) => {
    const input = body<{ name: string; category?: string; tags?: string[]; summary?: string; description?: string; content: string; version?: string; changelog?: string; visibility?: 'all' | 'orgs' | 'groups'; applicableModels?: string[]; deps?: string[]; packageBase64?: string }>(exchange)
    const info = caller(exchange)
    const user = info.userId ? ctx.iam.users().get(info.userId) : undefined
    const skill = ctx.skillHub.submit({
      ...input,
      authorId: info.userId ?? info.principalId,
      authorName: info.name,
      orgId: user?.orgId ?? 'org_unknown',
    })
    return { id: skill.id, status: skill.status, findings: skill.versions.at(-1)?.findings ?? [], hasPackage: Boolean(skill.versions.at(-1)?.packageBase64) }
  })

  guarded('POST', '/api/skills/:id/approve', 'skill.approve', (exchange) => {
    const input = body<{ version?: string; decision: 'approve' | 'reject'; level: 'domain' | 'security'; opinion: string }>(exchange)
    const info = caller(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const version = input.version ?? skill.currentVersion
    const result = input.decision === 'approve'
      ? ctx.skillHub.approve(skill.id, version, input.level, { id: info.userId ?? info.principalId, name: info.name }, input.opinion)
      : ctx.skillHub.reject(skill.id, version, { id: info.userId ?? info.principalId, name: info.name }, input.opinion)
    changeLog(exchange, `skill.approve.${input.decision}`, 'skill', skill.id, skill.name, `${input.level}: ${input.opinion}`)
    return result
  })

  guarded('POST', '/api/skills/:id/publish', 'skill.publish', async (exchange) => {
    const { version } = body<{ version?: string }>(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const info = caller(exchange)
    // 真实账号标识（非显示名）：显示名（中文名）非账号，无法透传身份头，也会污染审计归属
    const result = await ctx.skillHub.publish(skill.id, version ?? skill.currentVersion, { id: info.userId ?? info.principalId, name: info.name })
    changeLog(exchange, 'skill.publish', 'skill', skill.id, skill.name)
    return result
  })

  /** 编辑已上架 Skill 的市场信息：仅作者本人或持 skill.publish 的管理员。 */
  guarded('PATCH', '/api/skills/:id', 'skill.submit', (exchange) => {
    const input = body<{ name?: string; category?: string; tags?: string[]; summary?: string; description?: string; visibility?: 'all' | 'orgs' | 'groups'; targetOrgs?: string[]; applicableModels?: string[]; deps?: string[]; cover?: string; authorName?: string }>(exchange)
    const info = caller(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const asAdmin = info.permissions.includes('*') || info.permissions.includes('skill.publish')
    if (skill.authorId !== (info.userId ?? info.principalId) && !asAdmin) {
      exchange.fail(403, 'FORBIDDEN', '仅 Skill 作者或平台管理员可编辑该 Skill 信息')
      return
    }
    const result = ctx.skillHub.update(skill.id, input, { id: info.userId ?? info.principalId, name: info.name }, { asAdmin })
    changeLog(exchange, 'skill.update', 'skill', skill.id, result.name, `编辑字段：${Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined).join('、') || '无'}`)
    return result
  })

  /** 重新手动上传当前已发布版本的 skill.zip 资源包（原地替换，版本号不变）。 */
  guarded('PUT', '/api/skills/:id/package', 'skill.submit', async (exchange) => {
    const { packageBase64 } = body<{ packageBase64?: string }>(exchange)
    if (!packageBase64) throw new Error('packageBase64 必填')
    const info = caller(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const asAdmin = info.permissions.includes('*') || info.permissions.includes('skill.publish')
    if (skill.authorId !== (info.userId ?? info.principalId) && !asAdmin) {
      exchange.fail(403, 'FORBIDDEN', '仅 Skill 作者或平台管理员可更新该 Skill 资源包')
      return
    }
    const result = await ctx.skillHub.replacePackage(skill.id, packageBase64, { id: info.userId ?? info.principalId, name: info.name }, { asAdmin })
    const pkg = result.versions.find((item) => item.version === result.currentVersion)?.package
    changeLog(exchange, 'skill.package.replace', 'skill', skill.id, skill.name, `v${result.currentVersion} 资源包重传（${pkg?.storage === 'nas' ? 'NAS' : '平台本地'}${pkg?.sizeBytes !== undefined ? ` · ${pkg.sizeBytes}B` : ''}）`)
    return { skill: result, package: pkg }
  })

  guarded('POST', '/api/skills/:id/deprecate', 'skill.publish', (exchange) => {
    const { reason, force } = body<{ reason?: string; force?: boolean }>(exchange)
    if (!reason?.trim()) throw new Error('弃用必须填写原因（护栏要求，下架分析依赖该口径）')
    const result = ctx.skillHub.deprecate(exchange.params['id']!, caller(exchange).name, reason, force)
    changeLog(exchange, 'skill.deprecate', 'skill', result.skill.id, result.skill.name, reason)
    return result
  })

  /** 删除 Skill：已弃用/强制下架/审批驳回可删；被未归档 Agent 引用时拒绝；审计数据保留。 */
  guarded('DELETE', '/api/skills/:id', 'skill.publish', (exchange) => {
    const id = exchange.params['id']!
    const skill = ctx.skillHub.skills().get(id)
    if (!skill) throw new Error(`Skill 不存在：${id}`)
    if (!['deprecated', 'offline', 'rejected'].includes(skill.status)) {
      throw new Error(`当前状态 ${skill.status} 不可删除（仅已弃用/强制下架/审批驳回可删）`)
    }
    const referencing = ctx.resourceCore.dependencies().find((record) => record.kind === 'skill' && record.toId === id)
      .map((record) => ctx.resourceCore.get('agent', record.fromId))
      .filter((agent) => agent !== undefined && agent.status !== 'archived')
    if (referencing.length > 0) {
      throw new Error(`该 Skill 仍被 ${referencing.map((agent) => agent!.name).join('、')} 引用，请先卸载或归档相关 Agent`)
    }
    ctx.skillHub.purge(id)
    changeLog(exchange, 'skill.delete', 'skill', id, skill.name)
    return { deleted: true }
  })

  guarded('POST', '/api/skills/:id/install', 'skill.install', (exchange) => {
    const { agentId, version } = body<{ agentId: string; version?: string }>(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const result = ctx.skillHub.install(skill.id, version ?? skill.currentVersion, agentId, caller(exchange).name)
    changeLog(exchange, 'skill.install', 'skill', skill.id, skill.name, `→ ${agentId}`)
    return result
  })

  guarded('POST', '/api/skills/:id/uninstall', 'skill.install', (exchange) => {
    const { agentId } = body<{ agentId: string }>(exchange)
    ctx.skillHub.uninstall(exchange.params['id']!, agentId)
    return { uninstalled: true }
  })

  guarded('POST', '/api/skills/:id/rate', 'skill.read', (exchange) => {
    const { stars } = body<{ stars: number }>(exchange)
    const info = caller(exchange)
    return ctx.skillHub.rate(exchange.params['id']!, info.userId ?? info.principalId, stars)
  })

  guarded('POST', '/api/skills/:id/download', 'skill.read', (exchange) => {
    const { version } = body<{ version?: string }>(exchange)
    const info = caller(exchange)
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    return ctx.skillHub.download(skill.id, version ?? skill.currentVersion, { id: info.userId ?? info.principalId, name: info.name })
  })

  /** skill.zip 包下载：与 NAS 上架产物同源（提交携带的原始包或 SKILL.md 现场打包）。 */
  guarded('GET', '/api/skills/:id/package', 'skill.read', (exchange) => {
    const skill = ctx.skillHub.detail(exchange.params['id']!)
    const pkg = ctx.skillHub.packageOf(skill.id, exchange.query.get('version') ?? skill.currentVersion)
    // 中文 slug 文件名：ASCII 回退 + RFC 5987 UTF-8 形式（非 Latin1 字符直接进头会损坏响应）
    exchange.res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': pkg.buffer.length,
      'content-disposition': `attachment; filename="${pkg.filename.replace(/[^\x20-\x7e"]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(pkg.filename)}`,
      'cache-control': 'no-cache',
    })
    exchange.res.end(pkg.buffer)
  })

  // -- Skill 包存储配置（local / NAS 后端） --------------------------------
  guarded('GET', '/api/skill-storage', 'skill.read', () => {
    const config = ctx.nasRegistry.getSkillStorage()
    return {
      config,
      nasOptions: ctx.nasRegistry.list({ status: 'online' }).map((nas) => ({ id: nas.id, name: nas.name, slug: nas.slug, rootPath: nas.attrs['rootPath'] })),
    }
  })

  guarded('PUT', '/api/skill-storage', 'skill.storage.write', (exchange) => {
    const input = body<{ mode?: 'local' | 'nas'; nasId?: string; basePath?: string }>(exchange)
    const config = ctx.nasRegistry.setSkillStorage(input, caller(exchange).name)
    changeLog(exchange, 'skill.storage.update', 'skill_storage', config.id, 'Skill 包存储', `${config.mode}${config.nasId ? ` → ${config.nasId}:${config.basePath}` : ''}`)
    return config
  })
}
