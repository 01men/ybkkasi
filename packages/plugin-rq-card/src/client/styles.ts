/**
 * 卡片/反馈条样式：一次注入一段 <style data-plugin>（与 dsh tsdown.client.ts
 * 预设对 CSS Modules 的处理同构——工厂执行时注入、loader 卸载时按 data-plugin
 * 回收；spike §3.1「CSS」行）。
 *
 * 【为什么不用 x.module.css】dsh 预设经 lightningcss 编译 module.css，而本仓
 * 不带 lightningcss 依赖、build.mjs 的等价 esbuild 路径也刻意不引入它——
 * 手写类名 + 运行时注入是把构建面收敛到「零额外工具链」的降级友好选择。
 *
 * 【R7 设计 token 三端统一】本插件浏览器半渲染在 dsh 宿主文档内，宿主页面
 * 加载不到 console 静态根的 packages/plugin-console/public/css/tokens.css
 * （变量不可达，调查结论）——因此每个值写 `var(--rq-*, fallback)` 双层：
 *   · fallback = 现值，与 tokens.css 文末「rq-card 内联变量」一节单源对齐
 *     （改色须两处同步，值一字不差），保证宿主未覆写时视觉不变；
 *   · 宿主页面/定制轨在 :root 覆写任一 --rq-*（或 --fs-*）即可换卡片皮肤。
 */

/** 插件 id（style 标签的 data-plugin 值，loader 卸载凭它回收）。 */
const PLUGIN_ID = '@dsh-ops/plugin-rq-card'

/** 样式表文本（全部类名以 rq- 前缀隔离，避免与宿主/其他插件冲突）。 */
const SHEET = `
.rq-ecard{border:1px solid var(--rq-edge,#e2e6ee);border-radius:10px;padding:8px 12px;
  margin:4px 0;font-size:var(--fs-13,13px);line-height:1.5;background:var(--rq-surface,#fff);max-width:640px}
.rq-ecard-head{display:flex;align-items:center;gap:8px;font-weight:600}
.rq-ecard-chip{font-weight:400;font-size:var(--fs-11,11px);padding:1px 8px;border-radius:999px;
  background:var(--rq-muted-bg,#eef1f6);color:var(--rq-muted-fg,#5b6472)}
.rq-ecard[data-state="calling"] .rq-ecard-chip{background:var(--rq-info-bg,#e8f1fd);color:var(--rq-info-fg,#2563c4)}
.rq-ecard[data-state="executing"] .rq-ecard-chip{background:var(--rq-ok-bg,#e6f5ee);color:var(--rq-ok-fg,#177a4c)}
.rq-ecard[data-state="done"] .rq-ecard-chip{background:var(--rq-ok-bg,#e6f5ee);color:var(--rq-ok-fg,#177a4c)}
.rq-ecard[data-state="blocked"]{border-color:var(--rq-danger,#e5484d);box-shadow:inset 3px 0 0 var(--rq-danger,#e5484d)}
.rq-ecard[data-state="blocked"] .rq-ecard-chip{background:var(--rq-danger-bg,#fdebec);color:var(--rq-danger-fg,#c62a2f)}
.rq-ecard-skel{margin-top:8px}
.rq-ecard-skel-line{height:10px;border-radius:5px;background:var(--rq-muted-bg,#eef1f6);margin:6px 0;
  animation:rq-pulse 1.4s ease-in-out infinite}
.rq-ecard-skel-line:nth-child(2){width:70%}
.rq-ecard-skel-line:nth-child(3){width:45%}
.rq-ecard-pulse{margin-top:8px;height:6px;border-radius:3px;overflow:hidden;background:var(--rq-muted-bg,#eef1f6)}
.rq-ecard-pulse::before{content:"";display:block;height:100%;width:38%;border-radius:3px;
  background:var(--rq-info-fg,#2563c4);opacity:.55;animation:rq-sweep 1.6s ease-in-out infinite}
.rq-ecard-degraded{margin-top:6px;font-size:var(--fs-12,12px);color:var(--rq-warn-fg,#9a6700)}
.rq-ecard-args{margin-top:8px;color:var(--rq-muted-fg,#5b6472);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:var(--fs-12,12px);white-space:pre-wrap;word-break:break-all;max-height:72px;overflow:hidden}
.rq-ecard-result{margin-top:8px;white-space:pre-wrap;word-break:break-word;color:var(--rq-text,#252b35)}
.rq-ecard-foot{margin-top:8px;display:flex;align-items:center;gap:10px}
.rq-ecard-link{color:var(--rq-info-fg,#2563c4);text-decoration:none;font-size:var(--fs-12,12px)}
.rq-ecard-link:hover{text-decoration:underline}
.rq-ecard-action{display:inline-block;padding:3px 12px;border-radius:6px;border:1px solid var(--rq-danger,#e5484d);
  color:var(--rq-danger-fg,#c62a2f);background:var(--rq-surface,#fff);font-size:var(--fs-12,12px);text-decoration:none;cursor:pointer}
.rq-ecard-action:hover{background:var(--rq-danger-bg,#fdebec)}
.rq-ecard-cancel{margin-left:auto;padding:2px 10px;border-radius:6px;border:1px solid var(--rq-line,#c9cfda);
  background:var(--rq-surface,#fff);color:var(--rq-muted-fg,#5b6472);font-size:var(--fs-12,12px);cursor:not-allowed}
.rq-ecard-reason{margin-top:6px;color:var(--rq-danger-fg,#c62a2f)}
@keyframes rq-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes rq-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(280%)}}

.rq-fb{display:inline-flex;align-items:center;gap:4px;margin-left:8px}
.rq-fb-btn{border:none;background:transparent;cursor:pointer;font-size:var(--fs-13,13px);line-height:1;
  padding:3px 6px;border-radius:6px;opacity:.55}
.rq-fb-btn:hover{background:var(--rq-muted-bg,#eef1f6);opacity:1}
.rq-fb-btn[data-active="true"]{opacity:1;background:var(--rq-info-bg,#e8f1fd)}
.rq-fb-done{font-size:var(--fs-11,11px);color:var(--rq-faint,#8a92a0)}

.rq-badge{position:fixed;right:12px;bottom:12px;z-index:2147483000;padding:4px 10px;border-radius:999px;
  background:var(--rq-muted-fg,#5b6472);color:var(--rq-surface,#fff);font-size:var(--fs-11,11px);opacity:.75;pointer-events:none}
`

/** 已注入标记（幂等：重复调用不重复插入）。 */
let injected = false

/**
 * 幂等注入插件样式表（apply 早期调用一次即可；SSR/无 document 环境安全跳过）。
 */
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) {
    injected = true
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
  injected = true
}
