/**
 * dsh-prompt-bank — Client 半（Web）
 *
 * 在输入框左侧工具行放一个「提示词库」按钮，点开是一个面板：
 * 列出事先存好的提示词，点选即把正文插入当前草稿；面板内支持增删改查。
 *
 * 设计取舍：
 * - 插槽用 `conversation.input.left`（list 槽，与附件按钮同侧），右侧留给模型选择器与发送键。
 * - 数据走官方 `configForms` 服务，存成 profile 条目 config 里的一个 JSON 字符串字段，
 *   复用宿主的持久化与快照订阅，插件自己不写文件、不管路径与权限。
 * - 插入走 slot props 的 `inputActions.insertText(text, span)`；span 由
 *   `inputActions.captureInsertion()` 在打开面板时抓取。insertText 返回 false 表示
 *   草稿在此期间被改过，此时不硬插入，改为提示并保留待插入文本，避免覆盖用户输入。
 * - 本文件是宿主直接装载的零构建产物（window.__ModuleLoader__.load），只 require
 *   平台表内的 'react'，不 require 任何 Harness Client 包；控件与样式自绘。
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-bank',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 设置命名空间 = 本插件在 profile 里的条目 id。 */
    const NAMESPACE = 'dsh-prompt-bank'
    /** 承载整库 JSON 的字段名。 */
    const FIELD = 'library'
    /** 样式标签的 data 标记，卸载时按它精确移除。 */
    const STYLE_ID = 'dsh-prompt-bank'
    /** 输入框左侧插槽：与附件按钮同侧，list 类型，允许多个注册。 */
    const SLOT_NAME = 'conversation.input.left'
    /** 本插件在该插槽内的注册 id。 */
    const SLOT_ID = 'dsh-prompt-bank.trigger'
    /** locale 命名空间。 */
    const LOCALE_NS = 'prompt-bank'

    // ── 数据模型 ────────────────────────────────────────────────────────────────

    /**
     * @typedef {object} PromptItem
     * @property {string} id        稳定标识（创建时生成）
     * @property {string} title     列表里显示的名字
     * @property {string} body      插入草稿的正文
     * @property {string} group     分组名，空串表示未分组
     * @property {boolean} pinned   是否置顶
     * @property {number} updatedAt 最近修改时间戳，用于排序
     */

    /** 生成一个短 id。crypto.randomUUID 在安全上下文外不可用时退回时间戳+随机串。 */
    function newId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID()
        }
      } catch {
        /* 落到下面的兜底 */
      }
      return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    }

    /**
     * 把快照里的原始字段解析成条目数组。任何形状异常都收敛成空数组，
     * 不让一份坏数据把整个面板打哑。
     * @param {unknown} raw - snapshot.value[FIELD]
     * @returns {PromptItem[]}
     */
    function parseLibrary(raw) {
      if (typeof raw !== 'string' || raw === '') return []
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        return []
      }
      const list = parsed && typeof parsed === 'object' && Array.isArray(parsed.items) ? parsed.items : []
      const out = []
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object') continue
        const title = typeof entry.title === 'string' ? entry.title.trim() : ''
        const body = typeof entry.body === 'string' ? entry.body : ''
        if (title === '' && body.trim() === '') continue
        out.push({
          id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : newId(),
          title: title === '' ? '未命名' : title,
          body,
          group: typeof entry.group === 'string' ? entry.group.trim() : '',
          pinned: entry.pinned === true,
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
        })
      }
      return out
    }

    /** 把条目数组序列化为落盘字符串。 */
    function serializeLibrary(items) {
      return JSON.stringify({ version: 1, items })
    }

    /** 排序：置顶优先，其次分组名，最后按最近修改倒序。 */
    function sortItems(items) {
      return items.slice().sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        const ga = a.group || '\uffff'
        const gb = b.group || '\uffff'
        if (ga !== gb) return ga < gb ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
    }

    /** 按查询词过滤：空格分词、逐词 AND，范围覆盖标题、正文、分组。 */
    function filterItems(items, query) {
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return items
      return items.filter((item) => {
        const haystack = (item.title + '\n' + item.body + '\n' + item.group).toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
    }

    // ── 样式 ────────────────────────────────────────────────────────────────────

    const CSS = `
.dpb-anchor { position: relative; display: inline-flex; align-items: center; }
.dpb-trigger {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 8px; border: none; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
  transition: background 120ms ease, color 120ms ease;
}
.dpb-trigger:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, #111827); }
.dpb-trigger[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, #111827); }
.dpb-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: 2px; }
.dpb-trigger svg { width: 16px; height: 16px; display: block; }

.dpb-panel {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 60;
  width: 380px; max-height: 460px; display: flex; flex-direction: column;
  border-radius: 12px; overflow: hidden;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
  box-shadow: 0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08);
  color: var(--dsw-alias-label-primary, #111827);
  font-size: 13px; line-height: 1.5;
}
.dpb-head { display: flex; gap: 6px; align-items: center; padding: 10px 10px 8px; }
.dpb-search {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
  background: var(--dsw-alias-bg-base, #fff); color: inherit; font-size: 13px; outline: none;
}
.dpb-search:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dpb-mini {
  height: 30px; padding: 0 10px; border-radius: 8px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
  background: transparent; color: inherit; font-size: 12px;
}
.dpb-mini:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); }
.dpb-mini[disabled] { opacity: .45; cursor: default; }

.dpb-chips { display: flex; gap: 6px; padding: 0 10px 8px; flex-wrap: wrap; }
.dpb-chip {
  padding: 3px 9px; border-radius: 999px; cursor: pointer; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
}
.dpb-chip[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-2, rgba(59,130,246,.14));
  border-color: transparent; color: var(--dsw-alias-label-primary, #111827);
}

.dpb-list { overflow-y: auto; padding: 2px 6px 8px; flex: 1; }
.dpb-empty { padding: 22px 12px; text-align: center; color: var(--dsw-alias-label-secondary, #9ca3af); font-size: 12px; }
.dpb-row { display: flex; align-items: stretch; gap: 2px; border-radius: 8px; }
.dpb-row:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); }
.dpb-pick {
  flex: 1; min-width: 0; text-align: left; padding: 7px 8px; border-radius: 8px;
  background: transparent; border: none; cursor: pointer; color: inherit; font-size: 13px;
}
.dpb-pick-title { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.dpb-pin { font-size: 10px; opacity: .7; }
.dpb-grp {
  font-size: 11px; padding: 1px 6px; border-radius: 999px; font-weight: 400;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.14));
  color: var(--dsw-alias-label-secondary, #6b7280);
}
.dpb-preview {
  margin-top: 2px; font-size: 12px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; color: var(--dsw-alias-label-secondary, #6b7280);
}
.dpb-acts { display: flex; align-items: center; gap: 0; padding-right: 4px; }
.dpb-icon {
  width: 26px; height: 26px; border-radius: 6px; border: none; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
}
.dpb-icon:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); color: var(--dsw-alias-label-primary, #111827); }
.dpb-icon.danger:hover { color: #dc2626; }

.dpb-foot { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); align-items: center; }
.dpb-hint { flex: 1; font-size: 11px; color: var(--dsw-alias-label-secondary, #9ca3af); }

.dpb-editor { display: flex; flex-direction: column; gap: 8px; padding: 10px; flex: 1; overflow-y: auto; }
.dpb-label { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); margin-bottom: -4px; }
.dpb-input, .dpb-textarea {
  width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
  background: var(--dsw-alias-bg-base, #fff); color: inherit; outline: none; font-family: inherit;
}
.dpb-input:focus, .dpb-textarea:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dpb-textarea { min-height: 110px; resize: vertical; line-height: 1.55; }
.dpb-editor-actions { display: flex; gap: 6px; justify-content: flex-end; }
.dpb-primary {
  height: 30px; padding: 0 14px; border-radius: 8px; cursor: pointer; font-size: 12px;
  border: none; background: var(--dsw-alias-brand-primary, #2563eb); color: #fff;
}
.dpb-primary:hover { filter: brightness(1.06); }
.dpb-primary[disabled] { opacity: .5; cursor: default; filter: none; }
.dpb-warn {
  margin: 0 10px 8px; padding: 7px 9px; border-radius: 8px; font-size: 12px;
  background: rgba(245,158,11,.14); color: #92400e;
}
`

    /** 幂等注入样式；返回移除函数。 */
    function ensureStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) {
        return () => {}
      }
      const tag = document.createElement('style')
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')?.remove()
      }
    }

    // ── 图标（内联 SVG，避免任何外部依赖）────────────────────────────────────────

    function BankIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', {
          x: 2.25, y: 1.75, width: 11.5, height: 12.5, rx: 2,
          stroke: 'currentColor', strokeWidth: 1.3,
        }),
        h('path', {
          d: 'M5 5.25h6M5 8h6M5 10.75h3.5',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round',
        }),
      )
    }

    // ── 面板组件 ────────────────────────────────────────────────────────────────

    /**
     * 提示词库面板：列表 + 搜索 + 分组 + 增删改。
     * 由 createTrigger 在 apply 期用闭包注入 form 与 t 后挂进插槽。
     */
    function PromptBankPanel({ form, inputActions, t, onClose }) {
      const subscribe = React.useCallback((onChange) => form.subscribe(onChange), [form])
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form])
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot)

      const rawValue = snapshot !== undefined && snapshot !== null && typeof snapshot.value === 'object'
        ? snapshot.value[FIELD]
        : undefined
      const items = React.useMemo(() => sortItems(parseLibrary(rawValue)), [rawValue])

      // 宿主还没把本条目投影进设置文档时，value 是 undefined——此时显示「空库」会
      // 让人以为数据丢了。区分开：状况不是 ready / 不可写，各自给一句真话。
      const status = snapshot !== undefined && snapshot !== null ? snapshot.status : undefined
      const writable = snapshot !== undefined && snapshot !== null && snapshot.writable === true
      const notReady = status !== undefined && status !== 'ready'
      const readOnly = status === 'ready' && !writable

      const [query, setQuery] = React.useState('')
      const [group, setGroup] = React.useState('')
      /** null = 列表视图；{mode:'new'|'edit', draft} = 编辑视图 */
      const [editing, setEditing] = React.useState(null)
      /** 插入冲突时保留待插入文本，允许用户再点一次。 */
      const [pendingText, setPendingText] = React.useState('')
      /** 打开面板那一刻抓的插入位置；面板期间用户若改草稿，insertText 会返回 false。 */
      const spanRef = React.useRef(undefined)
      const searchRef = React.useRef(null)

      if (spanRef.current === undefined) {
        try {
          spanRef.current = inputActions.captureInsertion()
        } catch {
          spanRef.current = null
        }
      }

      React.useEffect(() => {
        searchRef.current?.focus()
      }, [])

      const groups = React.useMemo(() => {
        const seen = new Set()
        for (const item of items) if (item.group !== '') seen.add(item.group)
        return Array.from(seen).sort()
      }, [items])

      const visible = React.useMemo(() => {
        const scoped = group === '' ? items : items.filter((item) => item.group === group)
        return filterItems(scoped, query)
      }, [items, group, query])

      /** 落盘：写回整个库；成功后返回 true。 */
      const commit = React.useCallback(
        async (nextItems) => {
          const payload = serializeLibrary(sortItems(nextItems))
          try {
            const accepted = await form.set(FIELD, payload)
            if (accepted === true) return true
            // 宿主没明确答复时回读快照确认：比内容而不是比条数——
            // 「删一条再补一条」长度相同但内容不同，用长度会误判成写入成功。
            const stored = form.getSnapshot()?.value?.[FIELD]
            return typeof stored === 'string' && stored === payload
          } catch {
            return false
          }
        },
        [form],
      )

      /**
       * 把一条提示词插入草稿。
       * @param {PromptItem} item
       * @param {'append'|'replace'} mode
       */
      const insert = React.useCallback(
        (item, mode) => {
          const body = item.body.trim()
          if (body === '') return
          const text = mode === 'append' ? '\n\n' + body : body
          let span = spanRef.current
          if (mode === 'replace') {
            // 替换语义要重新抓一次位置，否则会落到打开面板时的旧光标处。
            try {
              span = inputActions.captureInsertion()
            } catch {
              span = spanRef.current
            }
          }
          let ok = false
          try {
            ok = inputActions.insertText(text, span === null ? undefined : span)
          } catch {
            ok = false
          }
          if (ok) {
            setPendingText('')
            onClose()
            return
          }
          // 草稿在面板打开期间被改过：不硬插，保留文本等用户确认。
          setPendingText(text)
        },
        [inputActions, onClose],
      )

      /** 冲突后按当前光标位置重试。 */
      const retryPending = React.useCallback(() => {
        if (pendingText === '') return
        let span
        try {
          span = inputActions.captureInsertion()
        } catch {
          span = undefined
        }
        let ok = false
        try {
          ok = inputActions.insertText(pendingText, span)
        } catch {
          ok = false
        }
        if (ok) {
          setPendingText('')
          onClose()
        }
      }, [pendingText, inputActions, onClose])

      const startNew = () =>
        setEditing({
          mode: 'new',
          draft: { id: '', title: '', body: '', group, pinned: false },
        })

      const startEdit = (item) =>
        setEditing({
          mode: 'edit',
          draft: { id: item.id, title: item.title, body: item.body, group: item.group, pinned: item.pinned },
        })

      const saveEditing = async () => {
        if (editing === null) return
        const draft = editing.draft
        const title = draft.title.trim()
        const body = draft.body
        if (title === '' && body.trim() === '') return
        const now = Date.now()
        let next
        if (editing.mode === 'new') {
          next = items.concat([
            { id: newId(), title: title === '' ? '未命名' : title, body, group: draft.group.trim(), pinned: false, updatedAt: now },
          ])
        } else {
          next = items.map((item) =>
            item.id === draft.id
              ? { ...item, title: title === '' ? '未命名' : title, body, group: draft.group.trim(), pinned: item.pinned, updatedAt: now }
              : item,
          )
        }
        const ok = await commit(next)
        if (ok) setEditing(null)
      }

      const remove = async (item) => {
        const ok = await commit(items.filter((entry) => entry.id !== item.id))
        if (ok) setEditing(null)
      }

      const togglePin = async (item) => {
        await commit(items.map((entry) => (entry.id === item.id ? { ...entry, pinned: !entry.pinned } : entry)))
      }

      // ── 编辑视图 ──
      if (editing !== null) {
        const draft = editing.draft
        const patch = (next) => setEditing({ ...editing, draft: { ...draft, ...next } })
        return h(
          'div',
          { className: 'dpb-panel', role: 'dialog', 'aria-label': t('editorTitle') },
          h(
            'div',
            { className: 'dpb-head' },
            h('div', { className: 'dpb-pick-title', style: { flex: 1, fontWeight: 600 } },
              editing.mode === 'new' ? t('newTitle') : t('editTitle')),
          ),
          h(
            'div',
            { className: 'dpb-editor' },
            h('label', { className: 'dpb-label' }, t('fieldTitle')),
            h('input', {
              className: 'dpb-input',
              value: draft.title,
              placeholder: t('fieldTitleHint'),
              onChange: (event) => patch({ title: event.target.value }),
            }),
            h('label', { className: 'dpb-label' }, t('fieldGroup')),
            h('input', {
              className: 'dpb-input',
              value: draft.group,
              placeholder: t('fieldGroupHint'),
              list: 'dpb-groups',
              onChange: (event) => patch({ group: event.target.value }),
            }),
            h(
              'datalist',
              { id: 'dpb-groups' },
              groups.map((name) => h('option', { key: name, value: name })),
            ),
            h('label', { className: 'dpb-label' }, t('fieldBody')),
            h('textarea', {
              className: 'dpb-textarea',
              value: draft.body,
              placeholder: t('fieldBodyHint'),
              onChange: (event) => patch({ body: event.target.value }),
            }),
            h(
              'div',
              { className: 'dpb-editor-actions' },
              editing.mode === 'edit'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpb-mini',
                      style: { color: '#dc2626' },
                      onClick: () => {
                        const target = items.find((entry) => entry.id === draft.id)
                        if (target !== undefined) void remove(target)
                      },
                    },
                    t('delete'),
                  )
                : null,
              h('button', { type: 'button', className: 'dpb-mini', onClick: () => setEditing(null) }, t('cancel')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dpb-primary',
                  disabled: notReady || readOnly || (draft.title.trim() === '' && draft.body.trim() === ''),
                  onClick: () => void saveEditing(),
                },
                t('save'),
              ),
            ),
          ),
        )
      }

      // ── 列表视图 ──
      return h(
        'div',
        { className: 'dpb-panel', role: 'dialog', 'aria-label': t('panelTitle') },
        h(
          'div',
          { className: 'dpb-head' },
          h('input', {
            ref: searchRef,
            className: 'dpb-search',
            value: query,
            placeholder: t('searchHint'),
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClose()
              }
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dpb-mini',
              disabled: notReady || readOnly,
              onClick: startNew,
            },
            t('new'),
          ),
        ),
        groups.length > 0
          ? h(
              'div',
              { className: 'dpb-chips' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dpb-chip',
                  'aria-pressed': group === '',
                  onClick: () => setGroup(''),
                },
                t('allGroups') + ' ' + items.length,
              ),
              groups.map((name) =>
                h(
                  'button',
                  {
                    key: name,
                    type: 'button',
                    className: 'dpb-chip',
                    'aria-pressed': group === name,
                    onClick: () => setGroup(group === name ? '' : name),
                  },
                  name,
                ),
              ),
            )
          : null,
        pendingText !== ''
          ? h(
              'div',
              { className: 'dpb-warn' },
              h('div', { style: { marginBottom: 6 } }, t('conflict')),
              h(
                'div',
                { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                h('button', { type: 'button', className: 'dpb-mini', onClick: () => setPendingText('') }, t('discard')),
                h('button', { type: 'button', className: 'dpb-mini', onClick: retryPending }, t('insertAtCursor')),
              ),
            )
          : null,
        notReady || readOnly
          ? h('div', { className: 'dpb-warn' }, t(notReady ? 'formNotReady' : 'formReadOnly'))
          : null,
        h(
          'div',
          { className: 'dpb-list' },
          visible.length === 0
            ? h('div', { className: 'dpb-empty' }, items.length === 0 ? t('emptyHint') : t('noMatch'))
            : visible.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'dpb-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpb-pick',
                      title: item.body,
                      onClick: (event) => insert(item, event.shiftKey ? 'replace' : 'append'),
                    },
                    h(
                      'div',
                      { className: 'dpb-pick-title' },
                      item.pinned ? h('span', { className: 'dpb-pin', 'aria-hidden': 'true' }, '★') : null,
                      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
                      item.group !== '' ? h('span', { className: 'dpb-grp' }, item.group) : null,
                    ),
                    h('div', { className: 'dpb-preview' }, item.body.replace(/\s+/g, ' ').trim() || '—'),
                  ),
                  h(
                    'div',
                    { className: 'dpb-acts' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dpb-icon',
                        title: item.pinned ? t('unpin') : t('pin'),
                        'aria-label': item.pinned ? t('unpin') : t('pin'),
                        onClick: () => void togglePin(item),
                      },
                      item.pinned ? '★' : '☆',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dpb-icon',
                        title: t('edit'),
                        'aria-label': t('edit'),
                        onClick: () => startEdit(item),
                      },
                      '✎',
                    ),
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'dpb-foot' },
          h('span', { className: 'dpb-hint' }, t('footHint')),
        ),
      )
    }

    // ── 触发器（按钮 + 面板开合）────────────────────────────────────────────────

    /**
     * 输入框左侧的工具按钮。点开面板，面板关闭时把焦点还给按钮。
     * span 在打开瞬间抓取，作为插入点的锚。
     */
    function Trigger({ form, inputActions, t, slotProps }) {
      const [open, setOpen] = React.useState(false)
      const anchorRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        /** 点面板外或按 Escape 关闭。 */
        const onPointerDown = (event) => {
          if (anchorRef.current !== null && !anchorRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      // 会话锁定（例如正在生成）时不给开——插入会撞上不可写状态。
      const locked = slotProps !== undefined && slotProps.locked === true

      const close = React.useCallback(() => {
        setOpen(false)
        anchorRef.current?.querySelector('button')?.focus()
      }, [])

      return h(
        'div',
        { className: 'dpb-anchor', ref: anchorRef },
        h(
          'button',
          {
            type: 'button',
            className: 'dpb-trigger',
            'aria-expanded': open,
            'aria-haspopup': 'dialog',
            title: t('triggerTitle'),
            'aria-label': t('triggerTitle'),
            disabled: locked,
            onClick: () => setOpen((value) => !value),
          },
          h(BankIcon),
        ),
        open && !locked
          ? h(PromptBankPanel, { form, inputActions, t, onClose: close })
          : null,
      )
    }

    // ── 词典 ────────────────────────────────────────────────────────────────────

    const DICT = {
      triggerTitle: '提示词库',
      panelTitle: '提示词库',
      searchHint: '搜索标题、正文或分组（空格分词）',
      new: '新建',
      newTitle: '新建提示词',
      editTitle: '编辑提示词',
      editorTitle: '提示词编辑',
      fieldTitle: '标题',
      fieldTitleHint: '列表里显示的名字',
      fieldGroup: '分组',
      fieldGroupHint: '可选，例如「排错」「验收」',
      fieldBody: '正文',
      fieldBodyHint: '点选时插入到草稿的内容',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      edit: '编辑',
      pin: '置顶',
      unpin: '取消置顶',
      allGroups: '全部',
      emptyHint: '还没有提示词，点「新建」添加第一条。',
      noMatch: '没有匹配的提示词。',
      footHint: '点选追加到草稿；按住 Shift 点击替换草稿',
      conflict: '草稿在面板打开期间被修改，为避免覆盖已保留这段文字，可按当前光标位置插入。',
      discard: '丢弃',
      insertAtCursor: '插入到当前光标',
      formNotReady: '设置数据还没准备好，稍等片刻或重开这个面板；已有条目仍可点选插入。',
      formReadOnly: '当前配置是只读的，增删改不会保存；点选插入仍然可用。',
    }

    /** 英文对照：注册链必须回退到 en，缺这条路会在注册时失败。 */
    const EN_DICT = {
      triggerTitle: 'Prompt library',
      panelTitle: 'Prompt library',
      searchHint: 'Search title, body, or group (space-separated)',
      new: 'New',
      newTitle: 'New prompt',
      editTitle: 'Edit prompt',
      editorTitle: 'Prompt editor',
      fieldTitle: 'Title',
      fieldTitleHint: 'The name shown in the list',
      fieldGroup: 'Group',
      fieldGroupHint: 'Optional, e.g. "Debug" or "Review"',
      fieldBody: 'Body',
      fieldBodyHint: 'Inserted into the draft when you pick it',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      pin: 'Pin',
      unpin: 'Unpin',
      allGroups: 'All',
      emptyHint: 'No prompts yet. Click "New" to add the first one.',
      noMatch: 'No matching prompts.',
      footHint: 'Click to append to the draft; hold Shift to replace it',
      conflict: 'The draft changed while this panel was open. Your text was kept so it cannot overwrite what you typed; insert it at the current caret.',
      discard: 'Discard',
      insertAtCursor: 'Insert at caret',
      formNotReady: "Settings are not ready yet. Wait a moment or reopen this panel; existing entries can still be inserted.",
      formReadOnly: 'This configuration is read-only, so edits will not be saved. Picking a prompt still works.',
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────────

    return {
      inject: ['slots', 'locale', 'configForms'],
      /**
       * 注册触发按钮到输入框左侧插槽。
       * @param ctx - client cordis 上下文
       */
      apply(ctx) {
        ctx.effect(() => ensureStyles(), 'dsh-prompt-bank: styles')
        const form = ctx.configForms.get(NAMESPACE)
        // 字典按官方外部插件形式逐个语言注册：register(ns, locale, dict)。
        // 注册项声明同一个 locale 命名空间后，框架把绑定好的 t 注入组件 props。
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, 'zh', DICT),
          'dsh-prompt-bank: zh dictionary',
        )
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, 'en', EN_DICT),
          'dsh-prompt-bank: en dictionary',
        )

        /**
         * 组件身份在 apply 期固定，避免每次渲染重挂。
         * slot 会把 inputActions 与本单据声明的 locale 绑定 t 一起传进来。
         */
        const Bank = (props) =>
          h(Trigger, {
            form,
            inputActions: props.inputActions,
            slotProps: props,
            t: typeof props.t === 'function' ? props.t : (key) => DICT[key] ?? key,
          })

        ctx.slots.inject(SLOT_NAME, () =>
          ctx.slots.register(
            {
              name: SLOT_NAME,
              id: SLOT_ID,
              registrant: NAMESPACE,
              order: 5,
              priority: 0,
              locale: LOCALE_NS,
            },
            Bank,
          ),
        )
      },
      _internals: { parseLibrary, serializeLibrary, sortItems, filterItems, ensureStyles },
    }
  },
})
