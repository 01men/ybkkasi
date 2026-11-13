/**
 * 首页头部横幅：智能组织形态 · 六幕 3D 叙事（AI Native 组织的运转逻辑）。
 *
 * 由独立叙事页 intelligent-organization-3d.html（2026-11-13）融入首页 hero：
 *   - 本体层（人 / Agent）调用企业 AI 资产层完成任务；任务与 Loop 双生命周期；
 *     产出回流资产层。三原则引语逐字保留（ORG_PRINCIPLE_SCENES 测试护栏），
 *     资产清单与双生命周期为「延展 / 推演」模型，与原独立页同口径标注。
 *   - 每幕追加 tie「落到平台」桥接条：叙事概念 ↔ 元冰可 AIOS 能力面的对应，
 *     让横幅既讲运转逻辑、也讲清本产品是什么。
 *
 * 与原独立页的行为差异（首页嵌入约束）：
 *   - 不劫持滚轮 / 键盘 / 触摸——页面滚动优先；切幕只靠自动播放 + 右侧章节导航 + 播放暂停。
 *   - 标签页隐藏或横幅滚出视口即停 rAF（性能）；canvas 移出文档即退出循环（home.js 同约定）。
 *   - 文案走 i18n：t 由 home.js 注入（rqI18n.t），canvas 内文本在绘制时显式翻译
 *     （画布文本不受 DOM 翻译引擎覆盖，home.js 既有约定）。
 *   - 零依赖、零构建（纯 ESM；node 可直接 import 做数据面自证，见 org-banner.test.mjs）。
 */

/* ═══════════════ 概念模型（数据面，导出供单测自证） ═══════════════
   本体层  H 人 / A Agent ──调用──▶ 企业 AI 资产层
   资产层  KB 知识库 · SK Skill · MCP · DB 数据库 · KEY 凭证 · GPU 算力
   任务层  CREATE → DECOMPOSE → EXECUTE → VERIFY → RETAIN
   闭环层  MEASURE → PLAN → ACT → EVALUATE → FEEDBACK → 下一轮
   回流    任务产出 → 组织智能 → 资产层（可复用）
   ═════════════════════════════════════════════════════════════════ */

export const ORG_ASSETS = [
  { k: 'KB', n: '知识库', d: 'Knowledge Base', c: '#b98cff' },
  { k: 'SK', n: 'Skill', d: 'Skills / SOP', c: '#ffc46b' },
  { k: 'MCP', n: 'MCP', d: 'Tools / Protocol', c: '#7fa8ff' },
  { k: 'DB', n: '数据库', d: 'Business Data', c: '#5fd0a8' },
  { k: 'KEY', n: '凭证', d: 'Identity / Secret', c: '#ff8f9e' },
  { k: 'GPU', n: '算力', d: 'Inference', c: '#ff9a5c' },
]

export const ORG_TASK_STAGES = [
  { k: '01', n: '创建', e: 'CREATE', d: '人或 Agent 发起任务，明确目标与验收标准' },
  { k: '02', n: '拆解', e: 'DECOMPOSE', d: '拆成子任务，匹配 Builder / Seller 与可用资产' },
  { k: '03', n: '执行', e: 'EXECUTE', d: '本体调用知识库、Skill、MCP、数据库、凭证与算力' },
  { k: '04', n: '验收', e: 'VERIFY', d: '结果可衡量，未达标则回到执行阶段重试' },
  { k: '05', n: '沉淀', e: 'RETAIN', d: '过程与结果回流平台，更新知识库与 Skill' },
]

export const ORG_LOOP_STAGES = [
  { k: '01', n: '度量', e: 'MEASURE', d: '采集任务数据，把结果变成可衡量的信号' },
  { k: '02', n: '规划', e: 'PLAN', d: '人与 AI 基于信号共同决定下一轮动作' },
  { k: '03', n: '执行', e: 'ACT', d: '本体调用企业 AI 资产完成任务' },
  { k: '04', n: '评估', e: 'EVALUATE', d: '比对目标与结果，判定是否收敛' },
  { k: '05', n: '回流', e: 'FEEDBACK', d: '新知沉淀进资产层，进入下一轮 Looping' },
]

export const ORG_LEGEND = [
  ['sy-h', '人 / Human'],
  ['sy-a', 'Agent'],
  ['sy-t', '任务 / Task'],
  ['sy-l', '↻ Loop'],
  ['sy-s', '企业 AI 资产'],
]

/* 三原则引语所在幕（引语逐字保留——改动前先改测试，防止叙事被无意识稀释） */
export const ORG_PRINCIPLE_SCENES = [0, 3, 4]

/* 每幕约 16s 自动播放；6 幕一轮 ≈ 96s */
export const ORG_DURATION = 16

export const ORG_CHAPTERS = [
  {
    no: '01', rail: '边界', accent: '#4fe0d0', accent2: '#7fa8ff',
    eyebrow: 'PRINCIPLE 01 / 打破岗位边界',
    title: ['打破岗位边界', '释放组织活力'],
    lead: '<strong>岗位</strong>是工业时代的单元，<strong>任务</strong>则是智能时代的单元。未来的组织，就是一个任务的网络。岗位不会消失，但会收敛为两类。',
    chain: [['●', '人', 'key'], ['+', 'op'], ['■', 'Agent', 'key'], ['→', 'op'], ['◇', '任务', 'key'], ['→', 'op'], ['', '任务网络', 'key sm-hide']],
    chips: [
      { k: 'BUILDER', v: '创造新东西', d: '负责创造的岗位收敛' },
      { k: 'SELLER', v: '沟通与连接', d: '负责人与人之间的连接' },
    ],
    quote: '未来，组织依然存在，但组织是以任务为核心，是一张人和 Agent 协作的任务网络。',
    tie: '元冰可 AIOS 把这张任务网络装进组织：人 × Agent 各有身份与权限，协作在部门面板里发生。',
    caption: ['JOB-BOX → TASK NETWORK', '每个任务单元 = 人 × Agent × 任务'],
  },
  {
    no: '02', rail: '资产', accent: '#ffc46b', accent2: '#ff8f9e',
    eyebrow: 'EXTENSION / 延展模型 · 本体与资产',
    title: ['本体调用资产', '能力不再依附岗位'],
    lead: '<strong>人和 Agent 是行动的本体</strong>。任务不靠岗位完成，而是由本体按需调用企业 AI 资产——知识库、Skill、MCP、数据库、凭证、算力。资产可复用，组织能力才不随人流失。',
    chain: [['●', '人', 'key'], ['+', 'op'], ['■', 'Agent', 'key'], ['→', 'op'], ['', '调用', ''], ['→', 'op'], ['', '企业 AI 资产', 'key sm-hide']],
    assets: true,
    derived: '延展',
    quote: '把三原则落到运行层：本体（人 / Agent）通过调用企业 AI 资产完成任务，资产层由任务产出持续反哺，形成可累积的组织能力底座。',
    tie: '元冰可 AIOS 把 Skill、Agent、AI 应用、MCP、模型、存储统一登记为可管、可算、可审的企业 AI 资产。',
    caption: ['ACTORS → ENTERPRISE AI ASSETS', '6 ASSET CLASSES · ON-DEMAND INVOCATION'],
  },
  {
    no: '03', rail: '任务', accent: '#7fa8ff', accent2: '#4fe0d0',
    eyebrow: 'EXTENSION / 延展模型 · 任务全生命周期',
    title: ['任务的全生命周期', '从创建到沉淀'],
    lead: '任务不是一次性动作，而是一条有始有终、可追溯的链路。每个阶段都由人或 Agent 主导，并按需调用不同资产；终点的产出回流资产层，成为下一个任务的起点。',
    chain: [['●', '人', 'key'], ['+', 'op'], ['■', 'Agent', 'key'], ['→', 'op'], ['', '调用资产', ''], ['→', 'op'], ['↻', '任务 5 阶段', 'key sm-hide']],
    stages: ORG_TASK_STAGES,
    derived: '延展',
    quote: '创建 → 拆解 → 执行 → 验收 → 沉淀：任务的终点不是交付，而是把过程与结果变成可复用的组织资产。',
    tie: '任务五阶段的每一次调用，都在元冰可 AIOS 的权限边界与审计留痕之内——治理与生俱来。',
    caption: ['TASK LIFECYCLE / 5 STAGES', 'CREATE · DECOMPOSE · EXECUTE · VERIFY · RETAIN'],
  },
  {
    no: '04', rail: '知识', accent: '#b98cff', accent2: '#ffc46b',
    eyebrow: 'PRINCIPLE 02 / 沉淀隐性知识',
    title: ['沉淀隐性知识', '构建组织智能'],
    lead: '组织智能和个体能力最大的不同，就是<strong>隐性知识的显性化</strong>。任务产出回流平台，沉淀为知识库与 Skill，随时被下一个任务的本体调用。',
    chain: [['◇', '任务产出', ''], ['→', 'op'], ['', '组织智能', 'key'], ['→', 'op'], ['', '知识库 / Skill', 'key'], ['→', 'op'], ['', '下一轮调用', 'sm-hide']],
    chips: [
      { k: '01', v: '持续累积', d: '每个任务都在加厚资产层', st: 1 },
      { k: '02', v: '随时调用', d: '本体按需取用', st: 2 },
      { k: '03', v: '人人可用', d: '能力变成组织能力', st: 3 },
    ],
    quote: '真正的组织智能，是让这些知识显性化，沉淀到公司的平台上……组织智能，才是企业最深的护城河。',
    tie: '沉淀不靠自觉靠系统：产出回流、计量入库，元冰可 AIOS 让组织智能可累积、可追溯。',
    caption: ['TASK OUTPUT → PLATFORM → ASSETS', 'TACIT KNOWLEDGE MADE EXPLICIT & REUSABLE'],
  },
  {
    no: '05', rail: '闭环', accent: '#4fe0d0', accent2: '#5b8cff',
    eyebrow: 'PRINCIPLE 03 / 设计流程闭环 → Loop 全生命周期',
    title: ['设计流程闭环', '推动组织进化'],
    lead: '智能组织是一个自主进化的智能系统。人和 AI 围绕一个任务形成一个 Loop，迭代的方式叫做 <strong>Looping</strong>。一轮闭环走完，知识回流，下一轮从更高的起点开始。',
    chain: [['●', '人', 'key'], ['+', 'op'], ['■', 'AI', 'key'], ['+', 'op'], ['◇', '任务', 'key'], ['→', 'op'], ['↻', 'Loop', 'key sm-hide']],
    formula: ['可衡量', '+', 'Looping', '=', '持续进化'],
    stages: ORG_LOOP_STAGES,
    quote: '公司，就变成一个由无数 Loops 组成的、高度自动化运营的组织。组织，就变成一个不断学习和进化的系统。',
    tie: 'Looping 的前提是可衡量：审批、审计、用量计量内建于元冰可 AIOS，每一轮迭代有据可依。',
    caption: ['LOOP LIFECYCLE / 5 STAGES', 'MEASURE · PLAN · ACT · EVALUATE · FEEDBACK'],
  },
  {
    no: '06', rail: '总览', accent: '#9fd8ff', accent2: '#ffffff',
    eyebrow: 'SYNTHESIS / 三个原则，一个运行系统',
    title: ['组织依然存在', '只是换了形态'],
    lead: '以<strong>任务</strong>为单元、以<strong>企业 AI 资产</strong>为底座、以<strong>任务与 Loop 的双生命周期</strong>为运转方式 —— 组织从层级结构，变成一张持续学习、自主进化的协作网络。',
    chain: [['', '本体', 'key'], ['→', 'op'], ['', '调用资产', 'key'], ['→', 'op'], ['', '任务周期', 'key'], ['→', 'op'], ['', 'Loop 周期', 'key sm-hide']],
    chips: [
      { k: '01', v: '任务网络', d: '人 × Agent 协作' },
      { k: '02', v: '组织智能', d: '资产持续累积' },
      { k: '03', v: '持续进化', d: '可衡量 + Looping' },
    ],
    derived: '推演',
    quote: '三个原则叠加后的形态推演：组织不再是一张组织架构图，而是一套以任务为单元、以知识为底座、以 Loops 为运转方式的运行机制。',
    tie: '元冰可 AIOS · 企业 AI 运行与治理平台——把这套运转逻辑装进你的组织。',
    caption: ['ACTORS · ASSETS · TASK · LOOP', 'THE ORGANIZATION AS A LIVING SYSTEM'],
  },
]

/* 横幅壳层与首页其余部位的界面文案（供 home.js 与语言包共用同一键源） */
export const ORG_UI = {
  headTitle: '智能组织形态',
  headSub: 'THE INTELLIGENT ORGANIZATION',
  headRight: '三原则 · 任务 / Loop 全生命周期 · 企业 AI 资产',
  srH1: '元冰可 AIOS · 企业 AI 运行与治理平台——让团队的每一份 AI 资源可管、可算、可审',
  barDesc: '让这套运转逻辑落地的企业 AI 运行与治理平台',
  playTitle: '暂停 / 继续',
  treeBandCaption: '资源全景树 · 悬停叶子，查看资源从登记到调用的链路',
}

/* canvas 内出现的待翻译文案键（绘制时显式 T()，测试据此校验语言包覆盖） */
export const ORG_CANVAS_STRINGS = [
  'JOB / 岗位', '工业时代的单元',
  'ACTORS / 本体', '人 × Agent 是行动主体',
  '企业 AI 资产层 · 可复用底座',
  'PLATFORM / 组织智能', '隐性知识显性化',
  'LOOP / 人 × AI × 任务', '一轮闭环 = 一次可衡量的迭代',
  'ORGANIZATION', '本体 · 资产 · 任务 · Loop',
  '回流资产层 → 新任务', '任务产出 → 资产层',
]

/* ═══════════════ 挂载（引擎面） ═══════════════ */
export function mountOrgBanner(host, opts = {}) {
  if (!host) return
  const T = (s) => (opts.t ? opts.t(s) : s)
  const loginHref = opts.loginHref || '#/login'
  const githubHref = opts.githubHref || 'https://github.com/01men/ybkkasi'

  /* ---- 壳层 DOM ---- */
  host.classList.add('org-hero')
  host.innerHTML = `
  <div class="org-scrim"></div><div class="org-noise"></div>
  <canvas class="org-canvas"></canvas>
  <h1 class="org-sr">${T(ORG_UI.srH1)}</h1>
  <div class="org-head">
    <div class="org-brand">
      <div class="org-mark"><i></i><i></i><i></i><b></b></div>
      <div><div class="org-brand-cn">${T(ORG_UI.headTitle)}</div><div class="org-brand-en">${ORG_UI.headSub}</div></div>
    </div>
    <div class="org-head-right">${T(ORG_UI.headRight)}<br><span class="org-state">AUTOPLAY / 01</span></div>
  </div>
  <nav class="org-rail" aria-label="${T(ORG_UI.headTitle)}"></nav>
  <main class="org-panel"></main>
  <div class="org-caption"></div>
  <footer class="org-bar">
    <a class="org-bar-brand" href="#/home">
      <img src="ybk-mark.png" alt="">
      <div><b>元冰可 AIOS</b><span>${T(ORG_UI.barDesc)}</span></div>
    </a>
    <button class="org-play" title="${T(ORG_UI.playTitle)}" aria-label="${T(ORG_UI.playTitle)}">❚❚</button>
    <div class="org-progress"><i></i></div>
    <div class="org-bar-cta" id="org-bar-cta">
      <a class="home-btn home-btn-green org-cta" href="${loginHref}">${opts.loginLabel || T('登录控制台')}</a>
      <a class="home-btn home-btn-ghost org-cta" href="${githubHref}" target="_blank" rel="noopener">${T('GitHub 源码 · MIT')}</a>
    </div>
  </footer>`

  const cvs = host.querySelector('.org-canvas')
  const panel = host.querySelector('.org-panel')
  const rail = host.querySelector('.org-rail')
  const caption = host.querySelector('.org-caption')
  const bar = host.querySelector('.org-progress i')
  const playBtn = host.querySelector('.org-play')
  const hdrState = host.querySelector('.org-state')

  /* canvas 缺席守卫（headless/jsdom 或 canvas 被禁用）：壳层结构照常在，特效静默缺席 */
  const ctx = cvs.getContext ? cvs.getContext('2d') : null
  if (!ctx) return

  /* ---- 基础设施（尺寸取横幅容器而非窗口；其余与原独立页一致） ---- */
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, GS = 1
  const C = { cyan: '#4fe0d0', blue: '#5b8cff', lblue: '#7fa8ff', pink: '#ff6fa5', gold: '#ffc46b', violet: '#b98cff', white: '#dce9ff', steel: '#6b86b5' }
  const TAU = 6.283185
  const DURATION = ORG_DURATION
  const FONT_M = '"SFMono-Regular",Consolas,Menlo,monospace'
  const FONT_S = '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
  const sm = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u) }
  const lp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u })
  let seed = 20261113
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }

  const hexrgb = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
  const sprites = {}
  function sprite(col) {
    if (sprites[col]) return sprites[col]
    const cv = document.createElement('canvas'); cv.width = cv.height = 64
    const g = cv.getContext('2d'), [r, gg, b] = hexrgb(col)
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.14, `rgba(${r},${gg},${b},.92)`)
    gr.addColorStop(.38, `rgba(${r},${gg},${b},.30)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return sprites[col] = cv
  }
  const dot = (x, y, r, col, a) => { if (a <= .004 || r <= 0) return; ctx.globalAlpha = clamp(a, 0, 1); ctx.drawImage(sprite(col), x - r * 2.3, y - r * 2.3, r * 4.6, r * 4.6); ctx.globalAlpha = 1 }
  const seg = (a, b, col, w, al) => { if (al <= .004) return; ctx.globalAlpha = clamp(al, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1 }
  const rot = (p, rx, ry) => {
    const c1 = Math.cos(ry), s1 = Math.sin(ry), x = p.x * c1 - p.z * s1, z = p.x * s1 + p.z * c1
    const c2 = Math.cos(rx), s2 = Math.sin(rx)
    return { x, y: p.y * c2 - z * s2, z: p.y * s2 + z * c2 }
  }
  const proj = (p, rx, ry) => {
    const q = rot(p, rx, ry), k = (760 / (760 + q.z * .82)) * GS * (W < 900 ? .48 : 1)
    return { x: cx + q.x * k, y: cy + q.y * k, k, z: q.z }
  }
  const diamond = (p, s, col, a, w) => {
    ctx.globalAlpha = clamp(a, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = w || 1.1
    ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath(); ctx.stroke()
    ctx.globalAlpha = 1
  }
  const hexagon = (p, s, col, a, fill) => {
    ctx.globalAlpha = clamp(a, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < 6; i++) { const q = i / 6 * TAU - Math.PI / 2, x = p.x + Math.cos(q) * s, y = p.y + Math.sin(q) * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
    ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill() } ctx.stroke(); ctx.globalAlpha = 1
  }
  const arrow = (p1, p2, col, a, s) => {
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), z = s || 4
    ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = col; ctx.beginPath()
    ctx.moveTo(p2.x, p2.y)
    ctx.lineTo(p2.x - Math.cos(ang - .48) * z * 2.1, p2.y - Math.sin(ang - .48) * z * 2.1)
    ctx.lineTo(p2.x - Math.cos(ang + .48) * z * 2.1, p2.y - Math.sin(ang + .48) * z * 2.1)
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1
  }
  const labels = [], glyphs = []
  const label = (p, txt, col, sub) => { if (W >= 900) labels.push({ p, txt, col, sub }) }
  const glyph = (x, y, txt, col, a, size, bg) => { if (W >= 900) glyphs.push({ x, y, txt, col, a, s: size || 9, bg: !!bg }) }
  function flushLabels(al) {
    ctx.globalCompositeOperation = 'source-over'; ctx.textBaseline = 'middle'
    for (const L of labels) {
      const x = L.p.x + 12, y = L.p.y - 4
      ctx.globalAlpha = al * .9; ctx.font = '600 10.5px ' + FONT_M; ctx.fillStyle = L.col; ctx.fillText(L.txt, x, y - 7)
      if (L.sub) { ctx.globalAlpha = al * .45; ctx.font = '10px ' + FONT_S; ctx.fillStyle = '#aebbd0'; ctx.fillText(L.sub, x, y + 9) }
      ctx.globalAlpha = al * .28; ctx.strokeStyle = L.col; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(L.p.x + 3, L.p.y - 2); ctx.lineTo(x - 4, y - 5); ctx.stroke()
    }
    for (const G of glyphs) {
      ctx.font = '600 ' + G.s + 'px ' + FONT_M
      if (G.bg) {
        ctx.globalAlpha = clamp(al * G.a * .7, 0, 1); ctx.fillStyle = 'rgba(5,8,14,.82)'
        ctx.fillRect(G.x - 2, G.y - G.s * .64, ctx.measureText(G.txt).width + 4, G.s * 1.3)
      }
      ctx.globalAlpha = clamp(al * G.a, 0, 1); ctx.fillStyle = G.col; ctx.fillText(G.txt, G.x, G.y)
    }
    labels.length = 0; glyphs.length = 0; ctx.globalAlpha = 1
  }

  /* ---- 通用概念图元：cell = 人 H × Agent A 围绕任务核心 T 的最小协作单元 ---- */
  function cell(c3, R, rx, ry, t, ph, A, opt) {
    opt = opt || {}; const tilt = opt.tilt || .62, N = 18
    const cc = proj(c3, rx, ry)
    const orbit = (a) => proj({ x: c3.x + Math.cos(a) * R, y: c3.y + Math.sin(a) * R * Math.cos(tilt), z: c3.z + Math.sin(a) * R * Math.sin(tilt) }, rx, ry)
    for (let i = 0; i < N; i++) seg(orbit(i / N * TAU), orbit((i + 1) / N * TAU), C.cyan, 1, A * .42)
    const a0 = t * .55 + ph, a1 = orbit(a0), a2 = orbit(a0 + .2)
    arrow(a1, a2, C.white, A * .9, 3.8)
    const h = t * .38 + ph, Hp = orbit(h), Gp = orbit(h + Math.PI)
    seg(Hp, cc, C.cyan, 1, A * .48); seg(Gp, cc, C.lblue, 1, A * .48)
    const s = opt.core || 9
    dot(cc.x, cc.y, s * 2.2, C.gold, A * .3)
    diamond(cc, s, C.gold, A, 1.5); diamond(cc, s * .45, C.white, A * .7, 1)
    dot(cc.x, cc.y, 3.4, C.white, A)
    dot(Hp.x, Hp.y, 4.4, C.cyan, A)
    ctx.globalAlpha = A * .85; ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(Hp.x, Hp.y, 7.5, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1
    ctx.globalAlpha = A; ctx.strokeStyle = C.lblue; ctx.lineWidth = 1.5
    ctx.strokeRect(Gp.x - 5, Gp.y - 5, 10, 10); ctx.fillStyle = 'rgba(127,168,255,.22)'; ctx.fillRect(Gp.x - 5, Gp.y - 5, 10, 10); ctx.globalAlpha = 1
    dot(Gp.x, Gp.y, 2.2, C.lblue, A * .9)
    glyph(Hp.x + 10, Hp.y - 10, 'H', C.cyan, A, 10, true)
    glyph(Gp.x + 10, Gp.y - 10, 'A', C.lblue, A, 10, true)
    if (opt.id) glyph(cc.x + s + 5, cc.y + 1, opt.id, C.gold, A, 10, true)
    return cc
  }
  function assetNode(p, ast, A, active) {
    const s = active ? 20 : 15
    hexagon(p, s, ast.c, A * (active ? 1 : .72), active ? 'rgba(185,140,255,.12)' : null)
    dot(p.x, p.y, active ? 5.5 : 3.4, ast.c, A * (active ? 1 : .75))
    if (active) {
      ctx.globalAlpha = A * .5; ctx.strokeStyle = ast.c; ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.arc(p.x, p.y, s + 8, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1
    }
    glyph(p.x + 17, p.y - 7, ast.k, ast.c, A, 11, true)
    glyph(p.x + 17, p.y + 8, T(ast.n), '#c2cee2', A * .85, 10, true)
  }
  const assetPos = (i, R, y, a0) => { const a = a0 + i / 6 * TAU; return { x: Math.cos(a) * R, y: y + Math.sin(a) * R * .2, z: Math.sin(a) * R } }
  function loopRing(center, R, rx, ry, t, A, opt) {
    opt = opt || {}; const N = opt.n || 36, tilt = opt.tilt || .52
    const pt = (a, scale) => proj({
      x: center.x + Math.cos(a) * R * scale,
      y: center.y + Math.sin(a) * R * scale * Math.cos(tilt),
      z: center.z + Math.sin(a) * R * scale * Math.sin(tilt),
    }, rx, ry)
    const echoes = opt.echoes || 0
    for (let e = echoes; e >= 1; e--) {
      const sc = 1 + e * .055, al = A * (.20 - e * .032)
      for (let i = 0; i < N; i++) seg(pt(i / N * TAU, sc), pt((i + 1) / N * TAU, sc), e % 2 ? C.blue : C.cyan, .8, al)
    }
    for (let i = 0; i < N; i++) seg(pt(i / N * TAU, 1), pt((i + 1) / N * TAU, 1), i % 3 ? C.cyan : C.blue, 1, A * (opt.line || .42))
    for (let q = 0; q < 4; q++) {
      const a = q / 4 * TAU + t * .06
      arrow(pt(a - .09, 1), pt(a, 1), C.white, A * .8, 4)
    }
    return pt
  }

  /* ---- 场景数据（确定性随机，与原独立页同种子） ---- */
  const S1 = (() => {
    const cubes = [], net = [], edges = []
    ;[-330, -110, 110, 330].forEach((x) => [-170, 0, 170].forEach((y) => [-130, 130].forEach((z) => cubes.push({ x, y, z, s: 44 }))))
    const cellPos = [
      { x: -300, y: -130, z: 70 }, { x: -80, y: -200, z: -50 }, { x: 170, y: -90, z: 120 },
      { x: 320, y: 70, z: -40 }, { x: -190, y: 175, z: 100 }, { x: 110, y: 195, z: -90 },
    ]
    cellPos.forEach((p, i) => net.push({ from: cubes[i * 4], to: p, cell: i, id: 'T-0' + (i + 1) }))
    for (let i = 6; i < 24; i++) {
      const a = rnd() * TAU, rr = 120 + rnd() * 175
      net.push({ from: cubes[i], to: { x: Math.cos(a) * rr * 1.3, y: Math.sin(a) * rr * .85, z: (rnd() - .5) * 260 }, agent: i % 3 === 0 })
    }
    net.forEach((n, i) => {
      const d = net.map((m, j) => ({ j, d: Math.hypot(n.to.x - m.to.x, n.to.y - m.to.y, n.to.z - m.to.z) }))
        .filter((o) => o.j !== i).sort((a, b) => a.d - b.d)
      for (let k = 0; k < 2; k++) if (i < d[k].j) edges.push([i, d[k].j])
    })
    const hubs = [
      { p: { x: -240, y: -265, z: 140 }, t: 'BUILDER', s: '创造新东西', c: C.cyan },
      { p: { x: 335, y: 210, z: -110 }, t: 'SELLER', s: '沟通与连接', c: C.pink },
    ]
    return { cubes, net, edges, hubs }
  })()
  const CUBE_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  const cubeVerts = (c, s) => { const h = s / 2; return [
    { x: c.x - h, y: c.y - h, z: c.z - h }, { x: c.x + h, y: c.y - h, z: c.z - h }, { x: c.x + h, y: c.y + h, z: c.z - h }, { x: c.x - h, y: c.y + h, z: c.z - h },
    { x: c.x - h, y: c.y - h, z: c.z + h }, { x: c.x + h, y: c.y - h, z: c.z + h }, { x: c.x + h, y: c.y + h, z: c.z + h }, { x: c.x - h, y: c.y + h, z: c.z + h },
  ] }

  const ICO = (() => {
    const P = (1 + Math.sqrt(5)) / 2, R = 175
    const raw = [[-1, P, 0], [1, P, 0], [-1, -P, 0], [1, -P, 0], [0, -1, P], [0, 1, P], [0, -1, -P], [0, 1, -P], [P, 0, -1], [P, 0, 1], [-P, 0, -1], [-P, 0, 1]]
    const v = raw.map((a) => { const l = Math.hypot(a[0], a[1], a[2]); return { x: a[0] / l * R, y: a[1] / l * R, z: a[2] / l * R } })
    const e = []
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      if (Math.hypot(v[i].x - v[j].x, v[i].y - v[j].y, v[i].z - v[j].z) < R * 1.2) e.push([i, j])
    }
    return { v, e }
  })()
  const S2 = (() => {
    const motes = []
    for (let i = 0; i < 72; i++) {
      const a = rnd() * TAU, r = 300 + rnd() * 250, tv = ICO.v[Math.floor(rnd() * ICO.v.length)]
      motes.push({
        from: { x: Math.cos(a) * r * 1.2, y: (rnd() - .5) * 480, z: Math.sin(a) * r * .85 },
        to: { x: tv.x * .8, y: tv.y * .8, z: tv.z * .8 }, delay: rnd() * 1.5, ph: rnd() * TAU, w: 30 + rnd() * 40,
      })
    }
    return { motes }
  })()
  const S3 = (() => {
    const pts = []
    for (let i = 0; i < 5; i++) {
      const a = i / 4 * Math.PI * 1.7
      pts.push({ x: -330 + i * 165, y: 175 - i * 88, z: Math.sin(a) * 115 })
    }
    return { pts }
  })()
  const S5 = (() => {
    const subs = []
    for (let j = 0; j < 6; j++) {
      const a = j / 6 * TAU
      subs.push({ cx: Math.cos(a) * 330, cy: Math.sin(a) * 205, cz: Math.sin(a * 1.4) * 190, r: 58 + rnd() * 20, ph: rnd() * TAU, tilt: .5 + rnd() * 1.2, sp: .5 + rnd() * .5 })
    }
    return { subs }
  })()
  const S6 = (() => {
    const nodes = [], edges = []
    for (let i = 0; i < 20; i++) {
      const a = rnd() * TAU, e = Math.acos(2 * rnd() - 1)
      nodes.push({ x: Math.sin(e) * Math.cos(a) * 280, y: Math.sin(e) * Math.sin(a) * 225, z: Math.cos(e) * 225, cell: i % 5 === 0 })
    }
    nodes.forEach((n, i) => {
      const d = nodes.map((m, j) => ({ j, d: Math.hypot(n.x - m.x, n.y - m.y, n.z - m.z) })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d)
      if (i < d[0].j) edges.push([i, d[0].j]); if (i < d[1].j) edges.push([i, d[1].j])
    })
    return { nodes, edges }
  })()

  const stars = Array.from({ length: 120 }, () => ({ x: rnd(), y: rnd(), r: .4 + rnd() * 1.1, ph: rnd() * TAU }))
  let mx = 0, my = 0, tmx = 0, tmy = 0, STAGE = -1

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1)
    W = host.clientWidth; H = host.clientHeight
    cvs.width = W * DPR; cvs.height = H * DPR
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px'
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    cx = W < 900 ? W * .5 : W * .655
    cy = W < 900 ? H * .245 : H * .5
  }
  window.addEventListener('resize', resize)
  resize()

  function backdrop(t) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .62)
    g.addColorStop(0, 'rgba(22,38,66,.4)'); g.addColorStop(.55, 'rgba(9,15,28,.2)'); g.addColorStop(1, 'rgba(5,7,12,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    for (const s of stars) {
      ctx.globalAlpha = .09 + .15 * (.5 + .5 * Math.sin(t * .7 + s.ph)); ctx.fillStyle = '#8fb4e8'
      ctx.beginPath(); ctx.arc(s.x * W + mx * 8, s.y * H + my * 8, s.r, 0, TAU); ctx.fill()
    }
    ctx.globalAlpha = 1
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(110,150,210,.07)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.ellipse(cx, cy, (185 + i * 140) * GS, (60 + i * 46) * GS, mx * .06, 0, TAU); ctx.stroke()
    }
  }
  const ROT_BASE = [[-.16, .34], [-.22, .30], [.12, .42], [-.10, .48], [.24, .28], [-.18, .36]]
  const viewRot = (i, t) => {
    const base = ROT_BASE[i] || ROT_BASE[0]
    return { rx: base[0] + my * .14 + (reduced ? 0 : Math.sin(t * .17) * .04), ry: base[1] + mx * .26 + (reduced ? 0 : t * .05) }
  }

  /* ---- 六幕绘制（与原独立页逐幕对应；canvas 文案绘制时 T() 翻译） ---- */
  function scene1(A, t, rx, ry) {
    const u = sm(0, 1, t / 4.4), eOut = 1 - sm(.02, .52, u), eIn = sm(.12, .7, u)
    if (eOut > .01) {
      S1.cubes.forEach((c) => {
        const s = c.s + u * 18, v = cubeVerts({ x: c.x * (1 + u * .12), y: c.y * (1 + u * .12), z: c.z }, s).map((p) => proj(p, rx, ry))
        CUBE_E.forEach(([a, b]) => seg(v[a], v[b], C.steel, 1, A * eOut * .3))
        const p = proj({ x: c.x * (1 + u * .12), y: c.y * (1 + u * .12), z: c.z }, rx, ry); dot(p.x, p.y, 2.2, C.steel, A * eOut * .45)
      })
      label(proj({ x: -330, y: -215, z: 160 }, rx, ry), T('JOB / 岗位'), '#8fa6c8', T('工业时代的单元'))
    }
    const pts = S1.net.map((n) => {
      const k = sm(.05, .92, clamp(u * 1.15 - .05, 0, 1)), p = lp(n.from, n.to, k)
      p.x += Math.sin(t * .7 + n.to.z * .01) * 6 * k; p.y += Math.cos(t * .55 + n.to.x * .01) * 6 * k
      return proj(p, rx, ry)
    })
    S1.edges.forEach(([a, b], i) => {
      seg(pts[a], pts[b], C.cyan, 1, A * eIn * (.30 + .14 * Math.sin(t * .9 + i * .4)))
      if (!reduced) { const q = (t * .3 + i * .137) % 1; dot(pts[a].x + (pts[b].x - pts[a].x) * q, pts[a].y + (pts[b].y - pts[a].y) * q, 1.6, C.white, A * eIn * .5) }
    })
    S1.net.forEach((n, i) => {
      if (n.cell !== undefined) return
      const p = pts[i]
      if (n.agent) { ctx.globalAlpha = A * eIn * .8; ctx.strokeStyle = C.lblue; ctx.lineWidth = 1; ctx.strokeRect(p.x - 3, p.y - 3, 6, 6); ctx.globalAlpha = 1 }
      else dot(p.x, p.y, 2.9, C.cyan, A * eIn * .85)
    })
    const cu = sm(.5, 1, u)
    if (cu > .01) S1.net.forEach((n) => { if (n.cell !== undefined) cell(n.to, 31, rx, ry, t, n.cell * 1.1, A * cu, { id: n.id, core: 9 }) })
    const hu = sm(.55, 1, u)
    if (hu > .01) S1.hubs.forEach((h) => {
      const p = proj(h.p, rx, ry)
      const near = S1.net.map((n, j) => ({ j, d: Math.hypot(n.to.x - h.p.x, n.to.y - h.p.y) })).sort((a, b) => a.d - b.d).slice(0, 4)
      near.forEach((o) => seg(p, pts[o.j], h.c, .8, A * hu * .3))
      ctx.globalAlpha = A * hu * .55; ctx.strokeStyle = h.c; ctx.lineWidth = 1
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 14, 14, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1
      dot(p.x, p.y, 4.5, h.c, A * hu); label(p, h.t, h.c, T(h.s))
    })
  }

  /* 幕 2：本体在上、资产层在下，调用光线双向流动 */
  function scene2(A, t, rx, ry) {
    const u = sm(0, 1, t / 3.4)
    const body = { x: 0, y: -145, z: 0 }
    const bp = proj(body, rx, ry)
    const ringPts = []
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * TAU
      ringPts.push(proj({ x: Math.cos(a) * 268, y: 140, z: Math.sin(a) * 268 }, rx, ry))
    }
    for (let i = 0; i < 48; i++) seg(ringPts[i], ringPts[i + 1], C.violet, .9, A * u * .24)
    cell(body, 100, rx, ry, t, 0, A * u, { core: 15, id: 'T-01', tilt: .42 })
    label(proj({ x: -235, y: -250, z: 60 }, rx, ry), T('ACTORS / 本体'), '#8fd8ff', T('人 × Agent 是行动主体'))
    label(proj({ x: 0, y: 225, z: 0 }, rx, ry), 'ENTERPRISE AI ASSETS', '#c9a9ff', T('企业 AI 资产层 · 可复用底座'))
    const active = Math.floor(t / 1.35) % 6
    ORG_ASSETS.forEach((ast, i) => {
      const p3 = assetPos(i, 268, 140, t * .055), p = proj(p3, rx, ry)
      const on = i === active
      seg(bp, p, ast.c, on ? 1.6 : 1, A * u * (on ? .68 : .26))
      if (!reduced) {
        const q = (t * .55 + i * .16) % 1
        dot(bp.x + (p.x - bp.x) * q, bp.y + (p.y - bp.y) * q, on ? 4 : 2.5, C.white, A * u * (on ? 1 : .65))
        const q2 = 1 - ((t * .42 + i * .21) % 1)
        dot(bp.x + (p.x - bp.x) * q2, bp.y + (p.y - bp.y) * q2, 2.2, ast.c, A * u * .55)
      }
      assetNode(p, ast, A * u, on)
    })
  }

  /* 幕 3：任务全生命周期——螺旋上升的 5 个阶段 */
  function scene3(A, t, rx, ry) {
    const u = sm(0, 1, t / 2.4)
    const P = S3.pts.map((p) => proj(p, rx, ry))
    for (let s = 0; s < 4; s++) for (let k = 0; k < 12; k++) {
      const a = k / 12, b = (k + 1) / 12
      const p1 = { x: P[s].x + (P[s + 1].x - P[s].x) * a, y: P[s].y + (P[s + 1].y - P[s].y) * a }
      const p2 = { x: P[s].x + (P[s + 1].x - P[s].x) * b, y: P[s].y + (P[s + 1].y - P[s].y) * b }
      seg(p1, p2, C.lblue, 1.2, A * u * (.40 + s * .06))
    }
    for (let s = 0; s < 4; s++) arrow(P[s], P[s + 1], C.white, A * u * .75, 3.6)
    const st = STAGE < 0 ? 0 : STAGE
    ORG_TASK_STAGES.forEach((sg, i) => {
      const p = P[i], on = i === st
      hexagon(p, on ? 21 : 15, on ? C.gold : C.steel, A * u * (on ? 1 : .65), on ? 'rgba(255,196,107,.10)' : null)
      dot(p.x, p.y, on ? 6 : 3.6, on ? C.gold : C.lblue, A * u * (on ? 1 : .8))
      if (on) {
        ctx.globalAlpha = A * u * .55; ctx.strokeStyle = C.gold; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.arc(p.x, p.y, 29 + Math.sin(t * 2) * 2, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1
      }
      glyph(p.x - 8, p.y - 30, sg.e, on ? C.gold : '#9aa9c2', A * u * (on ? 1 : .8), 10, true)
      glyph(p.x - 8, p.y + 29, T(sg.n), on ? C.white : '#9aa9c2', A * u * (on ? 1 : .75), 11, true)
      if (on) {
        const hp = { x: p.x - 34, y: p.y - 17 }, ap = { x: p.x - 34, y: p.y + 17 }
        dot(hp.x, hp.y, 3.6, C.cyan, A); hexagon(hp, 6, C.cyan, A * .85); glyph(hp.x - 15, hp.y, 'H', C.cyan, A, 10, true)
        ctx.globalAlpha = A; ctx.strokeStyle = C.lblue; ctx.lineWidth = 1.3; ctx.strokeRect(ap.x - 4, ap.y - 4, 8, 8); ctx.globalAlpha = 1
        glyph(ap.x - 16, ap.y, 'A', C.lblue, A, 10, true)
        const ast = ORG_ASSETS[(i * 2) % 6], ast2 = ORG_ASSETS[(i * 2 + 1) % 6]
        hexagon({ x: p.x + 34, y: p.y - 14 }, 7, ast.c, A * .85); glyph(p.x + 44, p.y - 14, ast.k, ast.c, A, 9, true)
        hexagon({ x: p.x + 34, y: p.y + 14 }, 7, ast2.c, A * .85); glyph(p.x + 44, p.y + 14, ast2.k, ast2.c, A, 9, true)
      }
    })
    if (!reduced) {
      const f = (t / 2.7) % 5, i = Math.min(4, Math.floor(f)), q = f - i
      const p = { x: P[i].x + (P[Math.min(4, i + 1)].x - P[i].x) * q, y: P[i].y + (P[Math.min(4, i + 1)].y - P[i].y) * q }
      dot(p.x, p.y, 7, C.white, A * u); dot(p.x, p.y, 3.5, C.gold, A * u)
    }
    const back = proj({ x: 0, y: 255, z: -40 }, rx, ry)
    seg(P[4], back, C.violet, 1, A * u * .32); seg(back, P[0], C.violet, 1, A * u * .32)
    arrow(back, P[0], C.violet, A * u * .7, 3.8)
    hexagon(back, 15, C.violet, A * u * .8)
    dot(back.x, back.y, 3.5, C.violet, A * u * .9)
    glyph(back.x - 46, back.y + 26, T('回流资产层 → 新任务'), '#c2a9f0', A * u, 10, true)
  }

  /* 幕 4：任务产出 → 平台晶体 → 资产层 */
  function scene4(A, t, rx, ry) {
    let acc = 0
    S2.motes.forEach((m, i) => {
      const k = sm(0, 1, clamp((t - m.delay) / 3.3, 0, 1)); acc += k
      const p0 = lp(m.from, m.to, k), w = Math.sin(Math.PI * k) * m.w * (1 - k * .35)
      p0.x += Math.sin(t * 1.1 + m.ph + k * 7) * w; p0.y += Math.cos(t * .9 + m.ph + k * 6) * w * .7
      const p = proj(p0, rx, ry), col = i % 5 === 0 ? C.violet : C.gold
      dot(p.x, p.y, 2 + k * 1.6, col, A * (.4 + .5 * k) * (1 - k * .25))
    })
    acc /= S2.motes.length
    const lit = sm(.18, .95, acc)
    const vp = ICO.v.map((v) => proj(v, rx, ry))
    ICO.e.forEach(([a, b], i) => seg(vp[a], vp[b], i % 3 === 0 ? C.violet : C.gold, 1, A * lit * (.28 + .24 * Math.sin(t * 1.2 + i * .3))))
    vp.forEach((p, i) => dot(p.x, p.y, 3.2, i % 3 === 0 ? C.violet : C.gold, A * lit * .75))
    const core = proj({ x: 0, y: 0, z: 0 }, rx, ry)
    dot(core.x, core.y, 14 + Math.sin(t * 1.6) * 3, C.violet, A * lit * .45); dot(core.x, core.y, 5, C.white, A * lit * .8)
    label(proj({ x: 0, y: -205, z: 0 }, rx, ry), T('PLATFORM / 组织智能'), '#c9a9ff', T('隐性知识显性化'))
    const src = sm(.4, 2.6, t)
    if (src > .01) for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, p3 = { x: Math.cos(a) * 360, y: -110, z: Math.sin(a) * 250 }
      cell(p3, 24, rx, ry, t, i * 1.3, A * src * .8, { core: 7 })
      const p = proj(p3, rx, ry); seg(p, core, C.gold, 1, A * src * .24)
    }
    const back = sm(4, 6.2, t)
    if (back > .01) ORG_ASSETS.forEach((ast, i) => {
      const p = proj(assetPos(i, 300, 150, t * .04), rx, ry)
      seg(core, p, ast.c, 1, A * back * .34)
      if (!reduced) { const q = (t * .45 + i * .17) % 1; dot(core.x + (p.x - core.x) * q, core.y + (p.y - core.y) * q, 2.2, C.white, A * back * .7) }
      assetNode(p, ast, A * back * .8, i === Math.floor(t / 1.2) % 6)
    })
  }

  /* 幕 5：Loop 全生命周期——5 阶段闭环 + 迭代残影 + 无数 Loops */
  function scene5(A, t, rx, ry) {
    const u = sm(0, 1, t / 3.4)
    GS *= 1 + sm(4, 12, t) * .07
    const center = { x: 0, y: 0, z: 0 }
    const R = 225
    const pt = loopRing(center, R, rx, ry, t, A * u, { n: 40, tilt: .5, line: .68, echoes: Math.min(4, Math.floor(t / 3.2)) })
    const st = STAGE < 0 ? 0 : STAGE
    ORG_LOOP_STAGES.forEach((sg, i) => {
      const a = i / 5 * TAU - Math.PI / 2, p = pt(a, 1), on = i === st
      hexagon(p, on ? 20 : 14, on ? C.gold : C.cyan, A * u * (on ? 1 : .7), on ? 'rgba(255,196,107,.11)' : null)
      dot(p.x, p.y, on ? 5.5 : 3.2, on ? C.gold : C.cyan, A * u * (on ? 1 : .85))
      glyph(p.x - 12, p.y - 28, sg.e, on ? C.gold : '#9aa9c2', A * u * (on ? 1 : .8), 10, true)
      glyph(p.x - 9, p.y + 27, T(sg.n), on ? C.white : '#9aa9c2', A * u * (on ? 1 : .75), 11, true)
    })
    cell(center, 82, rx, ry, t, 0, A * u, { core: 15, id: 'T-LOOP', tilt: .5 })
    label(proj({ x: 0, y: -290, z: 0 }, rx, ry), T('LOOP / 人 × AI × 任务'), '#8fd8ff', T('一轮闭环 = 一次可衡量的迭代'))
    if (!reduced) {
      const f = (t * .32) % 1
      for (let k = 0; k < 9; k++) {
        const a = (f - k * .012) * TAU, p = pt(a, 1)
        dot(p.x, p.y, 3.2 - k * .24, C.white, A * u * (.85 - k * .085))
      }
    }
    const multi = sm(3.4, 6, t), mob = W < 900 ? .68 : 1
    if (multi > .01) S5.subs.forEach((s, j) => {
      if (W < 900 && j % 2) return // 窄屏减少小 Loop 数量，避免信息挤压
      const c = { x: s.cx * mob, y: s.cy * mob, z: s.cz * mob }
      const sub = (a) => proj({
        x: c.x + Math.cos(a) * s.r,
        y: c.y + Math.sin(a) * s.r * Math.cos(s.tilt),
        z: c.z + Math.sin(a) * s.r * Math.sin(s.tilt),
      }, rx, ry)
      for (let i = 0; i < 14; i++) seg(sub(i / 14 * TAU + t * s.sp), sub((i + 1) / 14 * TAU + t * s.sp), j % 2 ? C.blue : C.cyan, 1, A * multi * .58)
      arrow(sub(.7 + t * s.sp), sub(.95 + t * s.sp), C.white, A * multi * .8, 3.2)
      cell(c, s.r * .46, rx, ry, t, s.ph, A * multi * .9, { core: 6, tilt: s.tilt })
    })
  }

  /* 幕 6：全系统合成 */
  function scene6(A, t, rx, ry) {
    GS *= .93
    const vp = ICO.v.map((v) => proj({ x: v.x * .48, y: v.y * .48, z: v.z * .48 }, rx, ry))
    ICO.e.forEach(([a, b], i) => seg(vp[a], vp[b], C.violet, 1, A * (.26 + .12 * Math.sin(t + i * .4))))
    dot(cx, cy, 14, C.violet, A * .4); dot(cx, cy, 4.5, C.white, A * .75)
    const ap = ORG_ASSETS.map((ast, i) => proj(assetPos(i, 180, 0, t * .05), rx, ry))
    ORG_ASSETS.forEach((ast, i) => { seg({ x: cx, y: cy }, ap[i], ast.c, 1, A * .26); hexagon(ap[i], 11, ast.c, A * .75); glyph(ap[i].x + 13, ap[i].y - 4, ast.k, ast.c, A, 9, true) })
    const np = S6.nodes.map((n) => proj(n, rx, ry))
    S6.edges.forEach(([a, b]) => seg(np[a], np[b], C.cyan, 1, A * .34))
    S6.nodes.forEach((n, i) => {
      if (n.cell) { cell(n, 24, rx, ry, t, i * .7, A * .8, { core: 7 }); return }
      dot(np[i].x, np[i].y, 3, C.cyan, A * .75)
    })
    loopRing({ x: 0, y: 0, z: 0 }, 300, rx, ry, t, A * .65, { n: 32, tilt: .62, line: .4 })
    loopRing({ x: 0, y: 0, z: 0 }, 245, rx, ry, -t * .7, A * .6, { n: 32, tilt: -.4, line: .34 })
    const back = proj({ x: 0, y: -330, z: 0 }, rx, ry)
    const from = proj({ x: 330, y: 210, z: 0 }, rx, ry)
    seg(from, back, C.violet, 1, A * .2); seg(back, { x: cx, y: cy }, C.violet, 1, A * .2)
    arrow(back, { x: cx, y: cy }, C.violet, A * .5, 3.5)
    glyph(back.x - 40, back.y - 12, T('任务产出 → 资产层'), C.violet, A * .8, 9)
    label(proj({ x: 0, y: -215, z: 0 }, rx, ry), 'ORGANIZATION', '#9fd8ff', T('本体 · 资产 · 任务 · Loop'))
  }

  const SCENES = [scene1, scene2, scene3, scene4, scene5, scene6]

  /* ---- 界面（章节面板 / 章节导航 / 播放控制） ---- */
  let current = 0, prev = -1, prevT = 0, mixStart = 0, sceneT = 0
  let playing = !reduced, last = performance.now(), lastStage = -2

  function renderPanel(i) {
    const ch = ORG_CHAPTERS[i]
    host.style.setProperty('--org-accent', ch.accent)
    host.style.setProperty('--org-accent2', ch.accent2)
    let h = `<div class="org-eyebrow"><s></s>${T(ch.eyebrow)}</div>`
    h += `<h2 class="org-title">${T(ch.title[0])}<em>${T(ch.title[1])}</em></h2>`
    h += `<p class="org-lead">${T(ch.lead)}</p>`
    if (ch.chain) {
      h += '<div class="org-chain">'
      ch.chain.forEach((c) => {
        if (c[1] === 'op') h += `<span class="op">${c[0]}</span>`
        else h += `<span class="nd ${c[2] || ''}"><span class="mini">${c[0]}</span>${T(c[1])}</span>`
      })
      h += '</div>'
    }
    if (ch.assets) {
      h += '<div class="org-assets">' + ORG_ASSETS.map((a) =>
        `<div class="org-asset" style="--c:${a.c}"><b style="color:${a.c}">${a.k}</b><span>${T(a.n)}</span><i>${a.d}</i></div>`).join('') + '</div>'
    }
    if (ch.formula) {
      h += '<div class="org-formula"><span class="org-loopmark">↻</span>'
      ch.formula.forEach((f, j) => {
        if (f === '+' || f === '=') h += `<span class="op">${f}</span>`
        else h += `<span class="f ${j === 4 ? 'result' : ''}" data-f="${j}">${T(f)}</span>`
      })
      h += '</div>'
    }
    if (ch.stages) {
      h += '<div class="org-stagebar">' + ch.stages.map((s) => `<div class="sg"><b>${s.k} ${s.e}</b><span>${T(s.n)}</span></div>`).join('') + '</div>'
      h += '<div class="org-stagedesc"></div>'
    }
    if (ch.chips) {
      h += '<div class="org-chips">' + ch.chips.map((c) =>
        `<div class="org-chip ${c.st ? 'st' + c.st : ''}" ${c.st ? `data-st="${c.st}"` : ''}><div class="k">${c.k}</div><div class="v">${T(c.v)}</div><div class="d">${T(c.d)}</div></div>`).join('') + '</div>'
    }
    h += ch.derived
      ? `<blockquote class="org-quote derived"><span class="org-derived-tag">${T(ch.derived)}</span>${T(ch.quote)}</blockquote>`
      : `<blockquote class="org-quote">${T(ch.quote)}”</blockquote>`
    h += `<div class="org-tie"><span class="org-tie-tag">元冰可 AIOS</span>${T(ch.tie)}</div>`
    h += '<div class="org-legend">' + ORG_LEGEND.map((l) => `<span><i class="sy ${l[0]}">${l[0] === 'sy-l' ? '↻' : ''}</i>${T(l[1])}</span>`).join('') + '</div>'
    panel.innerHTML = h
    caption.innerHTML = `<b>${ch.caption[0]}</b>${T(ch.caption[1])}`
    hdrState.textContent = (playing ? 'AUTOPLAY' : 'PAUSED') + ' / ' + ch.no
    ;[...rail.children].forEach((b, k) => b.classList.toggle('on', k === i))
    lastStage = -2
  }
  const stageOf = (i, t) => {
    if (i === 2) return Math.floor(t / 2.7) % 5
    if (i === 4) return Math.floor(t / 2.9) % 5
    return -1
  }
  function syncStage(st) {
    const sb = panel.querySelector('.org-stagebar'), sd = panel.querySelector('.org-stagedesc')
    if (!sb) return
    ;[...sb.children].forEach((n, k) => n.classList.toggle('on', k === st))
    const s = ORG_CHAPTERS[current].stages[st]
    if (sd && s) sd.innerHTML = `<b>${s.k} ${T(s.n)} / ${s.e}</b> · ${T(s.d)}`
  }
  function goto(i) {
    i = (i + ORG_CHAPTERS.length) % ORG_CHAPTERS.length
    if (i === current) return
    prev = current; prevT = sceneT; current = i; sceneT = 0; mixStart = performance.now()
    renderPanel(i); kick()
  }
  rail.innerHTML = ORG_CHAPTERS.map((c, i) =>
    `<button data-i="${i}" aria-label="${T(c.rail)}"><span class="num">${c.no}</span><span>${T(c.rail)}</span><span class="bar"></span></button>`).join('')
  rail.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goto(+b.dataset.i) })
  playBtn.addEventListener('click', () => {
    playing = !playing
    playBtn.textContent = playing ? '❚❚' : '▶'
    playBtn.title = playing ? T(ORG_UI.playTitle) : T('继续')
    hdrState.textContent = (playing ? 'AUTOPLAY' : 'PAUSED') + ' / ' + ORG_CHAPTERS[current].no
    kick()
  })
  if (reduced) { playing = false; playBtn.textContent = '▶' }
  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect()
    tmx = ((e.clientX - r.left) / r.width - .5) * 2
    tmy = ((e.clientY - r.top) / r.height - .5) * 2
  })

  /* ---- 主循环：离屏 / 隐藏页签即停 rAF；canvas 移出文档即退出 ----
     绘制节流 ~30fps（2026-11-13 首页化加固）：叙事是环境级动画而非游戏画面，
     30fps 足够顺滑；低端机 / 软件渲染下功耗减半。时间轴 dt 按两次实际绘制间隔
     累计，节流不影响叙事进度。 */
  let inView = true, rafId = 0, running = false, lastDraw = 0
  const alive = () => document.body.contains(host)
  function frame(now) {
    if (!alive()) { running = false; rafId = 0; return }
    if (!inView || document.hidden) { running = false; rafId = 0; return }
    if (now - lastDraw < 33) { rafId = requestAnimationFrame(frame); return }
    lastDraw = now
    const dt = Math.min(.05, (now - last) / 1000); last = now
    mx += (tmx - mx) * .045; my += (tmy - my) * .045
    if (playing) sceneT += dt
    const t = sceneT
    STAGE = stageOf(current, t)
    if (STAGE !== lastStage) { lastStage = STAGE; if (STAGE >= 0) syncStage(STAGE) }

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H)
    backdrop(t)
    ctx.globalCompositeOperation = 'lighter'
    const m = clamp((now - mixStart) / 900, 0, 1)
    labels.length = 0; glyphs.length = 0
    if (m < 1 && prev >= 0) { GS = 1; STAGE = stageOf(prev, prevT); const r = viewRot(prev, prevT); SCENES[prev](1 - m, prevT, r.rx, r.ry) }
    GS = 1; STAGE = stageOf(current, t); const rc = viewRot(current, t)
    SCENES[current](m, t, rc.rx, rc.ry)
    flushLabels(m)

    const el = panel.querySelectorAll('[data-f]')
    if (el.length) el.forEach((n, j) => n.classList.toggle('lit', t > 1.3 + j * .8))
    const st = panel.querySelectorAll('[data-st]')
    if (st.length) st.forEach((n) => n.classList.toggle('lit', t > 1.5 + (+n.dataset.st - 1) * 1.1))
    bar.style.width = (clamp(t / DURATION, 0, 1) * 100) + '%'
    if (playing && t > DURATION) goto(current + 1)
    rafId = requestAnimationFrame(frame)
  }
  function kick() {
    if (running || !alive() || !inView || document.hidden) return
    running = true; last = performance.now()
    rafId = requestAnimationFrame(frame)
  }
  if (typeof IntersectionObserver === 'undefined') { inView = true } else {
    new IntersectionObserver((es) => { inView = !!es[0]?.isIntersecting; if (inView) kick() }, { threshold: 0.02 }).observe(host)
  }
  document.addEventListener('visibilitychange', kick)

  renderPanel(0)
  mixStart = performance.now() - 1000
  kick()
}
