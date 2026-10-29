/** 公共冰晶首页：数字员工是协作主体；能力与治理分别呈现。 */
import { icon } from '../icons.js'
import { session } from '../api.js'
import { esc } from '../ui.js'
import rqI18n from '../i18n.js'
import { setUiTheme } from '../theme.js'
import { crystalMarkup, mountCrystalScene } from '../crystal-scene.js'
const t = (key) => rqI18n.t(key)
const text = (key) => esc(t(key))
const glyph = (name, size = 20) =>
  `<span aria-hidden="true">${icon(name, size)}</span>`
const CAPABILITIES = [
  {
    name: 'MCP 服务',
    icon: 'plug',
    route: 'mcp',
    title: '让工具成为受控的企业能力',
    desc: '统一登记服务、管理调用权限与健康状态，让数字员工按授权调用业务工具。',
    tags: ['服务目录', '调用授权', '健康监控'],
  },
  {
    name: 'Skill 技能',
    icon: 'sparkles',
    route: 'skills',
    title: '把经验沉淀为可复用的技能',
    desc: '通过提交、扫描、审批和版本管理，让工作方法在团队之间有序流转。',
    tags: ['技能审批', '版本管理', '复用分发'],
  },
  {
    name: '模型渠道',
    icon: 'cpu',
    route: 'gateway',
    title: '为不同任务选择合适的模型',
    desc: '集中接入模型渠道，结合分级路由、预算约束与降级策略管理真实调用。',
    tags: ['渠道管理', '分级路由', '预算约束'],
  },
  {
    name: 'AI 应用',
    icon: 'app',
    route: 'apps',
    title: '让应用连接身份、能力与用量',
    desc: '管理应用生命周期与能力绑定，通过统一身份和用量记录理解应用的运行情况。',
    tags: ['应用管理', '能力绑定', '用量记录'],
  },
  {
    name: 'SaaS 连接器',
    icon: 'link',
    route: 'connectors',
    title: '把既有业务系统接入协作',
    desc: '通过连接器管理服务接入、凭据与授权，让数字员工获得明确边界内的业务能力。',
    tags: ['服务接入', '凭据管理', '按需授权'],
  },
  {
    name: '文件存储',
    icon: 'server',
    route: 'nas',
    title: '让文件访问遵循组织权限',
    desc: '通过 MCP 文件网关连接存储，按组织位置授权，支持受控访问与文件共享。',
    tags: ['文件网关', '组织授权', '受控共享'],
  },
]
const STEPS = [
  {
    name: '目标对齐',
    icon: 'target',
    title: '先明确，要交付什么',
    desc: '把经营目标拆成项目与任务，明确责任、范围和交付要求，让协作有共同方向。',
    tag: '示例场景 · 行业研究',
    input: '目标：完成新市场行业研究',
    output: '交付要求：研究报告与来源清单',
    role: '负责人明确目标与验收要求',
    route: 'dashboard?tab=goals',
  },
  {
    name: '任务协作',
    icon: 'users',
    title: '让合适的数字员工接住任务',
    desc: '围绕项目分配任务，连接人员与数字员工，跟踪进行中、待审与已完成事项。',
    tag: '示例场景 · 任务分工',
    input: '任务：收集资料、分析与复核',
    output: '责任：明确分工与当前进度',
    role: '人与数字员工共同推进任务',
    route: 'dashboard?tab=actions',
  },
  {
    name: '能力调用',
    icon: 'plugZap',
    title: '带着权限，调用所需能力',
    desc: '数字员工连接远端执行环境，按授权使用模型、Skill 与 MCP 工具，留下调用与用量记录。',
    tag: '示例场景 · 受控执行',
    input: '能力：检索工具、分析技能与模型',
    output: '过程：授权调用与用量记录',
    role: '平台提供能力接入与调用治理',
    route: 'dashboard?tab=collab',
  },
  {
    name: '交付验收',
    icon: 'fileCheck',
    title: '用可检查的结果完成协作',
    desc: '将执行结果与任务关联，按交付要求完成验收，让工作从有进展走向有结果。',
    tag: '示例场景 · 交付确认',
    input: '交付：报告、依据与工作记录',
    output: '验收：核对要求，确认结果',
    role: '验收方确认结果与后续行动',
    route: 'exec',
  },
]
let cleanup = () => {}
export function disposeHome() {
  cleanup()
  cleanup = () => {}
}
export function renderHome(app) {
  disposeHome()
  const consoleRoute =
    session.token || session.isDemo ? '#/dashboard' : '#/login'
  const link = (label, section) =>
    `<a href="#/home?section=${section}" data-home-scroll="${section}">${text(label)}</a>`
  const enter = (label) =>
    `<a class="ice-button" href="${consoleRoute}" data-enter-crystal>${text(label)} ${glyph('external', 16)}</a>`
  app.innerHTML = `<div class="ice-home">
    <a class="ice-skip" href="#/home" data-home-scroll="ice-workflow">${text('跳到产品内容')}</a>
    <nav class="ice-nav" aria-label="${text('产品导航')}">
      <a class="ice-brand" href="#/home"><img src="ybk-mark.png" width="38" height="38" alt=""><span>元冰可 <b>AIOS</b><small>${text('企业 AI 运行与治理平台')}</small></span></a>
      <div class="ice-nav-links" id="ice-nav-links">${link('协作流程', 'ice-workflow')}${link('企业能力', 'ice-capabilities')}${link('统一治理', 'ice-governance')}<a href="https://github.com/01men/ybkkasi" target="_blank" rel="noopener noreferrer">GitHub ${glyph('external', 12)}</a><div class="ice-lang-host"></div></div>
      ${enter('进入工作台')}<button class="ice-menu" type="button" aria-expanded="false" aria-controls="ice-nav-links" aria-label="${text('打开菜单')}">${glyph('menu')}</button>
    </nav>
    <main>
      <header class="ice-hero ice-wrap">
        <div class="ice-hero-copy"><div class="ice-kicker"><i></i>${text('数字员工 · 企业能力 · 统一治理')}</div><h1>${text('让数字员工协同，')}<br><span>${text('让企业能力聚合。')}</span></h1><p class="ice-lead">${text('把目标、数字员工与 AI 能力连接起来，让执行有序、交付有据。')}</p><div class="ice-actions">${enter('体验冰晶工作台')}<a class="ice-button ice-button-outline" href="#/home?section=ice-workflow" data-home-scroll="ice-workflow">${text('探索协作方式')} ${glyph('arrowDown', 16)}</a></div><div class="ice-hero-note">${glyph('shieldCheck', 15)}${text('支持自主部署，按组织与角色管理访问。')}</div></div>
        <div class="ice-hero-visual"><div class="ice-visual-heading"><span>CONNECTED INTELLIGENCE</span><span class="ice-live-dot">${text('协作生态示意')}</span></div>${crystalMarkup()}<div class="ice-orbit-label ice-orbit-label-a">${glyph('users', 17)}${text('数字员工')}</div><div class="ice-orbit-label ice-orbit-label-b">${glyph('plug', 17)}${text('能力接入')}</div><div class="ice-orbit-label ice-orbit-label-c">${glyph('shieldCheck', 17)}${text('统一治理')}</div><button type="button" class="ice-motion" aria-pressed="false">${text('暂停动效')}</button><div class="ice-visual-caption">${text('协作主体彼此连接，企业能力按需调用')}</div></div>
      </header>
      <div class="ice-foundations ice-wrap">${[
        ['users', '数字员工协作', '目标、任务与交付相互连接'],
        ['layers', '企业能力接入', '模型、技能与工具统一管理'],
        ['shieldCheck', '统一治理', '权限、审计与用量有据可查'],
        ['puzzle', '开放生态', 'MCP · REST API · CLI'],
      ]
        .map(
          ([i, a, b]) =>
            `<div>${glyph(i)}<span><b>${text(a)}</b><small>${text(b)}</small></span></div>`,
        )
        .join('')}</div>
      <section class="ice-section ice-wrap" id="ice-workflow" aria-labelledby="ice-workflow-title"><div class="ice-section-head"><div><div class="ice-kicker">01 / ${text('协作流程')}</div><h2 id="ice-workflow-title">${text('从目标到交付，')}<span>${text('每一步有据可循。')}</span></h2></div><p>${text('人明确方向与判断标准，数字员工参与执行，平台连接任务、能力与记录。')}</p></div><div class="ice-workflow-tabs" role="tablist" aria-label="${text('协作流程')}">${STEPS.map((s, i) => `<button type="button" id="ice-step-${i}" role="tab" aria-controls="ice-step-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-step="${i}"><span class="ice-step-index">0${i + 1}</span>${glyph(s.icon)}<span>${text(s.name)}</span>${i < 3 ? '<span class="ice-step-arrow" aria-hidden="true">→</span>' : ''}</button>`).join('')}</div><div id="ice-step-panel" class="ice-step-panel" role="tabpanel" aria-labelledby="ice-step-0" tabindex="0"></div></section>
      <section class="ice-section ice-capabilities-section" id="ice-capabilities" aria-labelledby="ice-cap-title"><div class="ice-wrap"><div class="ice-section-head"><div><div class="ice-kicker">02 / ${text('企业能力')}</div><h2 id="ice-cap-title">${text('员工负责协作，')}<span>${text('能力按需接入。')}</span></h2></div><p>${text('数字员工是协作主体；模型、Skill、MCP 与业务应用，是其可使用的能力与资源。')}</p></div><div class="ice-cap-layout"><div class="ice-cap-tabs" role="tablist" aria-label="${text('选择企业能力')}">${CAPABILITIES.map((c, i) => `<button type="button" role="tab" id="ice-cap-${i}" aria-controls="ice-cap-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-capability="${i}"><span class="ice-icon-glass">${glyph(c.icon, 27)}</span><span>${text(c.name)}</span><span class="ice-cap-arrow" aria-hidden="true">↗</span></button>`).join('')}</div><div class="ice-cap-panel" id="ice-cap-panel" role="tabpanel" aria-labelledby="ice-cap-0" tabindex="0"></div></div></div></section>
      <section class="ice-section ice-wrap" id="ice-governance" aria-labelledby="ice-gov-title"><div class="ice-section-head"><div><div class="ice-kicker">03 / ${text('统一治理')}</div><h2 id="ice-gov-title">${text('让执行可控，')}<span>${text('让过程可追溯。')}</span></h2></div><p>${text('将身份、权限和记录融入协作，帮助负责人看清谁在执行、调用了什么、产生了多少用量。')}</p></div><div class="ice-gov-grid">${[
        [
          'fingerprint',
          '身份与权限',
          '以组织、角色和机器凭据限定访问范围，让数字员工带着明确的权限参与工作。',
          '组织与角色',
          '最小权限',
        ],
        [
          'fileCheck',
          '审批与审计',
          '对关键操作设置审批，保留操作与调用记录，为复核、追踪和责任归属提供依据。',
          '关键操作审批',
          '操作记录追踪',
        ],
        [
          'chart',
          '用量与成本',
          '从部门、数字员工和技能等维度查看用量与内部成本，为资源配置提供依据。',
          '用量洞察',
          '成本归集',
        ],
      ]
        .map(
          ([i, title, desc, a, b]) =>
            `<article><span class="ice-icon-glass">${glyph(i, 27)}</span><h3>${text(title)}</h3><p>${text(desc)}</p><div class="ice-tags"><span>${text(a)}</span><span>${text(b)}</span></div></article>`,
        )
        .join('')}</div></section>
      <section class="ice-final ice-wrap"><div><div class="ice-kicker">READY TO WORK TOGETHER</div><h2>${text('把下一项工作，')}<br><span>${text('交给协作的力量。')}</span></h2><p>${text('自主部署 · MIT 开源 · 插件化扩展')}</p></div><div class="ice-final-actions">${enter('进入冰晶工作台')}<a class="ice-text-link" href="https://github.com/01men/ybkkasi/blob/main/docs/deploy-enterprise.md" target="_blank" rel="noopener noreferrer">${text('阅读部署与接入指南')} ↗</a></div></section>
    </main><footer class="ice-footer ice-wrap"><span>© ${new Date().getFullYear()} ${text('杭州元冰可科技有限公司')}</span><span>${text('让数字员工与企业 AI 能力，在统一治理下协同工作。')}</span><a href="https://github.com/01men/ybkkasi" target="_blank" rel="noopener noreferrer">GitHub ↗</a></footer>
  </div>`
  rqI18n.mountSwitcher()
  const root = app.querySelector('.ice-home'),
    scene = mountCrystalScene(root.querySelector('[data-crystal-scene]'))
  const scroll = (id) =>
    root
      .querySelector(`#${id}`)
      ?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          ?.matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      })
  const menu = root.querySelector('.ice-menu'),
    nav = root.querySelector('.ice-nav')
  const closeMenu = () => {
    nav.classList.remove('is-open')
    menu.setAttribute('aria-expanded', 'false')
  }
  menu.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open')
    menu.setAttribute('aria-expanded', String(open))
  })
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      closeMenu()
      menu.focus()
    }
  })
  root.querySelectorAll('[data-home-scroll]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      scroll(a.dataset.homeScroll)
      closeMenu()
    }),
  )
  root
    .querySelectorAll('[data-enter-crystal]')
    .forEach((a) => a.addEventListener('click', () => setUiTheme('crystal')))
  const motionButton = root.querySelector('.ice-motion')
  motionButton.hidden = true
  root
    .querySelector('[data-crystal-scene]')
    .addEventListener('crystal-state', (event) => {
      motionButton.hidden =
        event.currentTarget.dataset.renderer !== 'webgl' ||
        Boolean(
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
        )
    })
  motionButton.addEventListener('click', () => {
    const paused = motionButton.getAttribute('aria-pressed') !== 'true'
    scene.setMotion(!paused)
    motionButton.setAttribute('aria-pressed', String(paused))
    motionButton.textContent = t(paused ? '播放动效' : '暂停动效')
  })
  function selectStep(index) {
    const step = STEPS[index],
      panel = root.querySelector('#ice-step-panel')
    root.querySelectorAll('[data-step]').forEach((b) => {
      const active = Number(b.dataset.step) === index
      b.setAttribute('aria-selected', String(active))
      b.tabIndex = active ? 0 : -1
    })
    panel.setAttribute('aria-labelledby', `ice-step-${index}`)
    panel.innerHTML = `<div class="ice-step-story"><span class="ice-detail-kicker">0${index + 1} / ${text(step.name)}</span><h3>${text(step.title)}</h3><p>${text(step.desc)}</p><a class="ice-text-link" href="#/${step.route}">${text('在工作台中查看')} ↗</a></div><div class="ice-scenario"><div class="ice-scenario-head"><i></i>${text(step.tag)}</div><div class="ice-scenario-row">${glyph(step.icon, 22)}<b>${text(step.input)}</b></div><div class="ice-scenario-line"></div><div class="ice-scenario-row">${glyph('fileCheck', 22)}<b>${text(step.output)}</b></div><div class="ice-scenario-foot">${glyph('users', 15)}${text(step.role)}</div></div>`
    panel
      .querySelector('a')
      .addEventListener('click', () => setUiTheme('crystal'))
    scene.focus(index)
  }
  function selectCapability(index) {
    const c = CAPABILITIES[index],
      panel = root.querySelector('#ice-cap-panel')
    root.querySelectorAll('[data-capability]').forEach((b) => {
      const active = Number(b.dataset.capability) === index
      b.setAttribute('aria-selected', String(active))
      b.tabIndex = active ? 0 : -1
    })
    panel.setAttribute('aria-labelledby', `ice-cap-${index}`)
    panel.innerHTML = `<div class="ice-detail-kicker">${text(c.name)}</div><h3>${text(c.title)}</h3><p>${text(c.desc)}</p><div class="ice-tags">${c.tags.map((tag) => `<span>${text(tag)}</span>`).join('')}</div><a class="ice-text-link" href="#/${c.route}">${text('在工作台中查看')} ↗</a><div class="ice-cap-emblem" aria-hidden="true">${icon(c.icon, 100)}</div>`
    panel
      .querySelector('a')
      .addEventListener('click', () => setUiTheme('crystal'))
    scene.focus(index)
  }
  function bindTabs(selector, key, select) {
    const buttons = [...root.querySelectorAll(selector)]
    buttons.forEach((button, i) => {
      button.addEventListener('click', () =>
        select(Number(button.dataset[key])),
      )
      button.addEventListener('keydown', (e) => {
        let index
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
          index = (i + 1) % buttons.length
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
          index = (i + buttons.length - 1) % buttons.length
        else if (e.key === 'Home') index = 0
        else if (e.key === 'End') index = buttons.length - 1
        if (index !== undefined) {
          e.preventDefault()
          select(index)
          buttons[index].focus()
        }
      })
    })
  }
  bindTabs('[data-step]', 'step', selectStep)
  bindTabs('[data-capability]', 'capability', selectCapability)
  selectStep(0)
  selectCapability(0)
  const observer = new MutationObserver(() => {
    if (!root.isConnected) disposeHome()
  })
  observer.observe(app, { childList: true })
  cleanup = () => {
    scene.destroy()
    observer.disconnect()
  }
  const section = new URLSearchParams(location.hash.split('?')[1] || '').get(
    'section',
  )
  if (['ice-workflow', 'ice-capabilities', 'ice-governance'].includes(section))
    scroll(section)
}
