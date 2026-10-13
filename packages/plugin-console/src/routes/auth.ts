/**
 * 认证/SSO 域路由（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出——健康检查、登录、三方登录可用性、IdP 授权/回调/绑定/注册、
 * refresh、client-credentials、me、logout。处理器逐字搬运（行为与迁出前一致），
 * http/body/caller/requestOrigin 经依赖注入（requestOrigin 属中间件层，定义留 index.ts）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HttpExchange } from '../../../platform-core/src/index.ts'
import { ProviderAuthError } from '../../../plugin-iam/src/providers.ts'
import type { ConsoleRouteDeps } from './deps.ts'

export interface AuthRouteDeps extends ConsoleRouteDeps {
  /** 对外基址推导（反代场景 x-forwarded-* 优先；定义留 index.ts 中间件层） */
  requestOrigin: (exchange: HttpExchange) => string | undefined
}

export function registerAuthRoutes(ctx: Context, deps: AuthRouteDeps): void {
  const { http, body, caller, requestOrigin } = deps
  // -- 健康 ---------------------------------------------------------------
  http.register('GET', '/api/health', (exchange) => {
    exchange.ok({ status: 'ok', time: new Date().toISOString() })
  }, { access: 'public' })

  // -- 三方登录可用性（公开：登录页按配置显隐三方登录入口） ----------------------
  http.register('GET', '/api/auth/providers', (exchange) => {
    const providers = ctx.iam.connectorConfigs().all()
      .filter((config) => config.enabled && config.loginEnabled)
      .map((config) => ({ provider: config.provider, corpId: config.corpId, configId: config.id, name: config.name }))
    exchange.ok({ providers })
  }, { access: 'public' })

  // -- 认证 ---------------------------------------------------------------
  http.register('POST', '/api/auth/login', async (exchange) => {
    const { username, password } = body<{ username: string; password: string }>(exchange)
    if (!username || !password) {
      exchange.fail(400, 'BAD_REQUEST', '用户名与密码必填')
      return
    }
    try {
      const result = ctx.authn.login(username, password)
      const user = ctx.iam.users().get(result.userId)!
      exchange.ok({
        token: result.token,
        refreshToken: result.refreshToken,
        expiresAt: result.record.expiresAt,
        user: {
          id: user.id, username: user.username, displayName: user.displayName,
          orgId: user.orgId, roleIds: user.roleIds,
          roles: user.roleIds.map((roleId) => ctx.iam.roles().get(roleId)?.name).filter(Boolean),
          permissions: ctx.iam.userPermissions(user.id),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'LOGIN_FAILED', message)
    }
  }, { access: 'public' })

  // -- 三方登录（IdentityProviderAdapter 链路） ------------------------------
  http.register('POST', '/api/auth/sso/authorize', async (exchange) => {
    const { provider, scene, configId } = body<{ provider: string; scene?: 'web_qr' | 'h5' | 'in_app'; configId?: string }>(exchange)
    try {
      exchange.ok(await ctx.authn.beginSso(provider ?? 'dingtalk', scene ?? 'web_qr', requestOrigin(exchange), { ...(configId ? { configId } : {}) }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(400, 'SSO_AUTHORIZE_FAILED', message)
    }
  }, { access: 'public' })

  http.register('POST', '/api/auth/sso', async (exchange) => {
    const { provider, code, state } = body<{ provider: string; code: string; state: string }>(exchange)
    if (!code || !state) {
      exchange.fail(400, 'BAD_REQUEST', 'code 与 state 必填（先调 /api/auth/sso/authorize 获取 state）')
      return
    }
    try {
      const result = await ctx.authn.completeSso(provider ?? 'dingtalk', code, state)
      if (result.kind === 'pending') {
        exchange.ok({ kind: 'pending', pendingTicket: result.pendingTicket, profileName: result.profileName })
        return
      }
      const user = ctx.iam.users().get(result.userId)!
      exchange.ok({
        kind: 'hit',
        token: result.session.token,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.access.expiresAt,
        user: {
          id: user.id, username: user.username, displayName: user.displayName,
          orgId: user.orgId, roleIds: user.roleIds,
          roles: user.roleIds.map((roleId) => ctx.iam.roles().get(roleId)?.name).filter(Boolean),
          permissions: ctx.iam.userPermissions(user.id),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'SSO_FAILED', message)
    }
  }, { access: 'public' })

  http.register('POST', '/api/auth/sso/bind', async (exchange) => {
    const { pendingTicket, username, password } = body<{ pendingTicket: string; username: string; password: string }>(exchange)
    try {
      const result = ctx.authn.ssoBindExisting(pendingTicket, username, password)
      const user = ctx.iam.users().get(result.userId)!
      exchange.ok({
        token: result.session.token,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.access.expiresAt,
        user: {
          id: user.id, username: user.username, displayName: user.displayName,
          orgId: user.orgId, roleIds: user.roleIds,
          roles: user.roleIds.map((roleId) => ctx.iam.roles().get(roleId)?.name).filter(Boolean),
          permissions: ctx.iam.userPermissions(user.id),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'SSO_BIND_FAILED', message)
    }
  }, { access: 'public' })

  // -- 扫码/自动识别绑定三方身份（不手工输入 unionId） -------------------------

  /**
   * 发起绑定授权（须登录）。缺省绑定当前登录账号本人；
   * 指定 targetUserId 为他人绑定（需 iam.user.write，扫码人即被绑定的钉钉身份）。
   */
  http.register('POST', '/api/auth/sso/bind/authorize', async (exchange) => {
    const { provider, targetUserId, configId } = body<{ provider?: string; targetUserId?: string; configId?: string }>(exchange)
    const info = caller(exchange)
    const userId = targetUserId ?? info.userId
    if (!userId) {
      exchange.fail(401, 'UNAUTHORIZED', '仅平台账号（人）可发起三方身份绑定')
      return
    }
    if (userId !== info.userId && !info.permissions.includes('*') && !info.permissions.includes('iam.user.write')) {
      exchange.fail(403, 'FORBIDDEN', '为其他账号发起绑定需要 iam.user.write 权限')
      return
    }
    if (!ctx.iam.users().get(userId)) {
      exchange.fail(400, 'BAD_REQUEST', `账号不存在：${userId}`)
      return
    }
    try {
      exchange.ok(await ctx.authn.beginSso(provider ?? 'dingtalk', 'web_qr', requestOrigin(exchange), { purpose: 'bind', userId, ...(configId ? { configId } : {}) }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(400, 'SSO_BIND_AUTHORIZE_FAILED', message)
    }
  }, { access: 'authenticated' })

  /**
   * 钉钉 OAuth 浏览器回跳（公开，无需会话）：按 state 用途分发——
   * bind：完成扫码绑定并渲染结果页；login：完成登录并写 localStorage 后进入控制台。
   * 同时挂在 /api/auth/sso（与钉钉后台已配置的重定向 URL 兼容）。
   */
  const handleSsoCallback = async (exchange: HttpExchange): Promise<void> => {
    const code = exchange.query.get('authCode') ?? exchange.query.get('code') ?? ''
    const state = exchange.query.get('state') ?? ''
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
    const webBase = ctx.httpServer?.externalBase ?? ''
    const render = (title: string, bodyHtml: string, script = ''): void => {
      exchange.res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      exchange.res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#1f2329}
.card{background:#fff;border-radius:16px;padding:clamp(24px,7vw,40px) clamp(20px,7vw,48px);box-shadow:0 8px 30px rgba(0,0,0,.06);text-align:center;max-width:min(420px,calc(100vw - 24px))}
.card h2{margin:0 0 12px;font-size:20px}.card p{margin:6px 0;color:#646a73;font-size:14px;line-height:1.7}
.card a{color:#3370ff;text-decoration:none}.ok{color:#34a853;font-size:44px}.bad{color:#f54a45;font-size:44px}</style>
</head><body><div class="card">${bodyHtml}</div>${script}</body></html>`)
    }
    if (!code || !state) {
      render('授权回调异常', `<div class="bad">✕</div><h2>回调参数缺失</h2><p>缺少 code/state，请从控制台重新发起授权。</p><p><a href="/">返回控制台</a></p>`)
      return
    }
    try {
      const peeked = ctx.authn.peekOAuthState(state)
      if (peeked.purpose === 'bind') {
        const result = await ctx.authn.completeSsoBind(code, state)
        ctx.audit.record({
          type: 'change', actorType: 'human', actorId: result.userId,
          actorName: ctx.iam.users().get(result.userId)?.displayName ?? result.userId,
          action: 'iam.user.bind', resourceType: 'user', resourceId: result.userId,
          resourceName: result.displayName, result: 'ok', detail: `${result.provider} 扫码授权绑定`,
        })
        render('绑定成功', `<div class="ok">✓</div><h2>钉钉身份绑定成功</h2><p>已绑定：<b>${escapeHtml(result.displayName)}</b></p><p>即将自动返回控制台…</p><p><a href="${webBase}/#/iam">立即返回</a></p>`,
          `<script>setTimeout(()=>{location.href=\`${webBase}/#/iam\`},2000)</script>`)
        return
      }
      const result = await ctx.authn.completeSso(peeked.provider, code, state)
      if (result.kind === 'pending') {
        // 未命中身份链接：回登录页走「绑定已有账号 / 注册新账号」分支
        render('首次登录', `<h2>首次使用该三方身份</h2><p>正在返回登录页完成绑定/注册…</p>`,
          `<script>localStorage.setItem('heng_ops_sso_pending', JSON.stringify({ pendingTicket: ${JSON.stringify(result.pendingTicket)}, profileName: ${JSON.stringify(result.profileName)} })); location.replace('${webBase}/#/login')</script>`)
        return
      }
      const user = ctx.iam.users().get(result.userId)!
      const sessionUser = {
        id: user.id, username: user.username, displayName: user.displayName,
        orgId: user.orgId, roleIds: user.roleIds,
        roles: user.roleIds.map((roleId) => ctx.iam.roles().get(roleId)?.name).filter(Boolean),
        permissions: ctx.iam.userPermissions(user.id),
      }
      // 登录成功落库后按暂存的 OIDC 授权请求（heng_ops_sso_oidc_req，与授权请求同为 5 分钟有效）回到
      // 授权页继续 consent——AI 应用发起的「先登录再授权」流才能闭环；无暂存则进控制台
      render('登录成功', `<div class="ok">✓</div><h2>欢迎回来，${escapeHtml(user.displayName)}</h2><p>正在继续…</p>`,
        `<script>localStorage.setItem('heng_ops_token', ${JSON.stringify(result.session.token)}); localStorage.setItem('heng_ops_refresh', ${JSON.stringify(result.session.refreshToken)}); localStorage.setItem('heng_ops_user', ${JSON.stringify(JSON.stringify(sessionUser))});
var resume=null;try{resume=JSON.parse(localStorage.getItem('heng_ops_sso_oidc_req')||'null')}catch(e){resume=null}
localStorage.removeItem('heng_ops_sso_oidc_req');
// 跨源自举回跳（交接清单 G1）：登录页在整页跳转钉钉授权前暂存的 next（仅回环/私网 http(s)，
// 白名单见 landing.js sanitizeCrossOriginNext，此处正则兜底）——扫码完成后签自助票回跳本机面板
var nx=null;try{nx=sessionStorage.getItem('heng_ops_next_cross')}catch(e){nx=null}
sessionStorage.removeItem('heng_ops_next_cross');
if(resume&&typeof resume.req==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(resume.req)&&Date.now()-(resume.ts||0)<300000){location.replace('${webBase}/#/oauth/authorize?req='+resume.req)}
else if(nx&&/^https?:\\/\\/(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/.test(nx)){
  fetch('${webBase}/api/auth/entry-tickets/self',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+localStorage.getItem('heng_ops_token')}})
    .then(function(r){return r.ok?r.json():null})
    .then(function(p){var t=p&&p.data&&p.data.ticket;location.replace(t?nx+'#entry_ticket='+encodeURIComponent(t):'${webBase}/#/dashboard')})
    .catch(function(){location.replace('${webBase}/#/dashboard')})
}else{location.replace('${webBase}/#/dashboard')}</script>`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[sso-callback] 三方授权失败：', message)
      // 自动兜底：应用新增权限点后，老用户历史授权快照不含新 scope（钉钉 403 AccessTokenPermissionDenied）。
      // 自动重发一次带 prompt=consent 的授权跳转刷新授权快照；一次性 cookie 防重试循环，再失败才展示错误页。
      const retried = (exchange.headers.cookie ?? '').split(';').some((item) => item.trim() === 'heng_ops_sso_consent_retry=1')
      if (!retried && error instanceof ProviderAuthError && error.code === 'PROVIDER_SCOPE_DENIED') {
        try {
          const record = ctx.authn.peekOAuthState(state)
          const retry = await ctx.authn.beginSso(record.provider, 'web_qr', requestOrigin(exchange), {
            purpose: record.purpose,
            ...(record.userId !== undefined ? { userId: record.userId } : {}),
            ...(record.configId !== undefined ? { configId: record.configId } : {}),
            promptConsent: true,
          })
          if (retry.authorizeUrl) {
            exchange.res.writeHead(302, {
              location: retry.authorizeUrl,
              'set-cookie': 'heng_ops_sso_consent_retry=1; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax',
            })
            exchange.res.end()
            return
          }
        } catch (retryError) {
          console.error('[sso-callback] 重授权发起失败：', retryError instanceof Error ? retryError.message : String(retryError))
        }
      }
      render('操作失败', `<div class="bad">✕</div><h2>三方授权失败</h2><p>${escapeHtml(message)}</p><p><a href="/">返回控制台</a></p>`)
    }
  }
  http.register('GET', '/api/auth/sso', handleSsoCallback, { access: 'public' })
  http.register('GET', '/api/auth/sso/callback', handleSsoCallback, { access: 'public' })

  http.register('POST', '/api/auth/sso/register', async (exchange) => {
    const { pendingTicket } = body<{ pendingTicket: string }>(exchange)
    try {
      const result = ctx.authn.ssoRegister(pendingTicket)
      const user = ctx.iam.users().get(result.userId)!
      exchange.ok({
        token: result.session.token,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.access.expiresAt,
        user: {
          id: user.id, username: user.username, displayName: user.displayName,
          orgId: user.orgId, roleIds: user.roleIds,
          roles: user.roleIds.map((roleId) => ctx.iam.roles().get(roleId)?.name).filter(Boolean),
          permissions: ctx.iam.userPermissions(user.id),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'SSO_REGISTER_FAILED', message)
    }
  }, { access: 'public' })

  http.register('POST', '/api/auth/refresh', async (exchange) => {
    const { refreshToken } = body<{ refreshToken: string }>(exchange)
    if (!refreshToken) {
      exchange.fail(400, 'BAD_REQUEST', 'refreshToken 必填')
      return
    }
    try {
      const result = ctx.authn.refreshSession(refreshToken)
      exchange.ok({ token: result.token, refreshToken: result.refreshToken })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'REFRESH_FAILED', message)
    }
  }, { access: 'public' })

  http.register('POST', '/api/auth/client-credentials', async (exchange) => {
    const { clientId, clientSecret } = body<{ clientId: string; clientSecret: string }>(exchange)
    try {
      const result = ctx.authn.clientCredentialsLogin(clientId, clientSecret)
      exchange.ok({ token: result.token, expiresAt: result.record.expiresAt, principal: { id: result.principal.id, name: result.principal.name, scopes: result.record.scopes } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'CC_FAILED', message)
    }
  }, { access: 'public' })

  http.register('GET', '/api/auth/me', (exchange) => {
    const info = caller(exchange)
    exchange.ok({
      kind: info.kind,
      principalId: info.principalId,
      ...(info.userId !== undefined ? { userId: info.userId } : {}),
      name: info.name,
      permissions: info.permissions,
      actChain: info.actChain,
    })
  }, { access: 'authenticated' })

  http.register('POST', '/api/auth/logout', async (exchange) => {
    const header = String(exchange.headers['authorization'] ?? '')
    const token = header.slice(7)
    const refreshToken = body<{ refreshToken?: string }>(exchange).refreshToken
    try {
      const verified = ctx.authn.verify(token)
      if (verified.token.sid) {
        ctx.authn.revokeSession(verified.token.sid, '用户主动登出')
      } else {
        ctx.authn.revokeToken(verified.token.jti, '用户主动登出')
      }
    } catch { /* 令牌已失效也允许登出 */ }
    if (refreshToken) {
      try { ctx.authn.refreshSession(refreshToken) } catch { /* 已失效 */ }
    }
    // 吊销强持久化后再响应：返回 200 后进程被杀，吊销状态不丢失（评审崩溃恢复实验）
    await ctx.opsStorage.flushDurable()
    exchange.ok()
  }, { access: 'authenticated' })
}
