/**
 * 错误文案共享模块（WP-06/C3）：原因码 → 文案 + 行动按钮，全控制台集中一处。
 *
 * 纪律（DoD「错误文案映射完整性」）：任何新增对外原因码必须同步本表。
 * selftest 实时枚举后端原因码（exchange.fail(NNN,'XXX') 大写码 + 内联 error:{code:'XXX'} 载荷）
 * 并断言 全集 ⊆ ERROR_CODES ∪ BINDING_REASONS，漏配即红。模块保持零依赖（selftest 直接 import 校验）。
 * ERROR_CODES 由 COPY 键集派生，注册表与文案同源、永不脱节。
 *
 * 原因码全集（REFACTOR-2026-10-13 阶段 2 完备化，共 40 + 3 条）：
 *   业务原因码（七条，rq-card 会话卡同键——语义冻结勿动）：
 *   nas-authz-deny    NAS 数据权限五步判定 deny（fail-closed）
 *   breaker-open      MCP 服务熔断器开启（连续失败≥3 次置位）
 *   quota-exhausted   调用额度耗尽（quota.exceeded；billing 下线后保留 wire 兼容文案）
 *   pdp-unreachable   权限判定点不可达（保护性拒绝，P0-2 红线）
 *   degraded          服务健康 degraded（延迟>800ms，30s 轮询探活）
 *   binding-invalid   平台身份绑定失效（含 no_cookie / expired / account_inactive 细分）
 *   invoke-error      工具执行报错且无平台侧原因码时的兜底（rq-card 会话卡语义，WP-06 报备决议）
 *   后端 HTTP 大写码（28 条 fail 码 + 5 条内联载荷码）：见 COPY 内分组注释。
 *   绑定失效细分小写码（3 条）：BINDING_REASONS（dsh-bridge /dsh-bridge/status 返回）。
 */

const COPY = {
  // ── 业务原因码（rq-card 会话卡同键，语义冻结）──────────────────────────
  'nas-authz-deny': {
    tone: 'danger',
    title: '暂无该数据的访问权限',
    message: '本次访问被数据权限策略拦截（保护性拒绝）。如因工作需要，可发起访问申请，审批通过后即可使用。',
    action: { label: '申请访问', href: '#/nas-authz' },
  },
  'breaker-open': {
    tone: 'warn',
    title: '服务熔断中，正在自动恢复',
    message: '该服务连续调用失败已触发熔断保护，暂拒绝调用；探活恢复后自动闭合，无需人工处理。',
    action: { label: '查看服务健康', href: '#/mcp' },
  },
  'quota-exhausted': {
    tone: 'danger',
    title: '额度已耗尽',
    message: '本主体调用额度已用完，调用被暂停。可查看用量明细，或联系管理员调整限额。',
    action: { label: '查看用量', href: '#/assets' },
  },
  'pdp-unreachable': {
    tone: 'warn',
    title: '权限检查服务暂不可用',
    message: '为守住安全红线，权限判定不可达时一律保护性拒绝。服务恢复后请重试；紧急情况请联系平台管理员。',
    action: null,
  },
  degraded: {
    tone: 'info',
    title: '服务响应有点慢',
    message: '该服务当前处于降级运行（延迟偏高），调用仍在继续。如长时间未恢复，系统会转后台并经钉钉通知你。',
    action: null,
  },
  'binding-invalid': {
    tone: 'danger',
    title: '身份绑定已失效',
    message: '当前浏览器与平台账号的绑定已失效（可能是过期、退出或账号状态变化）。重新绑定后即可继续使用宿主对话与归因能力。',
    action: { label: '一键重绑', href: '/auth/oidc/start', external: true },
  },
  'invoke-error': {
    tone: 'danger',
    title: '本次调用执行出错',
    message: '工具执行返回错误（非权限/额度原因）。可重试一次；持续失败请到服务详情查看健康与调用记录。',
    action: { label: '查看调用记录', href: '#/mcp' },
  },

  // ── 认证与会话（fail 401 族）──────────────────────────────────────────
  UNAUTHORIZED: {
    tone: 'danger',
    title: '登录状态缺失',
    message: '本次请求未携带有效登录凭证（缺少 Bearer 令牌）。请重新登录后再试。',
    action: { label: '去登录', href: '#/login' },
  },
  TOKEN_INVALID: {
    tone: 'danger',
    title: '登录凭证已失效',
    message: '当前会话令牌无效或已被吊销（可能因改密、登出或管理员吊销联动）。请重新登录。',
    action: { label: '重新登录', href: '#/login' },
  },
  LOGIN_FAILED: {
    tone: 'danger',
    title: '登录失败',
    message: '账号或密码不正确，或账号状态不可用。请核对后重试；多次失败请联系管理员确认账号状态。',
    action: null,
  },
  REFRESH_FAILED: {
    tone: 'danger',
    title: '会话续期失败',
    message: '登录会话续期被拒绝（刷新令牌失效或已过期）。请重新登录以继续使用。',
    action: { label: '重新登录', href: '#/login' },
  },

  // ── 通用 HTTP（fail 400/403/404/500 族）───────────────────────────────
  BAD_REQUEST: {
    tone: 'warn',
    title: '请求参数不完整或有误',
    message: '平台拒绝了本次请求（参数校验未通过）。请检查填写内容后重试；若确认无误仍失败，请联系平台管理员。',
    action: null,
  },
  FORBIDDEN: {
    tone: 'danger',
    title: '没有该操作的权限',
    message: '当前账号缺少执行此操作所需的权限点。如需办理，请联系管理员调整角色授权。',
    action: null,
  },
  NOT_FOUND: {
    tone: 'warn',
    title: '找不到目标资源或页面',
    message: '请求的资源不存在或已被移除。请确认链接/编号无误；若从列表进入，可能已被他人删除，刷新后重试。',
    action: { label: '回到工作台', href: '#/dashboard' },
  },
  INTERNAL: {
    tone: 'danger',
    title: '服务器内部错误',
    message: '平台处理本次请求时出现未预期错误。请稍后重试；持续出现请联系平台管理员并提供操作时间点。',
    action: null,
  },

  // ── SSO 族（授权/登录/注册/绑定）──────────────────────────────────────
  SSO_AUTHORIZE_FAILED: {
    tone: 'danger',
    title: '单点登录发起失败',
    message: '无法发起三方登录授权（连接器配置或参数有误）。请联系管理员检查「组织与账号 → 三方集成」配置。',
    action: null,
  },
  SSO_FAILED: {
    tone: 'danger',
    title: '单点登录失败',
    message: '三方身份提供方登录未通过（授权码无效、已过期或账号映射失败）。请重试；持续失败请联系管理员核查 SSO 配置。',
    action: null,
  },
  SSO_REGISTER_FAILED: {
    tone: 'danger',
    title: '单点登录开户失败',
    message: '首次三方登录自动开通账号未成功（可能缺少组织映射或账号被停用）。请联系管理员处理。',
    action: null,
  },
  SSO_BIND_AUTHORIZE_FAILED: {
    tone: 'danger',
    title: '绑定授权发起失败',
    message: '无法生成三方绑定授权地址（连接器登录配置缺失或有误）。请联系管理员检查三方集成配置。',
    action: null,
  },
  SSO_BIND_FAILED: {
    tone: 'danger',
    title: '三方身份绑定失败',
    message: '扫码/授权绑定未成功（授权已过期或账号状态变化）。请回到原页面重新发起绑定。',
    action: null,
  },

  // ── 票据与绑定（内联载荷码 + fail 码）─────────────────────────────────
  ENTRY_TICKET_INVALID: {
    tone: 'danger',
    title: '入场票据无效或已过期',
    message: '免登入场票据无效、已被使用或已过期。请回到来源入口（钉钉/门户）重新点击进入。',
    action: null,
  },
  INVALID_TICKET: {
    tone: 'danger',
    title: '票据无效或已过期',
    message: '会话票据校验未通过（无效、已使用或已过期）。请回到来源入口重新获取。',
    action: null,
  },
  TICKET_INVALID: {
    tone: 'warn',
    title: '下载票据已失效',
    message: '下载票据缺失或已过期。请回到文件列表重新发起下载。',
    action: { label: '回到 NAS 存储', href: '#/nas' },
  },
  NOT_BOUND: {
    tone: 'danger',
    title: '宿主会话未绑定',
    message: '当前浏览器与平台账号尚未建立绑定。请从宿主入口（打开即工作台）进入，或完成身份绑定后重试。',
    action: { label: '一键绑定', href: '/auth/oidc/start', external: true },
  },
  ACCOUNT_INACTIVE: {
    tone: 'danger',
    title: '账号已冻结或不可用',
    message: '绑定的平台账号已冻结或不存在（fail-closed）。请联系管理员确认账号状态后重新绑定。',
    action: null,
  },
  AUTHN_UNAVAILABLE: {
    tone: 'warn',
    title: '认证服务暂不可用',
    message: '平台认证服务装配不完整或暂不可用。请稍后重试；持续出现请联系平台管理员。',
    action: null,
  },

  // ── NAS / 下载 / 版本冲突 ─────────────────────────────────────────────
  SHARE_LINK_INVALID: {
    tone: 'danger',
    title: '分享链接无效',
    message: '该分享链接已失效（过期、被撤销或达到访问上限）。请向分享者重新索取链接。',
    action: null,
  },
  DOWNLOAD_FAILED: {
    tone: 'warn',
    title: '文件下载失败',
    message: '后端存储取流失败。请重试；持续失败请联系管理员检查 NAS 存储状态。',
    action: { label: '查看 NAS 存储', href: '#/nas' },
  },
  VERSION_CONFLICT: {
    tone: 'warn',
    title: '版本冲突：数据已被他人修改',
    message: '你编辑的内容在你打开后已被他人变更，为保护数据本次保存被拒绝。请刷新获取最新版本后重新修改。',
    action: null,
  },

  // ── 更新（plugin-update）──────────────────────────────────────────────
  TOO_FREQUENT: {
    tone: 'warn',
    title: '操作太频繁',
    message: '更新检查请求过于频繁，已被限流。请稍后再试。',
    action: null,
  },
  UPSTREAM_ERROR: {
    tone: 'warn',
    title: '上游服务异常',
    message: '平台依赖的上游服务（更新源）暂时不可用。请稍后重试。',
    action: null,
  },
  APPLY_FAILED: {
    tone: 'danger',
    title: '更新应用失败',
    message: '更新包应用未成功（校验或执行出错）。可重试一次；持续失败请联系管理员查看更新详情。',
    action: null,
  },
  ROLLBACK_FAILED: {
    tone: 'danger',
    title: '回滚失败',
    message: '版本回滚未成功。请勿重复操作，联系管理员介入处理。',
    action: null,
  },

  // ── 接入与机器凭证（plugin-connect / client_credentials）──────────────
  ENROLL_FAILED: {
    tone: 'danger',
    title: '连接器接入注册失败',
    message: '连接器注册未通过（注册凭证无效或已过期）。请核对注册凭证后重试。',
    action: { label: '查看平台接入', href: '#/connect' },
  },
  LOCKED: {
    tone: 'warn',
    title: '接入注册已临时锁定',
    message: '连续注册失败次数过多，接入注册已被临时锁定以保护平台。请锁定期过后再试，或联系管理员核查注册凭证。',
    action: { label: '查看平台接入', href: '#/connect' },
  },
  CC_FAILED: {
    tone: 'danger',
    title: '机器凭证认证失败',
    message: 'client_credentials 认证未通过（client_id/secret 有误或已被吊销）。请核对凭证；必要时到「认证与令牌」重新签发。',
    action: { label: '查看认证与令牌', href: '#/authn' },
  },
  FORBIDDEN_ORIGIN: {
    tone: 'danger',
    title: '当前来源无权访问',
    message: '该配置接口仅允许本机访问。请在部署本机的浏览器中操作。',
    action: null,
  },

  // ── 市场（plugin-market 开发者面）─────────────────────────────────────
  DEVELOPER_REGISTER_FAILED: {
    tone: 'danger',
    title: '开发者注册失败',
    message: '市场开发者注册未成功（信息不完整或账号已存在）。请核对填写内容后重试。',
    action: null,
  },
  DEVELOPER_LOGIN_FAILED: {
    tone: 'danger',
    title: '开发者登录失败',
    message: '市场开发者账号登录未通过（账号或密钥有误）。请核对后重试。',
    action: null,
  },
  MARKET_SUBMIT_FAILED: {
    tone: 'warn',
    title: '市场提交失败',
    message: 'Skill 提交市场未成功（内容校验未通过）。请按提交要求检查资产信息后重试。',
    action: { label: '查看 Skill 市场', href: '#/skills' },
  },
}

/** 全部已配文案的对外原因码（由 COPY 键集派生，注册表与文案同源）。 */
export const ERROR_CODES = Object.keys(COPY)

/** 绑定失效细分原因码（dsh-bridge /dsh-bridge/status 返回） */
export const BINDING_REASONS = ['no_cookie', 'expired', 'account_inactive']

/** 绑定细分原因 → 归并到 binding-invalid 的提示补充。 */
const BINDING_DETAIL = {
  no_cookie: '尚未完成身份绑定。',
  expired: '绑定已过期（默认 24 小时），重新登录即可续期。',
  account_inactive: '账号状态异常（冻结/离职联动失效），请联系管理员确认账号状态。',
}

/** 查文案：未知原因码回落通用兜底（永不裸奔技术错误）。 */
export function errorCopy(code, detail) {
  const base = COPY[code] ?? {
    tone: 'danger',
    title: '操作暂时无法完成',
    message: `平台返回未知状态（${code || 'unknown'}）。请稍后重试；若持续出现，请联系平台管理员。`,
    action: null,
  }
  const extra = code === 'binding-invalid' && detail && BINDING_DETAIL[detail] ? BINDING_DETAIL[detail] : ''
  return { ...base, ...(extra ? { message: `${base.message}（${extra}）` } : {}) }
}

/** 渲染横幅/条状提示（返回 HTML 字符串；调用方负责挂载与按钮跳转）。 */
export function errorBarHtml(code, detail) {
  const copy = errorCopy(code, detail)
  const toneColor = copy.tone === 'danger' ? 'var(--danger)' : copy.tone === 'warn' ? 'var(--warn)' : 'var(--info)'
  const toneBg = copy.tone === 'danger' ? 'var(--danger-bg)' : copy.tone === 'warn' ? 'var(--warn-bg)' : 'var(--info-bg)'
  const action = copy.action
    ? `<a class="btn btn-sm ${copy.tone === 'danger' ? 'btn-primary' : 'btn-default'}" data-error-action="1"
        href="${copy.action.href}" ${copy.action.external ? 'target="_top" rel="noopener"' : ''} style="margin-left:12px">${copy.action.label}</a>`
    : ''
  return `<div class="flex error-bar" role="alert" data-error-code="${code}"
    style="gap:10px;padding:10px 14px;border:1px solid ${toneColor}33;background:${toneBg};border-radius:var(--radius);margin-bottom:16px">
    <span style="color:${toneColor};display:flex">${copy.tone === 'info' ? 'ℹ️' : '⚠️'}</span>
    <div class="grow"><div class="fs-13" style="font-weight:600">${copy.title}</div>
    <div class="fs-12 text-3">${copy.message}</div></div>${action}</div>`
}
