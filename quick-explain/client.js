window.__ModuleLoader__.load({
  id: '@local/quick-explain',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** The bundle's own package name: the key its page dispatches to us. */
    const PACKAGE_NAME = '@local/quick-explain';

    /** Locale dictionary namespace. */
    const NS = 'quickExplain';
    /** The one text-interaction key this plugin owns. */
    const INTERACTION_ID = 'quick-explain';
    /** Matches the Host route in index.js. */
    const EXPLAIN_PATH = '/quick-explain/explain';
    /** How much of the surrounding message to send as context. */
    const CONTEXT_LIMIT = 4000;

    /** Simplified Chinese dictionary and key source. */
    const zh = {
      'action.explain': '快速解释',
      'panel.title': '解释',
      'panel.close': '关闭',
      'panel.loading': '正在解释…',
      'panel.retry': '重试',
      'panel.failed': '解释失败',
      'panel.empty': '没有返回内容',
      'nav': '快速解释',
      'history.title': '解释历史',
      'history.intro': '每次快速解释的完整记录：选中了什么、给了什么上下文、提示词、思考过程与回答。',
      'history.empty': '还没有解释记录。在会话里选中文字后右键，选择「快速解释」。',
      'history.loading': '正在加载…',
      'history.failed': '加载失败',
      'history.retry': '重试',
      'history.refresh': '刷新',
      'history.clear': '清空全部',
      'history.clearConfirm': '确定清空全部解释记录？此操作不可撤销。',
      'history.count': '共 {count} 条',
      'history.selection': '选中的文本',
      'history.context': '上下文',
      'history.noContext': '（没有记录到上下文）',
      'history.userPrompt': '发送的提示词',
      'history.systemPrompt': '系统提示词',
      'history.reasoning': '思考过程',
      'history.noReasoning': '（这次没有返回思考内容）',
      'history.answer': '解释',
      'history.model': '模型',
      'history.expand': '查看完整记录',
      'history.collapse': '收起'
    };

    /** English dictionary. */
    const en = {
      'action.explain': 'Explain quickly',
      'panel.title': 'Explain',
      'panel.close': 'Close',
      'panel.loading': 'Explaining…',
      'panel.retry': 'Retry',
      'panel.failed': 'Explanation failed',
      'panel.empty': 'No content returned',
      'nav': 'Quick explain',
      'history.title': 'Explanation history',
      'history.intro': 'Every quick explanation in full: what was selected, the context supplied, the prompt, the reasoning, and the answer.',
      'history.empty': 'No explanations yet. Select text in a conversation, right-click, and choose "Explain quickly".',
      'history.loading': 'Loading…',
      'history.failed': 'Failed to load',
      'history.retry': 'Retry',
      'history.refresh': 'Refresh',
      'history.clear': 'Clear all',
      'history.clearConfirm': 'Clear every recorded explanation? This cannot be undone.',
      'history.count': '{count} in total',
      'history.selection': 'Selected text',
      'history.context': 'Context',
      'history.noContext': '(no context recorded)',
      'history.userPrompt': 'Prompt sent',
      'history.systemPrompt': 'System prompt',
      'history.reasoning': 'Reasoning',
      'history.noReasoning': '(this call returned no reasoning)',
      'history.answer': 'Explanation',
      'history.model': 'Model',
      'history.expand': 'Show full record',
      'history.collapse': 'Collapse'
    };

    /**
     * Read the nearest enclosing message row and return its text.
     *
     * Chat marks each row with `data-chat-flow-key`; the selection's anchor sits
     * inside one. Context is what makes an overloaded phrase interpretable, so
     * the lookup is worth it, but a miss only costs context, never the answer.
     */
    function messageContextOf(source) {
      const row = source === null ? null : source.closest('[data-chat-flow-key]');
      if (row === null) return undefined;
      const text = (row.textContent || '').trim();
      if (text === '') return undefined;
      return text.length > CONTEXT_LIMIT ? text.slice(0, CONTEXT_LIMIT) : text;
    }

    /** Panel surface styling drawn from host theme tokens. */
    function panelStyle() {
      return {
        width: 'min(380px, 100%)',
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-primary, #fff))',
        border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12))',
        borderRadius: '12px',
        boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(0,0,0,.18))',
        color: 'var(--dsw-alias-label-primary, #111)',
        font: 'var(--dsw-font-xs-13, 13px/1.5 system-ui, sans-serif)',
        padding: '10px 12px',
        boxSizing: 'border-box'
      };
    }

    /**
     * The right-click action and its explanation panel.
     *
     * One surface holds both phases: a single action row, then the streaming
     * explanation replacing it. Keeping them together means the panel appears at
     * the pointer at once and does not jump when the user commits.
     */
    function QuickExplainSurface(props) {
      const { trigger, readText, dismiss, t } = props;
      const [phase, setPhase] = React.useState('menu');
      const [body, setBody] = React.useState('');
      const [failure, setFailure] = React.useState(null);
      const abortRef = React.useRef(null);
      const inputRef = React.useRef(null);

      // Selection-driven openings are ignored outright: this plugin answers the
      // context menu only, so selecting text stays as quiet as it is today.
      const eligible = trigger === 'contextmenu';

      const stop = React.useCallback(() => {
        if (abortRef.current !== null) abortRef.current.abort();
        abortRef.current = null;
      }, []);

      React.useEffect(() => stop, [stop]);

      const run = React.useCallback(async () => {
        const input = inputRef.current;
        if (input === null) return;
        stop();
        const controller = new AbortController();
        abortRef.current = controller;
        setPhase('running');
        setBody('');
        setFailure(null);

        try {
          const response = await fetch(EXPLAIN_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal
          });
          if (!response.ok || response.body === null) {
            throw new Error('request failed (' + response.status + ')');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let assembled = '';

          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });

            // Frames end with a blank line; an incomplete tail stays buffered.
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');

              const eventLine = /^event: (.+)$/m.exec(frame);
              const dataLine = /^data: (.+)$/m.exec(frame);
              if (eventLine === null || dataLine === null) continue;

              const payload = JSON.parse(dataLine[1]);
              if (eventLine[1] === 'delta') {
                assembled += payload.text;
                setBody(assembled);
              } else if (eventLine[1] === 'done') {
                setPhase('ready');
                if (assembled.trim() === '') setFailure(t('panel.empty'));
                return;
              } else if (eventLine[1] === 'failed') {
                setPhase('failed');
                setFailure(payload.message);
                return;
              }
            }
          }
          setPhase('ready');
          if (assembled.trim() === '') setFailure(t('panel.empty'));
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setPhase('failed');
          setFailure(error instanceof Error ? error.message : String(error));
        }
      }, [t, stop]);

      if (!eligible) return null;

      if (phase === 'menu') {
        return h('button', {
          type: 'button',
          style: Object.assign({}, panelStyle(), {
            width: 'auto',
            padding: '6px 12px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'block'
          }),
          onPointerDown: function (event) { event.preventDefault(); },
          onClick: function () {
            // Read the selection before the click disturbs it.
            const text = readText();
            if (text === null) {
              dismiss();
              return;
            }
            const selection = window.getSelection();
            const anchor = selection === null ? null : selection.anchorNode;
            const source = anchor === null
              ? null
              : anchor instanceof Element
                ? anchor
                : anchor.parentElement;
            const context = messageContextOf(source);
            inputRef.current = context === undefined ? { selection: text } : { selection: text, context: context };
            void run();
          }
        }, t('action.explain'));
      }

      const retry = failure === null ? null : h('button', {
        type: 'button',
        onPointerDown: function (event) { event.preventDefault(); },
        onClick: function () { void run(); },
        style: {
          border: 'none',
          background: 'transparent',
          color: 'var(--dsw-alias-label-link, #2563eb)',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit',
          textDecoration: 'underline'
        }
      }, t('panel.retry'));

      return h('div', {
        style: panelStyle(),
        role: 'dialog',
        'aria-label': t('panel.title')
      },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '6px',
            color: 'var(--dsw-alias-label-secondary, #666)',
            font: 'var(--dsw-font-caption, 12px/1.4 system-ui, sans-serif)'
          }
        },
          h('span', null, t('panel.title')),
          h('button', {
            type: 'button',
            'aria-label': t('panel.close'),
            onPointerDown: function (event) { event.preventDefault(); },
            onClick: function () { stop(); dismiss(); },
            style: {
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'inherit',
              padding: '0 2px',
              font: 'inherit',
              lineHeight: 1
            }
          }, '\u00d7')
        ),
        h('div', {
          style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
        },
          phase === 'running' && body === ''
            ? h('span', { style: { opacity: 0.6 } }, t('panel.loading'))
            : body
        ),
        failure === null ? null : h('div', {
          style: {
            marginTop: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--dsw-alias-label-error, #c0392b)'
          }
        }, h('span', null, t('panel.failed') + ': ' + failure), retry)
      );
    }

    /** History routes, mirroring the Host routes in index.js. */
    const HISTORY_SEGMENT = '/quick-explain/history';
    const HISTORY_CLEAR_SEGMENT = '/quick-explain/history/clear';

    /** One collapsible labelled block inside a history card. */
    function Field(props) {
      const { label, children, muted } = props;
      return h('div', { style: { marginTop: '10px' } },
        h('div', {
          style: {
            color: 'var(--dsw-alias-label-secondary, #666)',
            font: 'var(--dsw-font-caption, 12px/1.4 system-ui, sans-serif)',
            marginBottom: '3px'
          }
        }, label),
        h('div', {
          style: {
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            font: muted
              ? 'var(--dsw-font-caption, 12px/1.5 system-ui, sans-serif)'
              : undefined,
            opacity: muted ? 0.75 : 1
          }
        }, children)
      );
    }

    /** One recorded explanation, collapsed to its answer until expanded. */
    function HistoryCard(props) {
      const { record, t } = props;
      const [open, setOpen] = React.useState(false);
      const when = new Date(record.time);

      return h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12))',
          borderRadius: '12px',
          padding: '12px 14px',
          marginBottom: '10px',
          background: 'var(--dsw-alias-bg-primary, #fff)'
        }
      },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '12px'
          }
        },
          h('div', {
            style: { fontWeight: 600, wordBreak: 'break-word' }
          }, record.selection.length > 80
            ? record.selection.slice(0, 80) + '…'
            : record.selection),
          h('div', {
            style: {
              flexShrink: 0,
              color: 'var(--dsw-alias-label-secondary, #666)',
              font: 'var(--dsw-font-caption, 12px/1.4 system-ui, sans-serif)'
            }
          }, when.toLocaleString())
        ),
        h('div', { style: { marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
          record.answer
        ),
        h('button', {
          type: 'button',
          onClick: function () { setOpen(!open); },
          style: {
            marginTop: '10px',
            border: 'none',
            background: 'transparent',
            color: 'var(--dsw-alias-label-link, #2563eb)',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            textDecoration: 'underline'
          }
        }, open ? t('history.collapse') : t('history.expand')),
        open ? h('div', null,
          h(Field, { label: t('history.selection') }, record.selection),
          h(Field, { label: t('history.context'), muted: true },
            record.context === undefined ? t('history.noContext') : record.context),
          h(Field, { label: t('history.model'), muted: true },
            record.provider + ' / ' + record.model
            + (record.reasoningEffort === undefined ? '' : ' / ' + record.reasoningEffort)),
          h(Field, { label: t('history.systemPrompt'), muted: true }, record.systemPrompt),
          h(Field, { label: t('history.userPrompt'), muted: true }, record.userPrompt),
          h(Field, { label: t('history.reasoning'), muted: true },
            record.reasoning === '' ? t('history.noReasoning') : record.reasoning)
        ) : null
      );
    }

    /**
     * This bundle's configuration area on its own page in Settings.
     *
     * The page already supplies the title and description above this region, so
     * the card does not repeat them: it states what the list is for and then
     * lists the recorded explanations. Reads and clears go through the Host
     * routes, so the browser never holds its own copy of the record file.
     */
    function QuickExplainHistorySection(props) {
      const { t, view } = props;
      const page = view !== 'summary';
      const [state, setState] = React.useState({ phase: 'loading', records: [], error: null });

      const load = React.useCallback(function () {
        setState({ phase: 'loading', records: [], error: null });
        fetch(HISTORY_SEGMENT, { headers: { accept: 'application/json' } })
          .then(function (response) {
            if (!response.ok) throw new Error('request failed (' + response.status + ')');
            return response.json();
          })
          .then(function (payload) {
            setState({ phase: 'ready', records: payload.records || [], error: null });
          })
          .catch(function (error) {
            setState({
              phase: 'failed',
              records: [],
              error: error instanceof Error ? error.message : String(error)
            });
          });
      }, []);

      // A summary view answers with the one line that describes the region; the
      // page view does the work. Loading only there keeps a collapsed row from
      // issuing a request the reader never asked for.
      React.useEffect(function () {
        if (page) load();
      }, [load, page]);

      const clear = React.useCallback(function () {
        if (!window.confirm(t('history.clearConfirm'))) return;
        fetch(HISTORY_CLEAR_SEGMENT, { method: 'POST' })
          .then(function () { load(); })
          .catch(function () { load(); });
      }, [load, t]);

      const captionStyle = {
        margin: '2px 0 0',
        color: 'var(--dsw-alias-label-tertiary, #999)',
        font: 'var(--dsw-font-caption, 12px/18px system-ui, sans-serif)'
      };

      if (!page) {
        return h('p', { style: captionStyle }, t('history.intro'));
      }

      const toolbar = h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          margin: '10px 0 12px',
          flexWrap: 'wrap'
        }
      },
        h('button', {
          type: 'button',
          onClick: load,
          style: {
            border: '1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.18))',
            background: 'transparent',
            color: 'inherit',
            borderRadius: '8px',
            padding: '4px 10px',
            cursor: 'pointer',
            font: 'inherit'
          }
        }, t('history.refresh')),
        state.records.length > 0
          ? h('button', {
              type: 'button',
              onClick: clear,
              style: {
                border: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-error, #c0392b)',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
                textDecoration: 'underline'
              }
            }, t('history.clear'))
          : null,
        state.phase === 'ready' && state.records.length > 0
          ? h('span', {
              style: Object.assign({}, captionStyle, { marginLeft: 'auto', margin: 0 })
            }, t('history.count').replace('{count}', String(state.records.length)))
          : null
      );

      let body;
      if (state.phase === 'loading') {
        body = h('p', { style: captionStyle }, t('history.loading'));
      } else if (state.phase === 'failed') {
        body = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('span', { style: { color: 'var(--dsw-alias-label-error, #c0392b)' } },
            t('history.failed') + ': ' + state.error),
          h('button', {
            type: 'button',
            onClick: load,
            style: {
              border: 'none', background: 'transparent',
              color: 'var(--dsw-alias-label-link, #2563eb)',
              cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline'
            }
          }, t('history.retry'))
        );
      } else if (state.records.length === 0) {
        body = h('p', { style: captionStyle }, t('history.empty'));
      } else {
        body = h('div', null, state.records.map(function (record) {
          return h(HistoryCard, { key: record.id, record: record, t: t });
        }));
      }

      return h('section', null,
        h('p', { style: captionStyle }, t('history.intro')),
        toolbar,
        body
      );
    }

    return {
      name: 'quick-explain',
      inject: ['slots', 'locale', 'sessions', 'uiConversation'],
      apply: function (ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'quick-explain: dictionaries');

        ctx.effect(function () {
          return ctx.uiConversation.interactions.register({
            id: INTERACTION_ID,
            onInteraction: function (request) {
              // Answer the context menu only, and only when text is selected, so
              // a right-click on empty space keeps its ordinary behaviour.
              if (request.trigger !== 'contextmenu') return;
              if (request.readText() === null) return;
              request.open();
            }
          });
        }, 'quick-explain: context-menu interaction');

        ctx.slots.inject('conversation.chat.text-interaction', function () {
          return ctx.slots.register({
            name: 'conversation.chat.text-interaction',
            key: INTERACTION_ID,
            locale: NS
          }, QuickExplainSurface);
        });

        // Render on this bundle's own page in Settings, between its description
        // and its row list, which is where a bundle's configuration belongs. The
        // key is the bundle's package name: that is what the page dispatches.
        ctx.slots.inject('plugins.bundle.config', function () {
          return ctx.slots.register({
            name: 'plugins.bundle.config',
            key: PACKAGE_NAME,
            priority: 30,
            locale: NS
          }, QuickExplainHistorySection);
        });
      }
    };
  }
});
