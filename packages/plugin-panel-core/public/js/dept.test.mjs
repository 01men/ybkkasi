/**
 * 部门深链决议单测（2026-10-22）：面板 SPA 是 ES module，jsdom 无法执行，
 * 端到端冒烟覆盖不到；决议纯函数在这里直测三条口径。
 *
 *     node packages/plugin-panel-core/public/js/dept.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestedDept, resolveDept } from './dept.js'

const DEPTS = [{ id: 'mfg' }, { id: 'rd' }, { id: 'sales' }]

test('requestedDept：合法标识原样返回，缺失/脏值返回空串', () => {
  assert.equal(requestedDept('?dept=rd'), 'rd')
  assert.equal(requestedDept('?foo=1&dept=mfg'), 'mfg')
  assert.equal(requestedDept(''), '')
  assert.equal(requestedDept('?dept='), '')
  assert.equal(requestedDept('?dept=../etc/passwd'), '')
  assert.equal(requestedDept('?dept=' + 'x'.repeat(33)), '')
  assert.equal(requestedDept('?dept=<script>'), '')
})

test('requestedDept：口径与服务端 DEPT_RE 一致（大写/数字/连字符/下划线一律拒绝）', () => {
  // 这些值若前端放行、服务端拒（400 部门标识非法），用户点进面板只会看到空白
  for (const bad of ['RD', 'rd-team', 'rd_team', 'rd1', 'r', 'x'.repeat(13)]) {
    assert.equal(requestedDept(`?dept=${bad}`), '', `${bad} 不应通过前端校验`)
  }
  assert.equal(requestedDept('?dept=strategy'), 'strategy')
})

test('resolveDept：深链优先于记忆值（用户记忆 mfg，深链 rd → rd）', () => {
  assert.equal(resolveDept({ requested: 'rd', remembered: 'mfg', allowedDepts: DEPTS }), 'rd')
})

test('resolveDept：深链部门不在可见范围 → 静默回落记忆值（不越权、不报错）', () => {
  assert.equal(resolveDept({ requested: 'secret-dept', remembered: 'mfg', allowedDepts: DEPTS }), 'mfg')
})

test('resolveDept：记忆值也失效 → 首个可见部门', () => {
  assert.equal(resolveDept({ requested: '', remembered: 'gone', allowedDepts: DEPTS }), 'mfg')
})

test('resolveDept：无任何可见部门时回落记忆值（外壳仍可渲染并提示范围受限）', () => {
  assert.equal(resolveDept({ requested: 'rd', remembered: 'mfg', allowedDepts: [] }), 'mfg')
})