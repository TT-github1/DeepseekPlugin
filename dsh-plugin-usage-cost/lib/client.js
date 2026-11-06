/**
 * Live token usage + estimated cost — browser half.
 *
 * Mounted on `conversation.composer.dock`. Data comes from three session
 * projections: `tokenUsage` (billing buckets), `modelSelection` (which model the
 * session last used, so the price follows the real model) and `sessionStats`
 * (turns, steps, decode throughput, for the panel's timing line).
 *
 * The shipped stats cell (`id: 'stats'`) is replaced with an empty component so
 * the built-in token pill does not duplicate this one.
 *
 * Prices are DeepSeek's published CNY list prices (元 per 1M tokens). Peak hours
 * are Beijing time, Monday–Friday 09:00–12:00 and 14:00–18:00; everything else,
 * including weekends, is off-peak. Chinese public holidays are not modeled, so
 * this is an estimate, not a bill.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-usage-cost',
  factory: (require) => {
    const React = require('react')

    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = null
    }

    // 元 per 1M tokens, off-peak / peak.
    const PRICES = {
      'deepseek-flash': {
        hit: { off: 0.02, peak: 0.04 },
        miss: { off: 1, peak: 2 },
        out: { off: 4, peak: 8 },
      },
      'deepseek-v4-pro': {
        hit: { off: 0.15, peak: 0.3 },
        miss: { off: 4.5, peak: 9 },
        out: { off: 13.5, peak: 27 },
      },
    }
    // Legacy model names the platform still accepts and bills as flash.
    const ALIASES = {
      'deepseek-v4-flash': 'deepseek-flash',
      'deepseek-v4-flash-vision-exp': 'deepseek-flash',
      'deepseek-v4.1-flash': 'deepseek-flash',
    }
    const FALLBACK_MODEL = 'deepseek-flash'
    const EMPTY_USAGE = {
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }

    const CSS = `
.dshuc-dock{position:relative;display:inline-flex;align-items:center}
.dshuc-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:12px;line-height:1;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .12s}
.dshuc-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshuc-dot{width:6px;height:6px;border-radius:50%;background:#2f9e57;flex:none}
.dshuc-dot--peak{background:#c0871f}
.dshuc-cost{color:var(--dsw-alias-label-primary,#111);font-weight:600}
.dshuc-sep{opacity:.4}
.dshuc-panel{position:fixed;right:20px;bottom:92px;z-index:1000;width:352px;box-sizing:border-box;padding:14px 14px 12px;border-radius:14px;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.12));box-shadow:0 16px 40px rgba(0,0,0,.18);font-size:12px;line-height:1.45;text-align:left}
.dshuc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.dshuc-title{font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
.dshuc-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:16px;line-height:1;cursor:pointer;padding:2px 5px;border-radius:6px}
.dshuc-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshuc-hero{display:flex;align-items:baseline;gap:8px}
.dshuc-hero-cost{font-size:26px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.dshuc-badge{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#666)}
.dshuc-sub{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;margin:2px 0 0}
.dshuc-meta{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;margin:4px 0 12px}
.dshuc-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(127,127,127,.15);margin-bottom:12px}
.dshuc-bar span{display:block;height:100%}
.dshuc-rows{display:grid;grid-template-columns:1fr auto auto;gap:5px 10px;align-items:center}
.dshuc-row-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,#666);min-width:0}
.dshuc-row-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshuc-swatch{width:7px;height:7px;border-radius:2px;flex:none}
.dshuc-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#999);text-align:right;white-space:nowrap}
.dshuc-num--cost{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#111);text-align:right;white-space:nowrap}
.dshuc-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.08))}
.dshuc-model{color:var(--dsw-alias-label-secondary,#666);font-size:11px}
.dshuc-unit{color:var(--dsw-alias-label-tertiary,#999);font-size:10.5px}
.dshuc-note{margin-top:10px;color:var(--dsw-alias-label-tertiary,#999);font-size:10.5px;line-height:1.5}
`

    /** Peak in Beijing time: Mon–Fri 09:00–12:00 and 14:00–18:00. */
    function isPeak(date) {
      const beijing = new Date(date.getTime() + 8 * 3_600_000)
      const day = beijing.getUTCDay()
      if (day === 0 || day === 6) return false
      const hour = beijing.getUTCHours()
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
    }

    /** 1234 → "1.2K"; 1234567 → "1.2M". */
    function compact(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1e6) return `${Math.round(value / 100) / 10}K`
      return `${Math.round(value / 1e5) / 10}M`
    }

    /** CNY with enough precision to stay meaningful for small sessions. */
    function yuan(value) {
      if (!Number.isFinite(value) || value <= 0) return '¥0'
      if (value < 0.01) return `¥${value.toFixed(4)}`
      if (value < 1) return `¥${value.toFixed(3)}`
      return `¥${value.toFixed(2)}`
    }

    /** Integer percent of `part` in `whole`, or "—" without a denominator. */
    function percent(part, whole) {
      if (!whole) return '—'
      const share = (part / whole) * 100
      // Never round a partial cache hit up to a full one.
      if (share > 0 && share < 100 && Math.round(share) === 100) return '>99%'
      return `${Math.round(share)}%`
    }

    /** Compact wall time: 45.2s under a minute, then 2m42s. */
    function duration(ms) {
      const seconds = ms / 1000
      if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
      const whole = Math.round(seconds)
      return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`
    }

    /** The model this session is on, from the durable selection projection. */
    function currentModel(selection) {
      if (!selection) return undefined
      const chosen = selection.next ?? selection.lastUsed
      return chosen && typeof chosen.model === 'string' ? chosen.model : undefined
    }

    function UsageCostDock(props) {
      const usage = props.useProjection('tokenUsage') || EMPTY_USAGE
      const selection = props.useProjection('modelSelection')
      const stats = props.useProjection('sessionStats')
      const [open, setOpen] = React.useState(false)
      const [, setClock] = React.useState(0)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)

      // Re-render once a minute so the peak/off-peak badge follows the clock.
      React.useEffect(() => {
        const timer = window.setInterval(() => setClock((n) => n + 1), 60_000)
        return () => window.clearInterval(timer)
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (rootRef.current && rootRef.current.contains(target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKey)
        }
      }, [open])

      const model = currentModel(selection)
      const priceKey = model !== undefined ? (ALIASES[model] ?? model) : FALLBACK_MODEL
      const known = Object.prototype.hasOwnProperty.call(PRICES, priceKey)
      const price = known ? PRICES[priceKey] : PRICES[FALLBACK_MODEL]
      const modelLabel = model ?? FALLBACK_MODEL

      const peak = isPeak(new Date())
      const tier = peak ? 'peak' : 'off'
      const rows = [
        {
          key: 'miss',
          label: '输入 · 未命中',
          color: '#5b8def',
          tokens: usage.uncachedInputTokens,
          cost: (usage.uncachedInputTokens * price.miss[tier]) / 1e6,
        },
        {
          key: 'hit',
          label: '输入 · 缓存命中',
          color: '#2f9e57',
          tokens: usage.cacheReadTokens,
          cost: (usage.cacheReadTokens * price.hit[tier]) / 1e6,
        },
        {
          key: 'write',
          label: '输入 · 缓存写入',
          color: '#c0871f',
          tokens: usage.cacheWriteTokens,
          cost: (usage.cacheWriteTokens * price.miss[tier]) / 1e6,
        },
        {
          key: 'out',
          label: '输出',
          color: '#8b5cf6',
          tokens: usage.outputTokens,
          cost: (usage.outputTokens * price.out[tier]) / 1e6,
        },
      ]
      const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0)
      const totalCost = rows.reduce((sum, row) => sum + row.cost, 0)
      const promptTokens = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      const hitRate = percent(usage.cacheReadTokens, promptTokens)
      const widths = rows.map((row) => (totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0))

      const timing = []
      if (stats) {
        timing.push(`${stats.turns} 轮`, `${stats.steps} 步`)
        if (stats.decodeMs > 0) {
          timing.push(`${Math.round((stats.decodeTokens / (stats.decodeMs / 1000)) * 10) / 10} tok/s`)
        }
        if (stats.llmMs > 0) timing.push(`模型 ${duration(stats.llmMs)}`)
        if (stats.toolMs > 0) timing.push(`工具 ${duration(stats.toolMs)}`)
      }

      const pill = React.createElement(
        'button',
        {
          type: 'button',
          className: 'dshuc-pill',
          onClick: () => setOpen((value) => !value),
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          title: '本次会话的 token 用量与估算花费',
        },
        React.createElement('span', {
          className: peak ? 'dshuc-dot dshuc-dot--peak' : 'dshuc-dot',
          'aria-hidden': true,
        }),
        React.createElement('span', { className: 'dshuc-cost' }, `≈${yuan(totalCost)}`),
        React.createElement('span', { className: 'dshuc-sep', 'aria-hidden': true }, '·'),
        React.createElement('span', null, `${compact(totalTokens)} tok`),
      )

      const panel = React.createElement(
        'div',
        { ref: panelRef, className: 'dshuc-panel', role: 'dialog', 'aria-label': '会话用量与花费' },
        React.createElement(
          'div',
          { className: 'dshuc-head' },
          React.createElement('span', { className: 'dshuc-title' }, '会话用量与估价'),
          React.createElement(
            'button',
            { type: 'button', className: 'dshuc-close', onClick: () => setOpen(false), 'aria-label': '关闭' },
            '×',
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshuc-hero' },
          React.createElement('span', { className: 'dshuc-hero-cost' }, yuan(totalCost)),
          React.createElement('span', { className: 'dshuc-badge' }, peak ? '高峰价' : '空闲价'),
        ),
        React.createElement(
          'div',
          { className: 'dshuc-sub' },
          `${modelLabel} · 缓存命中 ${hitRate} · 共 ${compact(totalTokens)} tokens`,
        ),
        timing.length > 0
          ? React.createElement('div', { className: 'dshuc-meta' }, timing.join(' · '))
          : React.createElement('div', { className: 'dshuc-meta' }, ''),
        React.createElement(
          'div',
          { className: 'dshuc-bar', 'aria-hidden': true },
          rows.map((row, index) =>
            React.createElement('span', {
              key: row.key,
              style: { width: `${widths[index]}%`, background: row.color },
            }),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshuc-rows' },
          rows.map((row) =>
            React.createElement(
              React.Fragment,
              { key: row.key },
              React.createElement(
                'div',
                { className: 'dshuc-row-label' },
                React.createElement('i', { className: 'dshuc-swatch', style: { background: row.color } }),
                React.createElement('span', null, row.label),
              ),
              React.createElement('div', { className: 'dshuc-num' }, compact(row.tokens)),
              React.createElement('div', { className: 'dshuc-num--cost' }, yuan(row.cost)),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshuc-foot' },
          React.createElement('span', { className: 'dshuc-model' }, modelLabel),
          React.createElement('span', { className: 'dshuc-unit' }, '元 / 百万 tokens'),
        ),
        React.createElement(
          'div',
          { className: 'dshuc-note' },
          known
            ? '按 DeepSeek 官网人民币价目估算，不是实际账单；高峰为北京时间周一至周五 09–12、14–18，法定节假日未计入。'
            : `未识别模型「${modelLabel}」，暂按 ${FALLBACK_MODEL} 价目估算。`,
        ),
      )

      const overlay = !open
        ? null
        : createPortal
          ? createPortal(panel, document.body)
          : panel

      return React.createElement('span', { ref: rootRef, className: 'dshuc-dock' }, pill, overlay)
    }

    /** Replaces the shipped stats cell so its token pill does not duplicate ours. */
    function EmptyStatsCell() {
      return null
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-usage-cost-styles'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'usage-cost: styles')

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'stats',
            order: 0,
          },
          EmptyStatsCell,
        ),
      )

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'usage-cost',
            order: 5,
          },
          UsageCostDock,
        ),
      )
    }

    return { apply, inject: ['slots'] }
  },
})
