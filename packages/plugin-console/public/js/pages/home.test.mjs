import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(
  '<!doctype html><html><body><main id="app"></main></body></html>',
  { url: 'http://localhost/#/home', pretendToBeVisual: true },
)
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'location',
  'MutationObserver',
  'CustomEvent',
  'Node',
  'NodeFilter',
])
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  })
localStorage.setItem('rq_lang', 'zh-CN')
let calls = 0
globalThis.fetch = async () => {
  calls++
  return { ok: false, status: 403, json: async () => ({}) }
}
window.matchMedia = () => ({
  matches: true,
  addEventListener() {},
  removeEventListener() {},
})
const { renderHome, disposeHome } = await import('./home.js')
const { session } = await import('../api.js')
const root = document.querySelector('#app')
after(() => {
  disposeHome()
  dom.window.close()
})

test('公共首页的流程、能力、键盘操作与移动菜单无需受保护接口', () => {
  renderHome(root)
  assert.match(root.querySelector('h1').textContent, /数字员工协同/)
  assert.equal(
    root.querySelector('[data-enter-crystal]').getAttribute('href'),
    '#/login',
  )
  assert.equal(
    root.querySelector('[data-crystal-scene]').dataset.renderer,
    'static',
  )
  assert.equal(root.querySelector('.ice-motion').hidden, true)
  root.querySelector('[data-step="2"]').click()
  assert.match(root.querySelector('#ice-step-panel').textContent, /带着权限/)
  assert.equal(
    root.querySelector('#ice-step-panel a').getAttribute('href'),
    '#/dashboard?tab=collab',
  )
  root
    .querySelector('[data-step="2"]')
    .dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
  assert.equal(
    root.querySelector('[data-step="3"]').getAttribute('aria-selected'),
    'true',
  )
  assert.equal(document.activeElement.id, 'ice-step-3')
  root
    .querySelector('[data-capability="0"]')
    .dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
  assert.match(root.querySelector('#ice-cap-panel').textContent, /文件访问/)
  assert.equal(
    root.querySelector('#ice-cap-panel a').getAttribute('href'),
    '#/nas',
  )
  root.querySelector('.ice-menu').click()
  assert.equal(
    root.querySelector('.ice-menu').getAttribute('aria-expanded'),
    'true',
  )
  root.querySelector('[data-home-scroll="ice-capabilities"]').click()
  assert.equal(
    root.querySelector('.ice-menu').getAttribute('aria-expanded'),
    'false',
  )
  assert.equal(location.hash, '#/home', '页面内导航不能触发登录路由')
  assert.equal(calls, 0, '产品介绍不请求业务数据')
})

test('进入工作台主动选择冰晶主题；不改平台与认证状态', () => {
  session.enterDemo({ name: '演示访客', readonlyPermissions: ['console.read'] })
  document.documentElement.dataset.platform = 'rd'
  renderHome(root)
  const link = root.querySelector('[data-enter-crystal]')
  assert.equal(link.getAttribute('href'), '#/dashboard')
  link.addEventListener('click', (event) => event.preventDefault())
  link.click()
  assert.equal(localStorage.getItem('ybk_console_ui_theme'), 'crystal')
  assert.equal(document.documentElement.dataset.platform, 'rd')
  assert.equal(session.token, '')
  assert.equal(session.isDemo, true)
  renderHome(root)
  assert.equal(root.querySelectorAll('[data-crystal-scene]').length, 1)
  disposeHome()
})

test('首页文案与冰晶主题的中英日字典完整', async () => {
  const source = await readFile(new URL('./home.js', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/'([^'\n]*)'/g)]
    .map((match) => match[1])
    .filter((s) => /[\u4e00-\u9fff]/.test(s) && !/[<>]|\$\{/.test(s))
  for (const locale of ['en-US', 'ja-JP']) {
    const dir = new URL(`../../locales/${locale}/`, import.meta.url),
      catalog = {}
    for (const f of await readdir(dir))
      if (f.endsWith('.json'))
        Object.assign(
          catalog,
          JSON.parse(await readFile(new URL(f, dir), 'utf8')),
        )
    for (const key of keys) assert.ok(catalog[key], `${locale}: ${key}`)
    assert.ok(catalog['冰晶 · 协同全景'])
  }
})
