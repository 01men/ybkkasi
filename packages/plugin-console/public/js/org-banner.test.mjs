/**
 * 首页横幅（org-banner.js）数据面自证：叙事完整性与语言包覆盖。
 *
 * 运行方式（org-banner.js 零依赖纯 ESM，Node 直接加载；不触 DOM/window）：
 *
 *     node packages/plugin-console/public/js/org-banner.test.mjs
 *
 * 覆盖面：六幕章节结构完备、三原则引语逐字保留（叙事页融入首页时最容易
 * 被无意识稀释的部分）、延展/推演标注口径、双生命周期各 5 阶段、六类资产、
 * 三语（en-US/ja-JP/fr-FR）对横幅全部文案键的覆盖一致——canvas 内文案
 * 不受 DOM 翻译引擎覆盖，缺键即静默回落中文，故以测试兜底而非靠肉眼。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ORG_ASSETS, ORG_TASK_STAGES, ORG_LOOP_STAGES, ORG_LEGEND,
  ORG_CHAPTERS, ORG_UI, ORG_CANVAS_STRINGS, ORG_PRINCIPLE_SCENES, ORG_DURATION,
} from './org-banner.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOCALES = join(HERE, '..', 'locales')
const LOCALE_IDS = ['en-US', 'ja-JP', 'fr-FR']

/** 含 CJK 的字符串才需要键（纯英文装饰字样不进词典，与 zh-CN 零词典直出同口径）。 */
const hasCJK = (s) => typeof s === 'string' && /[\u4e00-\u9fff]/.test(s)

/** 与 org-banner.js 渲染路径同构地枚举全部待翻译键（含 canvas 内文案）。 */
function bannerKeys() {
  const keys = new Set()
  const add = (s) => { if (hasCJK(s)) keys.add(s) }
  Object.values(ORG_UI).forEach(add)
  ORG_CANVAS_STRINGS.forEach(add)
  ORG_LEGEND.forEach(([, lab]) => add(lab))
  ORG_ASSETS.forEach((a) => add(a.n))
  for (const st of [...ORG_TASK_STAGES, ...ORG_LOOP_STAGES]) { add(st.n); add(st.d) }
  for (const ch of ORG_CHAPTERS) {
    add(ch.eyebrow); add(ch.rail); add(ch.lead); add(ch.quote); add(ch.tie)
    ch.title.forEach(add)
    if (ch.derived) add(ch.derived)
    if (ch.caption) add(ch.caption[1])
    if (ch.chain) for (const c of ch.chain) { if (c[1] !== 'op') add(c[1]) }
    if (ch.chips) for (const c of ch.chips) { add(c.v); add(c.d) }
    if (ch.formula) ch.formula.forEach(add)
    if (ch.stages) for (const s of ch.stages) { add(s.n); add(s.d) }
  }
  return keys
}

test('叙事结构：六幕齐整、编号连读、无空字段', () => {
  assert.equal(ORG_CHAPTERS.length, 6)
  assert.deepEqual(ORG_CHAPTERS.map((c) => c.no), ['01', '02', '03', '04', '05', '06'])
  for (const ch of ORG_CHAPTERS) {
    for (const field of ['no', 'rail', 'accent', 'accent2', 'eyebrow', 'title', 'lead', 'quote', 'tie', 'caption']) {
      assert.ok(ch[field], `chapter ${ch.no} 缺 ${field}`)
    }
    assert.equal(ch.title.length, 2)
    assert.equal(ch.caption.length, 2)
  }
})

test('三原则引语逐字保留（融入首页不得稀释原叙事）', () => {
  const expected = {
    0: '未来，组织依然存在，但组织是以任务为核心，是一张人和 Agent 协作的任务网络。',
    3: '真正的组织智能，是让这些知识显性化，沉淀到公司的平台上……组织智能，才是企业最深的护城河。',
    4: '公司，就变成一个由无数 Loops 组成的、高度自动化运营的组织。组织，就变成一个不断学习和进化的系统。',
  }
  assert.deepEqual(ORG_PRINCIPLE_SCENES, [0, 3, 4])
  for (const [i, quote] of Object.entries(expected)) {
    assert.equal(ORG_CHAPTERS[i].quote, quote, `scene ${i} 引语被改动`)
    assert.equal(ORG_CHAPTERS[i].derived, undefined, `原则幕 ${i} 不应带延展标注`)
  }
})

test('延展/推演标注口径：延展幕 2/3、推演幕 6；原则幕 0/3/4 无标注', () => {
  assert.equal(ORG_CHAPTERS[1].derived, '延展')
  assert.equal(ORG_CHAPTERS[2].derived, '延展')
  assert.equal(ORG_CHAPTERS[5].derived, '推演')
})

test('每幕都有「落到平台」产品桥接（横幅承担产品介绍职能）', () => {
  for (const ch of ORG_CHAPTERS) {
    assert.ok(ch.tie.includes('元冰可 AIOS'), `chapter ${ch.no} 的 tie 未落到平台`)
  }
})

test('双生命周期各 5 阶段且英文代号唯一', () => {
  for (const stages of [ORG_TASK_STAGES, ORG_LOOP_STAGES]) {
    assert.equal(stages.length, 5)
    assert.equal(new Set(stages.map((s) => s.e)).size, 5)
    for (const s of stages) assert.ok(s.n && s.d && s.k)
  }
  assert.deepEqual(ORG_TASK_STAGES.map((s) => s.e), ['CREATE', 'DECOMPOSE', 'EXECUTE', 'VERIFY', 'RETAIN'])
  assert.deepEqual(ORG_LOOP_STAGES.map((s) => s.e), ['MEASURE', 'PLAN', 'ACT', 'EVALUATE', 'FEEDBACK'])
})

test('六类资产与图例齐整', () => {
  assert.equal(ORG_ASSETS.length, 6)
  assert.equal(new Set(ORG_ASSETS.map((a) => a.k)).size, 6)
  assert.equal(ORG_LEGEND.length, 5)
  assert.ok(ORG_DURATION >= 8, '每幕播放时长过短会读不完面板')
})

test('三语词典对横幅全部文案键零缺失（canvas 文案缺键会静默回落中文）', () => {
  const need = bannerKeys()
  assert.ok(need.size > 80, `横幅待翻译键数量异常：${need.size}`)
  const merged = (loc) => {
    const map = new Map()
    for (const f of readdirSync(join(LOCALES, loc)).filter((f) => f.endsWith('.json')).sort()) {
      const d = JSON.parse(readFileSync(join(LOCALES, loc, f), 'utf8'))
      for (const [k, v] of Object.entries(d)) map.set(k, v)
    }
    return map
  }
  const bannerFile = (loc) => JSON.parse(readFileSync(join(LOCALES, loc, '40-org-banner.json'), 'utf8'))
  const enKeys = Object.keys(bannerFile('en-US')).sort()
  for (const loc of LOCALE_IDS) {
    const dict = merged(loc)
    const missing = [...need].filter((k) => !dict.has(k))
    assert.deepEqual(missing, [], `${loc} 缺 ${missing.length} 个横幅文案键`)
    const empty = [...need].filter((k) => !String(dict.get(k) ?? '').trim())
    assert.deepEqual(empty, [], `${loc} 有空译键：${empty.slice(0, 3).join(' | ')}`)
    // 三个 40-org-banner.json 键集必须一致：同为横幅专用补译，不允许某语种悄悄少键
    assert.deepEqual(Object.keys(bannerFile(loc)).sort(), enKeys, `${loc} 与 en-US 键集不一致`)
  }
})
