/**
 * dsh-android-mirror-pane · 右栏面板的页面半边。
 *
 * 一栏两件事：看和动。
 *   · 看：宿主把设备画面按 multipart 推过来，这里直接贴到 <canvas> 上；
 *   · 动：鼠标按下就是点按，拖动就是滑动，滚轮是滚动，键位走工具栏。
 *
 * 画面、抓帧、注入都在宿主那半边，这里只负责画出来和收集人的动作。
 * 所有请求都发往同源相对路径，不碰任何外部地址。
 */

/* 模块只注册一次：宿主热重载可能把同一份 client 再执行一遍，
   factory 若重复执行会整条 web boot 失败，所以用标记挡住。 */
if (window.__DAMP_LOADED__ !== true) {
  window.__DAMP_LOADED__ = true
  try {
    window.__ModuleLoader__.load({
      id: 'dsh-android-mirror-pane',
      factory(load) {
        const React = load('react')
        const h = React.createElement

        const ID = 'dsh-android-mirror-pane' // ui-copy-ignore
        const NS = 'android-mirror' // ui-copy-ignore
        const KIND = 'android-mirror' // ui-copy-ignore
        const SLOT = 'sidebar.right.pane.tab'
        const TITLE_SLOT = 'sidebar.right.pane.tab.title'
        const ROUTE = '/_dsh/dsh-android-mirror-pane' // ui-copy-ignore
        /* multipart 每段头部的结束标记，用来把头部与 JPEG 字节分开。 */
        const HEADER_END = '\r\n\r\n' // ui-copy-ignore

        const DICT = {
          zh: {
            'type.label': '安卓投屏',
            'type.hint': '真机画面实时显示，点一下就是点手机',
            'act.refresh': '刷新',
            'act.fit': '恢复为适应窗口大小时点击',
            'act.zoomIn': '放大',
            'act.zoomOut': '缩小',
            'act.screenshot': '截图',
            'act.mark': '标注',
            'act.undo': '撤销',
            'act.clearMark': '清除标注',
            'act.copyShot': '复制截图到剪贴板',
            'act.saveFile': '存文件',
            'mode.touch': '触控',
            'mode.mark': '标注',
            'mode.key': '按键',
            'mark.tool': '形状',
            'mark.free': '手绘',
            'mark.rect': '矩形',
            'mark.arrow': '箭头',
            'mark.text': '文字',
            'mark.color': '颜色',
            'mark.width': '粗细',
            'mark.textPlaceholder': '输入要标注的文字，再点画面落下',
            'mark.count': '标注',
            'shot.copied': '已复制，按 ⌘V 粘到输入框',
            'shot.copyFailed': '复制失败',
            'key.back': '返回',
            'key.title': '发送按键',
            'key.enter': '回车',
            'key.del': '删除',
            'key.tab': '制表',
            'key.volUp': '音量 +',
            'key.volDown': '音量 −',
            'ph.text': '输入文字',
            'act.text': '输入',
            'empty.none': '没有可用的安卓设备，插上 USB 线并授权调试即可',
            'empty.starting': '画面准备中',
            'empty.gone': '设备已断开，接回来会自动恢复',
            'state.bad': '画面异常',
            'state.offline': '离线',
            'state.live': '已连接',
            'act.device': '设备',
            'tab.screen': '画面',
            'tab.log': '日志',
            'tab.preview': '预览',
            'pv.search': '按页面名或 FQN 搜索',
            'pv.refresh': '刷新索引',
            'pv.refreshing': '正在扫描 @Preview…',
            'pv.allModules': '全部模块',
            'pv.onlyStale': '只看要更新的',
            'pv.stale': '源码已变',
            'pv.fresh': '是最新',
            'pv.never': '从未渲染',
            'pv.error': '渲染失败',
            'pv.render': '渲染',
            'pv.rerender': '重新渲染',
            'pv.queued': '排队中',
            'pv.running': '渲染中',
            'pv.back': '返回',
            'pv.noCli': '没有找到 Android CLI，装好后点「刷新索引」',
            'pv.empty': '还没有索引到任何 @Preview，点「刷新索引」扫一遍',
            'pv.emptyFilter': '当前筛选下没有条目',
            'pv.total': '共',
            'pv.tree': '语义树',
            'pv.treeAll': '显示全部节点',
            'pv.treeSemantic': '只显示有语义的',
            'pv.treeEmpty': '这个 preview 没有语义树数据',
            'pv.treeNodes': '节点',
            'pv.size': '尺寸',
            'pv.rendered': '渲染于',
            'pv.renderer': '渲染器',
            'pv.treeHint': '悬停一行可在图上看到它的边界',
            'pv.noImage': '还没有图，点「渲染」',
            'pv.studioReady': 'Studio 就绪',
            'pv.studioAway': '无 Studio，走 headless',
            'pv.errorTitle': '渲染失败原因',
            'pv.detailHint': '共',
            'pv.ofNodes': '个节点',
            'pv.repo': '仓库',
            'pv.needsStudio': '需 Studio',
            'pv.needsStudioHint': '该模块带 flavors，只能用已打开本项目的 Studio 渲染',
            'pv.discovering': '正在发现模块…',
            'pv.discovery': '发现',
            'pv.zoomIn': '放大图片',
            'pv.zoomOut': '缩小图片',
            'pv.zoomFit': '适应窗口（回到 100%）',
            'pv.pickHint': '点图上的位置可在右边定位到对应节点',
            'pv.pickHidden': '该节点不在「仅语义节点」里，已切换到显示全部',
            'pv.export': '导出语义树',
            'pv.exportHint': '把当前语义树复制成 Markdown 表格',
            'pv.exportScope': '导出范围',
            'pv.exportScopeAll': '全部节点',
            'pv.exportScopeSemantic': '仅语义节点',
            'pv.exportCopied': '语义树已复制到剪贴板',
            'pv.exportPrompt': '剪贴板不可用，请手动复制下面的语义树：',
            'pv.exportFailed': '复制失败：浏览器不允许写剪贴板',
            'pv.renderModule': '渲染本模块',
            'pv.renderModuleHint': '把这个模块下需要更新的 preview 一起排进队列',
            'pv.renderMissing': '渲染全部缺失',
            'pv.renderMissingHint': '批量渲染当前筛选里还没最新的内容，一次最多 10 个',
            'pv.batchQueuing': '排队中…',
            'pv.batchRendering': '正在渲染',
            'pv.batchFailed': '失败',
            'pv.batchDone': '批量渲染完成，已刷新列表',
            'pv.batchNothing': '没有可排的：都已在队列里或已经是最新',
            'pv.batchQueued': '已排入',
            'pv.batchLeftOut': '个未排入，剩下的请按模块渲染',
            'pv.batchSkipped': '已在队列',
            'pv.batchUnknown': '索引里没有',
            'pv.diffOpen': '对比',
            'pv.diffTab': '对比上一版',
            'pv.diffHint': '算出与上一次渲染的语义差异，用到时才算',
            'pv.diffLoading': '正在计算差异…',
            'pv.diffEmpty': '还没有对比数据',
            'pv.diffFirst': '首次渲染，没有可对比的基线',
            'pv.diffNone': '与上一版没有差异',
            'pv.diffAdded': '新增',
            'pv.diffRemoved': '消失',
            'pv.diffTextChanged': '文字变化',
            'pv.diffGeometry': '位移',
            'pv.diffFrame': '画布尺寸变了',
            'pv.diffFrameHint': '坐标不可直接比较',
            'pv.diffFieldText': '文字',
            'pv.diffFieldDesc': '描述',
            'pv.diffFieldRole': '角色',
            'pv.diffMoved': '位移',
            'pv.diffRefresh': '重新对比',
            'pv.diffHover': '悬停一条，左侧图上标出位置（红色虚线是旧位置）',
            'log.target': '日志来源',
            'log.all': '全部应用',
            'log.follow': '当前',
            'log.level': '最低级别',
            'log.filter': '按关键词过滤（tag 或正文）',
            'log.onlyCrash': '只看崩溃与 ANR',
            'log.crash': '崩溃',
            'log.clear': '清空',
            'log.empty': '暂无日志',
            'log.waiting': '等待应用启动…',
            'log.live': '采集中',
            'log.paused': '未采集',
            'log.shown': '显示',
            'log.total': '累计',
            'log.dropped': '已滚出',
          },
          en: {
            'type.label': 'Android Mirror',
            'type.hint': 'The phone screen, live; tap it to tap the phone',
            'act.refresh': 'Refresh',
            'act.fit': 'Click to reset to fit',
            'act.zoomIn': 'Zoom in',
            'act.zoomOut': 'Zoom out',
            'act.screenshot': 'Screenshot',
            'act.mark': 'Mark',
            'act.undo': 'Undo',
            'act.clearMark': 'Clear marks',
            'act.copyShot': 'Copy screenshot',
            'act.saveFile': 'Save file',
            'mode.touch': 'Touch',
            'mode.mark': 'Mark',
            'mode.key': 'Keys',
            'mark.tool': 'Shape',
            'mark.free': 'Free',
            'mark.rect': 'Rect',
            'mark.arrow': 'Arrow',
            'mark.text': 'Text',
            'mark.color': 'Color',
            'mark.width': 'Width',
            'mark.textPlaceholder': 'Type a note, then tap the screen',
            'mark.count': 'Marks',
            'shot.copied': 'Copied — press Cmd+V in the input',
            'shot.copyFailed': 'Copy failed',
            'key.back': 'Back',
            'key.title': 'Send key',
            'key.enter': 'Enter',
            'key.del': 'Backspace',
            'key.tab': 'Tab',
            'key.volUp': 'Vol +',
            'key.volDown': 'Vol −',
            'ph.text': 'Type text',
            'act.text': 'Type',
            'empty.none': 'No Android device; plug in USB and allow debugging',
            'empty.starting': 'Preparing the screen',
            'empty.gone': 'Device disconnected; it will recover when reconnected',
            'state.bad': 'Screen error',
            'state.offline': 'Offline',
            'state.live': 'Connected',
            'act.device': 'Device',
            'tab.screen': 'Screen',
            'tab.log': 'Logcat',
            'tab.preview': 'Preview',
            'pv.search': 'Search by page name or FQN',
            'pv.refresh': 'Rescan',
            'pv.refreshing': 'Scanning @Preview…',
            'pv.allModules': 'All modules',
            'pv.onlyStale': 'Needs update only',
            'pv.stale': 'Source changed',
            'pv.fresh': 'Up to date',
            'pv.never': 'Never rendered',
            'pv.error': 'Render failed',
            'pv.render': 'Render',
            'pv.rerender': 'Re-render',
            'pv.queued': 'Queued',
            'pv.running': 'Rendering',
            'pv.back': 'Back',
            'pv.noCli': 'Android CLI not found — install it, then press Rescan',
            'pv.empty': 'No @Preview indexed yet — press Rescan',
            'pv.emptyFilter': 'Nothing matches the current filter',
            'pv.total': 'Total',
            'pv.tree': 'Semantics',
            'pv.treeAll': 'Show every node',
            'pv.treeSemantic': 'Semantic nodes only',
            'pv.treeEmpty': 'No semantics data for this preview',
            'pv.treeNodes': 'nodes',
            'pv.size': 'Size',
            'pv.rendered': 'Rendered',
            'pv.renderer': 'Renderer',
            'pv.treeHint': 'Hover a row to see its bounds on the image',
            'pv.noImage': 'No image yet — press Render',
            'pv.studioReady': 'Studio ready',
            'pv.studioAway': 'No Studio, using headless',
            'pv.errorTitle': 'Why it failed',
            'pv.detailHint': 'of',
            'pv.ofNodes': 'nodes',
            'pv.repo': 'Repo',
            'pv.needsStudio': 'Needs Studio',
            'pv.needsStudioHint': 'This module declares flavors; it can only render through Studio with this project open',
            'pv.discovering': 'Discovering modules…',
            'pv.discovery': 'discovery',
            'pv.zoomIn': 'Zoom image in',
            'pv.zoomOut': 'Zoom image out',
            'pv.zoomFit': 'Fit to window (back to 100%)',
            'pv.pickHint': 'Click the image to locate that node in the tree',
            'pv.pickHidden': 'That node is filtered out; switched to showing every node',
            'pv.export': 'Export semantics',
            'pv.exportHint': 'Copy the current semantics tree as a Markdown table',
            'pv.exportScope': 'Scope',
            'pv.exportScopeAll': 'All nodes',
            'pv.exportScopeSemantic': 'Semantic nodes only',
            'pv.exportCopied': 'Semantics tree copied to clipboard',
            'pv.exportPrompt': 'Clipboard unavailable — copy the tree below by hand:',
            'pv.exportFailed': 'Copy failed: the browser refused clipboard access',
            'pv.renderModule': 'Render module',
            'pv.renderModuleHint': 'Queue every preview in this module that needs a render',
            'pv.renderMissing': 'Render all missing',
            'pv.renderMissingHint': 'Batch-render what the current filter still lacks, at most 10 at a time',
            'pv.batchQueuing': 'Queueing…',
            'pv.batchRendering': 'Rendering',
            'pv.batchFailed': 'failed',
            'pv.batchDone': 'Batch finished — list refreshed',
            'pv.batchNothing': 'Nothing to queue: all fresh or already queued',
            'pv.batchQueued': 'queued',
            'pv.batchLeftOut': 'left out — render those per module',
            'pv.batchSkipped': 'already queued',
            'pv.batchUnknown': 'not indexed',
            'pv.diffOpen': 'Diff',
            'pv.diffTab': 'Compare to previous',
            'pv.diffHint': 'Compute the semantic diff against the previous render, only on demand',
            'pv.diffLoading': 'Computing diff…',
            'pv.diffEmpty': 'No diff loaded yet',
            'pv.diffFirst': 'First render — nothing to compare against',
            'pv.diffNone': 'No differences from the previous render',
            'pv.diffAdded': 'Added',
            'pv.diffRemoved': 'Removed',
            'pv.diffTextChanged': 'Text changed',
            'pv.diffGeometry': 'Moved',
            'pv.diffFrame': 'Canvas size changed',
            'pv.diffFrameHint': 'coordinates are not comparable',
            'pv.diffFieldText': 'text',
            'pv.diffFieldDesc': 'description',
            'pv.diffFieldRole': 'role',
            'pv.diffMoved': 'moved',
            'pv.diffRefresh': 'Recompute',
            'pv.diffHover': 'Hover a row to mark it on the image (red dashed is the old position)',
            'log.target': 'Log source',
            'log.all': 'All apps',
            'log.follow': 'Current',
            'log.level': 'Minimum level',
            'log.filter': 'Filter by keyword (tag or message)',
            'log.onlyCrash': 'Crashes and ANR only',
            'log.crash': 'Crashes',
            'log.clear': 'Clear',
            'log.empty': 'No log lines yet',
            'log.waiting': 'Waiting for the app to start…',
            'log.live': 'Capturing',
            'log.paused': 'Idle',
            'log.shown': 'Shown',
            'log.total': 'Total',
            'log.dropped': 'Dropped',
          },
        }
        const LANG = /^zh/i.test(typeof navigator === 'undefined' ? '' : navigator.language ?? '') ? 'zh' : 'en'
        const L = (key) => DICT[LANG][key] ?? key

        const CSS = `
.damp-body{display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;padding:8px;box-sizing:border-box}
.damp-toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:0 0 auto}
.damp-btn{font:inherit;font-size:11px;line-height:1.6;padding:2px 8px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;cursor:pointer}
.damp-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.damp-btn[data-active="true"]{background:color-mix(in srgb,currentColor 18%,transparent)}
.damp-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;border-radius:8px;background:color-mix(in srgb,#888 12%,transparent);padding:4px}
.damp-canvas{touch-action:none;cursor:crosshair;display:block;margin:auto;flex:0 0 auto}
/* 标注叠层：盖在画布正上方，不接指针事件（由画布统一处理，避免两套坐标）。 */
.damp-overlay{position:absolute;pointer-events:none;z-index:2}
.damp-canvas[data-tool="free"],.damp-canvas[data-tool="rect"],.damp-canvas[data-tool="arrow"],.damp-canvas[data-tool="text"]{cursor:crosshair}
/* 分区面板：选中某个模式后才出现，只放该模式的动作，不挤占主栏。 */
.damp-panel{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:0 0 auto;padding:5px 7px;border-radius:7px;background:color-mix(in srgb,currentColor 7%,transparent);border:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.damp-panellabel{font-size:10.5px;opacity:.62;letter-spacing:.02em}
.damp-panelvalue{font-size:11px;min-width:14px;text-align:center;font-variant-numeric:tabular-nums}
.damp-toolsep{width:1px;height:14px;background:color-mix(in srgb,currentColor 16%,transparent);margin:0 2px}
.damp-swatch{width:16px;height:16px;padding:0;border-radius:4px;border:1px solid color-mix(in srgb,currentColor 28%,transparent);cursor:pointer}
.damp-swatch[data-active="true"]{outline:2px solid currentColor;outline-offset:1px}
.damp-marktext{max-width:200px;flex:0 1 200px}
/* 复制是主要动作用，稍微强调一下；一次性提示淡入即读。 */
.damp-primary{border-color:color-mix(in srgb,#0a84ff 55%,currentColor);color:color-mix(in srgb,#0a84ff 70%,currentColor)}
.damp-notice{color:color-mix(in srgb,#34c759 78%,currentColor);animation:damp-fade .18s ease-out}
@keyframes damp-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
.damp-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;font-size:12px;opacity:.72;pointer-events:none}
.damp-status{flex:0 0 auto;font-size:11px;opacity:.7;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.damp-dot{width:6px;height:6px;border-radius:50%;background:#c33}
.damp-dot[data-live="true"]{background:#2a2}
.damp-text{display:flex;gap:4px;flex:0 0 auto}
/* 外壳：标签栏固定，内容占满剩余高度。 */
.damp-shell{display:flex;flex-direction:column;height:100%;min-height:0}
.damp-tabs{display:flex;gap:2px;flex:0 0 auto;padding:4px 6px 0;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.damp-tab{font:inherit;font-size:11.5px;padding:4px 12px;border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.damp-tab:hover{opacity:.9}
.damp-tab[data-active="true"]{opacity:1;background:color-mix(in srgb,currentColor 10%,transparent);border-color:color-mix(in srgb,currentColor 14%,transparent)}
.damp-tabpane{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
/* 日志页：工具条一行，列表占满其余，等宽字体便于对齐 tag。 */
.damp-logcat{display:flex;flex-direction:column;height:100%;min-height:0;gap:4px;padding:6px}
.damp-logbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:0 0 auto}
.damp-logfilter{max-width:180px;flex:0 1 180px}
.damp-loglist{flex:1 1 auto;min-height:0;overflow:auto;border-radius:6px;background:color-mix(in srgb,#888 8%,transparent);padding:4px 6px;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:11px;line-height:1.5}
.damp-logline{display:flex;gap:6px;white-space:pre-wrap;word-break:break-word;padding:1px 0}
.damp-logline.is-crash{background:color-mix(in srgb,#e05252 18%,transparent);border-radius:3px}
.damp-logtime{color:color-mix(in srgb,currentColor 55%,transparent);flex:0 0 auto}
.damp-loglevel{flex:0 0 auto;font-weight:700;width:10px}
.damp-logtag{flex:0 0 auto;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
.damp-logmsg{flex:1 1 auto;min-width:0}
.damp-logsection{color:color-mix(in srgb,currentColor 50%,transparent);padding:2px 0;border-top:1px dashed color-mix(in srgb,currentColor 14%,transparent);margin-top:3px}
.damp-input{flex:1 1 auto;min-width:0;font:inherit;font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit}
/* 预览页：工具条固定在顶部，卡片网格自己滚。 */
.damp-pv{display:flex;flex-direction:column;height:100%;min-height:0;gap:5px;padding:6px}
.damp-pvbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:0 0 auto}
.damp-pvsearch{max-width:170px;flex:0 1 170px}
.damp-pvcount{font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.damp-pvgrid{flex:1 1 auto;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;align-content:start;padding:2px}
.damp-pvcard{display:flex;flex-direction:column;gap:3px;padding:4px;border-radius:7px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);cursor:pointer;text-align:left;font:inherit;color:inherit;min-width:0}
.damp-pvcard:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.damp-pvthumb{position:relative;width:100%;aspect-ratio:9/16;border-radius:5px;overflow:hidden;background:color-mix(in srgb,#888 14%,transparent);display:flex;align-items:center;justify-content:center}
.damp-pvthumb img{width:100%;height:100%;object-fit:contain;display:block}
.damp-pvthumb[data-empty="true"]{font-size:10px;opacity:.55;text-align:center;padding:4px}
.damp-pvname{font-size:10.5px;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.damp-pvmeta{display:flex;align-items:center;gap:4px;font-size:9.5px;opacity:.62;min-width:0}
.damp-pvmeta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.damp-pvdot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#999}
.damp-pvdot[data-s="fresh"]{background:#34c759}
.damp-pvdot[data-s="stale"]{background:#e5a50a}
.damp-pvdot[data-s="never"]{background:#8e8e93}
.damp-pvdot[data-s="error"]{background:#e05252}
.damp-pvdot[data-s="running"]{background:#0a84ff;animation:damp-pulse 1s ease-in-out infinite}
@keyframes damp-pulse{50%{opacity:.3}}
.damp-pvgroup{grid-column:1/-1;display:flex;align-items:center;gap:6px;font-size:10.5px;opacity:.6;padding:5px 2px 1px;border-top:1px dashed color-mix(in srgb,currentColor 14%,transparent);margin-top:2px}
.damp-pvgroup:first-child{border-top:none;margin-top:0}
/* 批量渲染进度：一条细进度条 + 一行计数，跑完即消失，不占常驻空间。 */
.damp-pvbatch{display:flex;flex-direction:column;gap:3px;flex:0 0 auto;padding:4px 6px;border-radius:6px;background:color-mix(in srgb,#0a84ff 10%,transparent);border:1px solid color-mix(in srgb,#0a84ff 30%,transparent)}
.damp-pvbatchrow{display:flex;align-items:center;gap:6px;font-size:10.5px;font-variant-numeric:tabular-nums}
.damp-pvbatchrow span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.damp-pvbar-track{position:relative;height:3px;border-radius:2px;background:color-mix(in srgb,currentColor 18%,transparent);overflow:hidden}
.damp-pvbar-fill{position:absolute;inset:0 auto 0 0;border-radius:2px;background:#0a84ff;transition:width .3s ease-out}
/* 模块标题行右侧的批量按钮：标题行本身不是按钮，按钮要能独立点。 */
.damp-pvgroupbtn{margin-left:auto;font-size:9.5px;line-height:1.5;padding:0 5px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;cursor:pointer;opacity:.9}
.damp-pvgroupbtn:hover:not(:disabled){background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}
.damp-pvgroupbtn:disabled{opacity:.45;cursor:default}
/* diff 面板与语义树共用右侧那一栏，靠开关二选一。 */
.damp-pvdiff{display:flex;flex-direction:column;gap:4px}
.damp-pvdiffsummary{display:flex;flex-wrap:wrap;gap:6px;font-size:10.5px;opacity:.72;font-variant-numeric:tabular-nums}
/* 列表本身不设自己的滚动：外层 .damp-pvtree 已经是滚动容器，
   再套一层会出现「内层滚不动、外层在滚」的双滚动条。 */
.damp-pvdifflist{display:flex;flex-direction:column;gap:2px}
.damp-pvdiffrow{display:flex;gap:5px;align-items:baseline;padding:2px 4px;border-radius:4px;cursor:pointer;white-space:nowrap;font-size:10.5px}
.damp-pvdiffrow:hover{background:color-mix(in srgb,#bf5af2 16%,transparent)}
.damp-pvdiffrow[data-kind="added"]{box-shadow:inset 2px 0 0 #34c759}
.damp-pvdiffrow[data-kind="removed"]{box-shadow:inset 2px 0 0 #ff453a}
.damp-pvdiffrow[data-kind="changed"]{box-shadow:inset 2px 0 0 #bf5af2}
.damp-pvdifftext{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;opacity:.9}
.damp-pvdiffdetail{flex:0 0 auto;opacity:.68;font-variant-numeric:tabular-nums}
.damp-pvdiffwarn{font-size:10.5px;padding:3px 6px;border-radius:6px;color:color-mix(in srgb,#e5a50a 85%,currentColor);background:color-mix(in srgb,#e5a50a 12%,transparent);border:1px solid color-mix(in srgb,#e5a50a 34%,transparent)}
/* 详情页：左图右树，窄面板下自动上下堆叠。 */
.damp-pvdetail{display:flex;flex:1 1 auto;min-height:0;gap:6px}
/* 滚动条位置提前留出来：图片尺寸是按容器算的，而滚动条一出现容器就变窄，
   会形成「变窄 → 图片变小 → 又不需要滚动条」的来回抖动。
   本页图片恒定由 JS 定尺寸，留出 gutter 不会带来副作用。 */
.damp-pvstage{position:relative;flex:1 1 58%;min-width:0;min-height:0;display:flex;align-items:flex-start;justify-content:flex-start;overflow:auto;scrollbar-gutter:stable;border-radius:7px;background:color-mix(in srgb,#888 12%,transparent);padding:3px}
/* 图片靠 margin:auto 居中（而不是父级的 center 对齐）：
   放大后图片超出容器时剩余空间为负，auto 边距退化成 0，起始边才滚得到；
   用 justify-content:center 会把左上角裁在可视区之外，滚不过去。 */
.damp-pvstage img{flex:0 0 auto;margin:auto;max-width:100%;max-height:100%;display:block;object-fit:contain}
/* 已经算出缩放后的像素尺寸时，必须让 inline 尺寸说了算：
   max-width/max-height 会把它压回容器大小，放大就完全看不出效果。 */
.damp-pvstage img[data-zoomed="true"]{max-width:none;max-height:none}
.damp-pvbox{position:absolute;pointer-events:none;border:1.5px solid #0a84ff;border-radius:2px;box-shadow:0 0 0 1px #fff6;z-index:3}
/* 选中态用橙色，和悬停的蓝色区分：两种框可能同时出现在图上。 */
.damp-pvbox[data-selected="true"]{border-color:#ff9500;border-width:2px;box-shadow:0 0 0 1px #fff8,0 0 0 3px #ff950033}
/* diff 的三种框：新增绿、消失红虚线、变化紫（实线是新位置，虚线是旧位置）。
   靠 data-diff 变体区分，不与语义树的蓝/橙框抢同一套语义。 */
.damp-pvbox[data-diff="added"]{border-color:#34c759;box-shadow:0 0 0 1px #0006}
.damp-pvbox[data-diff="removed"]{border-color:#ff453a;border-style:dashed;box-shadow:0 0 0 1px #0006}
.damp-pvbox[data-diff="changed"]{border-color:#bf5af2;box-shadow:0 0 0 1px #0006}
.damp-pvbox[data-diff="was"]{border-color:#bf5af2;border-style:dashed;opacity:.75}
.damp-pvtree{flex:1 1 42%;min-width:0;min-height:0;overflow:auto;border-radius:7px;background:color-mix(in srgb,#888 8%,transparent);padding:3px 4px;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:10.5px;line-height:1.5}
.damp-pvrow{display:flex;gap:5px;padding:1px 3px;border-radius:3px;cursor:pointer;white-space:nowrap}
.damp-pvrow[data-hover="true"]{background:color-mix(in srgb,#0a84ff 18%,transparent)}
.damp-pvrow[data-active="true"]{background:color-mix(in srgb,#ff9500 26%,transparent);box-shadow:inset 2px 0 0 #ff9500}
/* 剪贴板不可用时的降级面板：只读、可全选，用户自己复制。 */
.damp-pvexport{display:flex;flex-direction:column;gap:4px;flex:0 0 auto;max-height:40%;min-height:0;padding:5px 6px;border-radius:7px;border:1px solid color-mix(in srgb,#e5a50a 45%,transparent);background:color-mix(in srgb,#e5a50a 10%,transparent)}
.damp-pvexporttext{flex:1 1 auto;min-height:60px;resize:vertical;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:10px;line-height:1.45;padding:3px 5px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit}
.damp-pvrowtype{color:color-mix(in srgb,#0a84ff 72%,currentColor);flex:0 0 auto}
.damp-pvrowtext{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;opacity:.92}
.damp-pvrowbounds{flex:0 0 auto;opacity:.45;font-variant-numeric:tabular-nums}
/* 窄到读不清时改成上下堆叠：语义树在下面，图在上面。 */
@media (max-width:420px){.damp-pvdetail{flex-direction:column}.damp-pvstage{flex:1 1 45%}.damp-pvtree{flex:1 1 55%}}
`

        /**
         * POST 一个 JSON 到插件路由，返回解析后的结果。
         * @param {string} path - 路由后缀。
         * @param {unknown} body - 请求体。
         * @returns {Promise<any>}
         */
        async function post(path, body) {
          const response = await fetch(ROUTE + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          })
          if (!response.ok) {
            let detail = ''
            try {
              const payload = await response.json()
              detail = payload?.message ?? payload?.error ?? ''
            } catch {
              /* 非 JSON 错误体不用管 */
            }
            throw new Error(detail || `HTTP ${response.status}`)
          }
          return response.json()
        }

        /**
         * 面板主体。
         * @param {{ sessionId?: string }} props
         */
        function ScreenTab(props) {
          const canvasRef = React.useRef(null)
          const stageRef = React.useRef(null)
          const imgRef = React.useRef(null)
          const [status, setStatus] = React.useState('starting')
          const [error, setError] = React.useState(null)
          /* 缩放模型：按容器可用空间等比缩放到刚好放下，再乘 zoom。
             1 表示适应窗口，可放大到 4 倍看清细节。 */
          const [zoom, setZoom] = React.useState(1)
          /* 当前标注工具：null 表示不标注（指针直接操作手机）。
             做成单选工具而不是一个开关，是因为画框、画箭头、写字的手势
             本身就不一样，混在一个「标注」按钮里反而要额外点很多次。 */
          const [tool, setTool] = React.useState(null)
          /* 已完成的图形。坐标一律归一化（0..1），缩放和容器变化都不会错位。 */
          const [shapes, setShapes] = React.useState([])
          /* 正在拖拽中的图形；松手后才并入 shapes。 */
          const [draft, setDraft] = React.useState(null)
          const overlayRef = React.useRef(null)
          /* 拖动/绘制起点；手绘时这里是点列。 */
          const drawRef = React.useRef(null)
          /* 标注样式：颜色与线宽，所有工具共用。 */
          const [inkColor, setInkColor] = React.useState('#ff3b30')
          const [inkWidth, setInkWidth] = React.useState(3)
          /* 当前选中要删除的图形序号；点「删除」时用。 */
          const [selected, setSelected] = React.useState(-1)
          /* 文字工具要落下的内容。 */
          const [markText, setMarkText] = React.useState('')
          /* 顶层面板：edge = 常规触控，key = 按键面板。 */
          const [mode, setMode] = React.useState('edge')
          /* 一次性提示（复制成功/失败），几秒后自动消失。 */
          const [notice, setNotice] = React.useState(null)

          /* 提示自动消失：复制结果是瞬时的，留着会一直占状态栏。 */
          React.useEffect(() => {
            if (notice === null) return undefined
            const timer = setTimeout(() => setNotice(null), 2600)
            return () => clearTimeout(timer)
          }, [notice])
          /* 容器可用空间；用于算适应尺寸，窗口或面板拖动后要跟着变。 */
          const [box, setBox] = React.useState({ w: 0, h: 0 })
          /* 画面原始像素尺寸；由首帧解出后写入，布局据此等比缩放。 */
          const [natural, setNatural] = React.useState({ w: 0, h: 0 })
          const [text, setText] = React.useState('')
          const [devices, setDevices] = React.useState([])
          const [serial, setSerial] = React.useState(undefined)
          const [tick, setTick] = React.useState(0)

          /* 盯住舞台尺寸：面板宽度、窗口缩放、全屏切换都会改变可用空间，
             适应尺寸必须跟着重算，否则画面会溢出或过小。 */
          React.useEffect(() => {
            const stage = stageRef.current
            if (stage === null) return undefined
            const measure = () => {
              const rect = stage.getBoundingClientRect()
              /* 减去 padding 与少量余量，避免刚好触发滚动条。 */
              setBox({
                w: Math.max(0, Math.floor(rect.width - 8)),
                h: Math.max(0, Math.floor(rect.height - 8)),
              })
            }
            measure()
            const observer = new ResizeObserver(measure)
            observer.observe(stage)
            return () => observer.disconnect()
          }, [])

          /* 一次指针手势的状态：按下点、最后点、是否已判定为拖动、以及节流计时。 */
          const gesture = React.useRef(null)

          /* 当前应显示的 CSS 尺寸：先把画面等比塞进容器，再乘 zoom。
             竖屏手机在宽面板里不该按宽度撑满，那样高度会远超可视区。 */
          const display = (() => {
            const naturalW = natural.w
            const naturalH = natural.h
            if (naturalW < 1 || naturalH < 1) return { width: undefined, height: undefined }
            if (box.w < 1 || box.h < 1) return { width: undefined, height: undefined }
            /* 等比缩放比：取宽、高两个方向的较小值，保证整屏可见。 */
            const scale = Math.min(box.w / naturalW, box.h / naturalH)
            const width = Math.max(1, Math.round(naturalW * scale * zoom))
            const height = Math.max(1, Math.round(naturalH * scale * zoom))
            return { width: `${width}px`, height: `${height}px` }
          })()

          /** 把画面尺寸换算成归一化坐标（0..1），与真实分辨率解耦。 */
          const toNormalized = React.useCallback((event) => {
            const canvas = canvasRef.current
            if (canvas === null) return null
            const rect = canvas.getBoundingClientRect()
            if (rect.width < 1 || rect.height < 1) return null
            return {
              x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
              y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
            }
          }, [])

          /** 发动作；失败只记录，不打断交互。 */
          const send = React.useCallback((action) => {
            post('/control', action).catch((cause) => setError(String(cause?.message ?? cause)))
          }, [])

          /* 拉实时画面到 canvas。
             这里**不能**用 <img src="multipart...">：Chromium 只在整条流结束时
             触发一次 load 事件，不是每帧触发，画面会停在第一帧。
             改用 fetch + reader 手动解 multipart，每收到一帧就画一次。 */
          React.useEffect(() => {
            let closed = false
            const controller = new AbortController()

            /** 在字节数组里找子串首次出现的位置；找不到返回 -1。 */
            const indexOfBytes = (haystack, needle, from = 0) => {
              const last = haystack.length - needle.length
              outer: for (let i = from; i <= last; i++) {
                for (let j = 0; j < needle.length; j++) {
                  if (haystack[i + j] !== needle[j]) continue outer
                }
                return i
              }
              return -1
            }
            const CRLF2 = new Uint8Array([13, 10, 13, 10])
            const BOUNDARY = new Uint8Array([45, 45]) // "--"
            const decoder = new TextDecoder('latin1')

            /** 从缓冲区里切出所有完整帧，返回切剩的尾巴。 */
            const drain = (buffer) => {
              let rest = buffer
              for (;;) {
                /* 每段以 "--frame" 开头，先跳过它。 */
                let headerEnd = indexOfBytes(rest, CRLF2)
                if (headerEnd < 0) return rest
                const header = decoder.decode(rest.subarray(0, headerEnd))
                const match = /content-length:\s*(\d+)/i.exec(header)
                if (match === null) {
                  /* 没有长度（可能是首次的空行），跳过这一段继续找。 */
                  rest = rest.subarray(headerEnd + CRLF2.length)
                  continue
                }
                const length = Number(match[1])
                const bodyStart = headerEnd + CRLF2.length
                if (rest.length < bodyStart + length) return rest
                const body = rest.slice(bodyStart, bodyStart + length)
                rest = rest.subarray(bodyStart + length)

                /* 画这一帧：用 createImageBitmap 解码，避免 img 的时序问题。 */
                createImageBitmap(new Blob([body], { type: 'image/jpeg' }))
                  .then((bitmap) => {
                    if (closed) { bitmap.close?.(); return }
                    const canvas = canvasRef.current
                    if (canvas === null) { bitmap.close?.(); return }
                    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                      canvas.width = bitmap.width
                      canvas.height = bitmap.height
                      setNatural({ w: bitmap.width, h: bitmap.height })
                    }
                    const context = canvas.getContext('2d')
                    context.drawImage(bitmap, 0, 0)
                    bitmap.close?.()
                    setStatus('live')
                    setError(null)
                  })
                  .catch(() => { /* 单帧解码失败不中断整条流 */ })
              }
            }

            const run = async () => {
              try {
                const response = await fetch(`${ROUTE}/stream?t=${tick}`, { signal: controller.signal })
                if (!response.ok || response.body === null) {
                  if (!closed) setStatus('offline')
                  return
                }
                const reader = response.body.getReader()
                /* 用 Uint8Array 累积；浏览器里没有 Buffer。 */
                let pending = new Uint8Array(0)
                for (;;) {
                  const { value, done } = await reader.read()
                  if (done || closed) break
                  if (value === undefined) continue
                  const merged = new Uint8Array(pending.length + value.length)
                  merged.set(pending, 0)
                  merged.set(value, pending.length)
                  pending = new Uint8Array(drain(merged))
                }
              } catch (cause) {
                if (!closed && cause?.name !== 'AbortError') {
                  setStatus('offline')
                  setError(String(cause?.message ?? cause))
                }
              }
            }

            run()

            return () => {
              closed = true
              /* 中止请求让宿主侧订阅退掉，停止抓帧。 */
              controller.abort()
              imgRef.current = null
            }
          }, [tick])

          /* 首次进入与刷新时同步一次状态与设备列表。 */
          React.useEffect(() => {
            let alive = true
            const pull = () => {
              post('/status', {})
                .then((state) => {
                  if (!alive) return
                  setSerial(state.serial)
                  if (state.connected === false) setStatus('offline')
                })
                .catch((cause) => {
                  if (alive) setError(String(cause?.message ?? cause))
                })
              post('/devices', {})
                .then((list) => {
                  if (alive) setDevices(Array.isArray(list.devices) ? list.devices : [])
                })
                .catch(() => {})
            }
            pull()
            const timer = setInterval(pull, 5000)
            return () => {
              alive = false
              clearInterval(timer)
            }
          }, [tick])

          /* 把所有图形重画到叠层 canvas 上。
             重画而不是累加：缩放、容器变化、撤销、删除都能保持正确。 */
          React.useEffect(() => {
            const overlay = overlayRef.current
            if (overlay === null) return
            const stage = overlay.parentElement
            if (stage === null) return
            const base = canvasRef.current
            if (base === null) return
            const rect = base.getBoundingClientRect()
            const stageRect = stage.getBoundingClientRect()
            const width = Math.max(1, Math.round(rect.width))
            const height = Math.max(1, Math.round(rect.height))
            if (overlay.width !== width || overlay.height !== height) {
              overlay.width = width
              overlay.height = height
            }
            /* 叠层正好盖在画布上：用相对舞台的偏移定位。 */
            overlay.style.left = `${Math.round(rect.left - stageRect.left)}px`
            overlay.style.top = `${Math.round(rect.top - stageRect.top)}px`
            overlay.style.width = `${width}px`
            overlay.style.height = `${height}px`

            const context = overlay.getContext('2d')
            context.clearRect(0, 0, width, height)
            context.lineCap = 'round'
            context.lineJoin = 'round'

            /** 画一个箭头：线段 + 两条羽。 */
            const drawArrow = (shape) => {
              const x1 = shape.x1 * width
              const y1 = shape.y1 * height
              const x2 = shape.x2 * width
              const y2 = shape.y2 * height
              const angle = Math.atan2(y2 - y1, x2 - x1)
              /* 箭头大小随线宽走，太细看不出方向。 */
              const head = Math.max(10, shape.width * 3.5)
              context.beginPath()
              context.moveTo(x1, y1)
              context.lineTo(x2, y2)
              context.stroke()
              context.beginPath()
              context.moveTo(x2, y2)
              context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7))
              context.moveTo(x2, y2)
              context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7))
              context.stroke()
            }

            const renderOne = (shape, index, isDraft) => {
              context.save()
              context.strokeStyle = shape.color
              context.fillStyle = shape.color
              context.lineWidth = shape.width
              if (isDraft === true) context.globalAlpha = 0.75

              if (shape.kind === 'free') {
                const points = shape.points ?? []
                if (points.length >= 2) {
                  context.beginPath()
                  context.moveTo(points[0][0] * width, points[0][1] * height)
                  for (let i = 1; i < points.length; i++) {
                    context.lineTo(points[i][0] * width, points[i][1] * height)
                  }
                  context.stroke()
                }
              } else if (shape.kind === 'rect') {
                const x = Math.min(shape.x1, shape.x2) * width
                const y = Math.min(shape.y1, shape.y2) * height
                const w = Math.abs(shape.x2 - shape.x1) * width
                const h = Math.abs(shape.y2 - shape.y1) * height
                context.strokeRect(x, y, w, h)
              } else if (shape.kind === 'arrow') {
                drawArrow(shape)
              } else if (shape.kind === 'text') {
                /* 文字描边 + 填充，保证在任何背景上都看得清。 */
                const size = Math.max(12, shape.width * 5)
                context.font = `600 ${size}px -apple-system, "PingFang SC", sans-serif`
                context.textBaseline = 'top'
                const x = shape.x1 * width
                const y = shape.y1 * height
                context.lineWidth = Math.max(2, size / 6)
                context.strokeStyle = 'rgba(0,0,0,.55)'
                context.strokeText(shape.text ?? '', x, y)
                context.fillStyle = shape.color
                context.fillText(shape.text ?? '', x, y)
              }

              /* 选中的图形加一圈虚线提示，方便定位要删的是哪一个。 */
              if (isDraft !== true && index === selected) {
                context.globalAlpha = 1
                context.setLineDash([4, 4])
                context.lineWidth = 1
                context.strokeStyle = '#0a84ff'
                const box = shapeBox(shape, width, height)
                context.strokeRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6)
                context.setLineDash([])
              }
              context.restore()
            }

            shapes.forEach((shape, index) => renderOne(shape, index, false))
            if (draft !== null) renderOne(draft, -1, true)
          }, [shapes, draft, selected, inkColor, inkWidth, zoom, box, natural])

          /** 图形在叠层像素坐标里的包围盒，用于选中框与命中判断。 */
          const shapeBox = (shape, width, height) => {
            if (shape.kind === 'free') {
              const points = shape.points ?? []
              if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
              let minX = 1
              let minY = 1
              let maxX = 0
              let maxY = 0
              for (const [px, py] of points) {
                minX = Math.min(minX, px)
                minY = Math.min(minY, py)
                maxX = Math.max(maxX, px)
                maxY = Math.max(maxY, py)
              }
              return { x: minX * width, y: minY * height, w: (maxX - minX) * width, h: (maxY - minY) * height }
            }
            if (shape.kind === 'text') {
              const size = Math.max(12, shape.width * 5)
              return {
                x: shape.x1 * width,
                y: shape.y1 * height,
                w: Math.max(size, (shape.text ?? '').length * size * 0.6),
                h: size * 1.3,
              }
            }
            const x1 = Math.min(shape.x1, shape.x2) * width
            const y1 = Math.min(shape.y1, shape.y2) * height
            return {
              x: x1,
              y: y1,
              w: Math.abs(shape.x2 - shape.x1) * width,
              h: Math.abs(shape.y2 - shape.y1) * height,
            }
          }

          const onPointerDown = (event) => {
            /* 选中了标注工具：指针只画图，绝不往手机发动作。 */
            if (tool !== null) {
              const point = toNormalized(event)
              if (point === null) return
              event.currentTarget.setPointerCapture?.(event.pointerId)
              if (tool === 'text') {
                /* 文字工具点一下就落一个标签，内容由输入框决定。 */
                const text = markText.trim()
                if (text.length === 0) return
                setShapes((prev) => prev.concat([{ kind: 'text', x1: point.x, y1: point.y, x2: point.x, y2: point.y, text, color: inkColor, width: inkWidth }]))
                return
              }
              if (tool === 'free') {
                drawRef.current = [[point.x, point.y]]
                setDraft({ kind: 'free', points: drawRef.current, color: inkColor, width: inkWidth })
                return
              }
              /* 矩形与箭头：拖出起点到终点。 */
              drawRef.current = point
              setDraft({ kind: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color: inkColor, width: inkWidth })
              return
            }
            const point = toNormalized(event)
            if (point === null) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            gesture.current = { start: point, last: point, dragging: false, sentAt: 0 }
          }

          const onPointerMove = (event) => {
            /* 标注拖动：更新草稿，实时预览。 */
            if (tool !== null && draft !== null) {
              const point = toNormalized(event)
              if (point === null) return
              if (draft.kind === 'free') {
                drawRef.current.push([point.x, point.y])
                setDraft({ ...draft, points: drawRef.current.slice() })
              } else {
                setDraft({ ...draft, x2: point.x, y2: point.y })
              }
              return
            }
            const state = gesture.current
            if (state === null) return
            const point = toNormalized(event)
            if (point === null) return
            const dx = Math.abs(point.x - state.start.x)
            const dy = Math.abs(point.y - state.start.y)
            /* 超过 1.5% 屏宽才算拖动，避免手指微抖把点击吃掉。 */
            if (!state.dragging && Math.max(dx, dy) > 0.015) state.dragging = true
            if (!state.dragging) return
            const now = Date.now()
            /* 拖动按 ~40ms 合并成一次 swipe，减少 adb 往返。 */
            if (now - state.sentAt < 40) {
              state.last = point
              return
            }
            state.sentAt = now
            send({ action: 'swipe', x1: state.start.x, y1: state.start.y, x2: point.x, y2: point.y, durationMs: 120 })
            state.start = point
            state.last = point
          }

          const onPointerUp = (event) => {
            /* 标注收笔：草稿转正。太小的图形当作误触丢掉。 */
            if (tool !== null && draft !== null) {
              const tooSmall = draft.kind === 'free'
                ? (draft.points ?? []).length < 2
                : Math.abs(draft.x2 - draft.x1) < 0.01 && Math.abs(draft.y2 - draft.y1) < 0.01
              if (!tooSmall) setShapes((prev) => prev.concat([draft]))
              setDraft(null)
              drawRef.current = null
              return
            }
            const state = gesture.current
            gesture.current = null
            if (state === null) return
            if (state.dragging) return
            const point = toNormalized(event)
            if (point === null) return
            send({ action: 'tap', x: point.x, y: point.y })
          }

          const onWheel = (event) => {
            event.preventDefault()
            /* 默认滚轮缩放画面：竖屏手机在窄面板里最缺的是缩放，
               滚动交给按住 Shift 的滚轮和触摸拖动。 */
            if (!event.shiftKey) {
              const step = event.deltaY < 0 ? 0.15 : -0.15
              setZoom((value) => Math.max(0.25, Math.min(4, Math.round((value + step) * 100) / 100)))
              return
            }
            const point = toNormalized(event)
            if (point === null) return
            /* Shift + 滚轮 = 手指上滑/下滑。 */
            const delta = Math.max(-0.35, Math.min(0.35, event.deltaY / 600))
            send({ action: 'swipe', x1: point.x, y1: point.y, x2: point.x, y2: Math.min(1, Math.max(0, point.y - delta)), durationMs: 80 })
          }

          const pressKey = (key) => send({ action: 'key', key })

          const sendText = () => {
            const value = text.trim()
            if (value.length === 0) return
            send({ action: 'text', text: value })
            setText('')
          }

          const live = status === 'live'
          const message = status === 'starting'
            ? L('empty.starting')
            : status === 'offline'
              ? L('empty.none')
              : error !== null
                ? `${L('state.bad')}: ${error}`
                : null

          /* 把屏幕帧与标注合成为一张画布；截图与复制共用这一步。 */
          const composeShot = () => {
            const canvas = canvasRef.current
            if (canvas === null) return null
            const merged = document.createElement('canvas')
            merged.width = canvas.width
            merged.height = canvas.height
            const context = merged.getContext('2d')
            context.drawImage(canvas, 0, 0)
            const overlay = overlayRef.current
            if (overlay !== null && overlay.width > 0) {
              context.drawImage(overlay, 0, 0, merged.width, merged.height)
            }
            return merged
          }

          /** 复制到系统剪贴板，之后在输入框按 ⌘V 就能把它作为附件发出去。 */
          const copyShot = async () => {
            const merged = composeShot()
            if (merged === null) return
            try {
              if (typeof ClipboardItem === 'undefined' || navigator.clipboard?.write === undefined) {
                throw new Error('此环境不支持写入剪贴板')
              }
              /* 关键：Chromium 要求 ClipboardItem 在用户手势期间同步构造，
                 而 toBlob 是异步的。把 Promise 直接交给 ClipboardItem，
                 浏览器会自己等它 resolve，写剪贴板才不会被判定为失去手势。 */
              const blobPromise = new Promise((resolve) => {
                merged.toBlob((blob) => {
                  if (blob === null) {
                    /* toBlob 失败时退化为从 dataURL 反解，保证还有图可粘。 */
                    const base64 = merged.toDataURL('image/png').split(',')[1] ?? ''
                    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
                    resolve(new Blob([bytes], { type: 'image/png' }))
                    return
                  }
                  resolve(blob)
                }, 'image/png')
              })
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
              setNotice(L('shot.copied'))
            } catch (cause) {
              setNotice(`${L('shot.copyFailed')}: ${String(cause?.message ?? cause)}`)
            }
          }

          /** 下载到磁盘；复制失败或想留档时用。 */
          const saveShot = () => {
            const merged = composeShot()
            if (merged === null) return
            const link = document.createElement('a')
            link.href = merged.toDataURL('image/png')
            link.download = `android-${Date.now()}.png`
            link.click()
          }

          /** 主栏：任何模式下都在的常用动作。 */
          const primaryBar = h('div', { className: 'damp-toolbar' },
            h('button', {
              className: 'damp-btn',
              onClick: () => setTick((value) => value + 1),
              title: L('act.refresh'),
            }, L('act.refresh')),
            h('span', { className: 'damp-toolsep' }),
            h('button', {
              className: 'damp-btn',
              onClick: () => setZoom((value) => Math.max(0.25, Math.round((value - 0.25) * 100) / 100)),
              title: L('act.zoomOut'),
            }, '−'),
            h('button', {
              className: 'damp-btn',
              'data-active': zoom === 1 ? 'true' : 'false',
              onClick: () => setZoom(1),
              title: L('act.fit'),
            }, `${Math.round(zoom * 100)}%`),
            h('button', {
              className: 'damp-btn',
              onClick: () => setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100)),
              title: L('act.zoomIn'),
            }, '+'),
            h('span', { className: 'damp-toolsep' }),
            /* 模式切换：普通 / 标注 / 按键。选中后下面出现该模式的面板。 */
            h('button', {
              className: 'damp-btn',
              'data-active': tool === null ? 'true' : 'false',
              onClick: () => { setTool(null); setDraft(null); drawRef.current = null },
              title: L('mode.touch'),
            }, L('mode.touch')),
            h('button', {
              className: 'damp-btn',
              'data-active': tool !== null ? 'true' : 'false',
              onClick: () => { setTool('free'); setDraft(null); drawRef.current = null },
              title: L('mode.mark'),
            }, L('mode.mark')),
            h('button', {
              className: 'damp-btn',
              'data-active': mode === 'key' ? 'true' : 'false',
              onClick: () => { setMode(mode === 'key' ? 'edge' : 'key'); setTool(null) },
              title: L('mode.key'),
            }, L('mode.key')),
            h('span', { className: 'damp-toolsep' }),
            h('button', { className: 'damp-btn damp-primary', onClick: copyShot, title: L('act.copyShot') }, L('act.copyShot')),
            h('button', { className: 'damp-btn', onClick: saveShot, title: L('act.screenshot') }, L('act.saveFile')),
          )

          /** 标注面板：只在标注模式下出现，工具与样式都在这里。 */
          const markPanel = tool === null ? null : h('div', { className: 'damp-panel' },
            h('span', { className: 'damp-panellabel' }, L('mark.tool')),
            h('button', { className: 'damp-btn', 'data-active': tool === 'free' ? 'true' : 'false', onClick: () => setTool('free') }, L('mark.free')),
            h('button', { className: 'damp-btn', 'data-active': tool === 'rect' ? 'true' : 'false', onClick: () => setTool('rect') }, L('mark.rect')),
            h('button', { className: 'damp-btn', 'data-active': tool === 'arrow' ? 'true' : 'false', onClick: () => setTool('arrow') }, L('mark.arrow')),
            h('button', { className: 'damp-btn', 'data-active': tool === 'text' ? 'true' : 'false', onClick: () => setTool('text') }, L('mark.text')),
            h('span', { className: 'damp-toolsep' }),
            h('span', { className: 'damp-panellabel' }, L('mark.color')),
            ...['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'].map((color) =>
              h('button', {
                key: color,
                className: 'damp-swatch',
                'data-active': inkColor === color ? 'true' : 'false',
                style: { background: color },
                onClick: () => setInkColor(color),
                title: color,
              })),
            h('span', { className: 'damp-panellabel' }, L('mark.width')),
            h('button', { className: 'damp-btn', onClick: () => setInkWidth((w) => Math.max(1, w - 1)) }, '−'),
            h('span', { className: 'damp-panelvalue' }, String(inkWidth)),
            h('button', { className: 'damp-btn', onClick: () => setInkWidth((w) => Math.min(12, w + 1)) }, '+'),
            h('span', { className: 'damp-toolsep' }),
            tool === 'text' ? h('input', {
              className: 'damp-input damp-marktext',
              value: markText,
              placeholder: L('mark.textPlaceholder'),
              onChange: (event) => setMarkText(event.target.value),
            }) : null,
            h('button', { className: 'damp-btn', onClick: () => setShapes((prev) => prev.slice(0, -1)) }, L('act.undo')),
            h('button', { className: 'damp-btn', onClick: () => setShapes([]) }, L('act.clearMark')),
            h('button', { className: 'damp-btn', onClick: copyShot }, L('act.copyShot')),
            h('button', { className: 'damp-btn', onClick: saveShot }, L('act.saveFile')),
          )

          /** 按键面板：只留你真正常用的返回键，其余收在这里不再占主栏。 */
          const keyPanel = mode !== 'key' ? null : h('div', { className: 'damp-panel' },
            h('span', { className: 'damp-panellabel' }, L('key.title')),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_BACK') }, L('key.back')),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_ENTER') }, L('key.enter')),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_DEL') }, L('key.del')),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_TAB') }, L('key.tab')),
            h('span', { className: 'damp-toolsep' }),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_DPAD_UP') }, '↑'),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_DPAD_DOWN') }, '↓'),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_DPAD_LEFT') }, '←'),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_DPAD_RIGHT') }, '→'),
            h('span', { className: 'damp-toolsep' }),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_VOLUME_UP') }, L('key.volUp')),
            h('button', { className: 'damp-btn', onClick: () => pressKey('KEYCODE_VOLUME_DOWN') }, L('key.volDown')),
          )

          return h('div', { className: 'damp-body' },
            primaryBar,
            markPanel,
            keyPanel,
            h('div', { className: 'damp-stage', ref: stageRef },
              h('canvas', {
                ref: canvasRef,
                className: 'damp-canvas',
                style: display,
                'data-tool': tool ?? 'none',
                onPointerDown,
                onPointerMove,
                onPointerUp,
                onPointerCancel: () => { gesture.current = null; setDraft(null); drawRef.current = null },
                onWheel,
              }),
              /* 标注叠层：绝对定位盖在画布上，只负责画图，不接事件。 */
              h('canvas', { ref: overlayRef, className: 'damp-overlay' }),
              message === null ? null : h('div', { className: 'damp-empty' }, message),
            ),
            h('div', { className: 'damp-text' },
              h('input', {
                className: 'damp-input',
                value: text,
                placeholder: L('ph.text'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') sendText() },
              }),
              h('button', { className: 'damp-btn', onClick: sendText }, L('act.text')),
            ),
            h('div', { className: 'damp-status' },
              h('span', { className: 'damp-dot', 'data-live': live ? 'true' : 'false' }),
              h('span', null, live ? L('state.live') : L('state.offline')),
              serial === undefined ? null : h('span', null, serial),
              shapes.length > 0 ? h('span', null, `${L('mark.count')} ${shapes.length}`) : null,
              notice === null ? null : h('span', { className: 'damp-notice' }, notice),
              devices.length > 1 && React.createElement('select', {
                className: 'damp-btn',
                value: serial ?? '',
                onChange: (event) => {
                  const next = event.target.value
                  post('/select', { serial: next })
                    .then(() => setTick((value) => value + 1))
                    .catch((cause) => setError(String(cause?.message ?? cause)))
                },
              }, devices.map((device) => h('option', { key: device.serial, value: device.serial }, `${device.model ?? device.serial} (${device.state})`))),
            ),
          )
        }

        /** 级别颜色，与 Android Studio 的 logcat 配色一致，认色即可不看字母。 */
        const LEVEL_COLOR = {
          V: '#9aa0a6',
          D: '#4a90e2',
          I: '#3ba55d',
          W: '#e0a030',
          E: '#e05252',
          F: '#c0392b',
        }

        /**
         * 日志面板：实时尾随 + 级别/关键词过滤 + 崩溃高亮。
         *
         * 数据通路：`/logcat/stream` 是 NDJSON 流，每 250ms 一批；
         * 高速日志下服务端只送「尾随采样」，所以这里维护 `lastSeq`，
         * 发现 seq 有缺口时调 `/logcat/snapshot` 回拉补齐——这样既能实时跟，
         * 又不会因为限流把行丢掉。
         */
        function LogcatTab() {
          const [lines, setLines] = React.useState([])
          const [pkg, setPkg] = React.useState(null)
          const [foreground, setForeground] = React.useState(null)
          const [minLevel, setMinLevel] = React.useState('V')
          const [keyword, setKeyword] = React.useState('')
          const [onlyCrash, setOnlyCrash] = React.useState(false)
          const [status, setStatus] = React.useState({ running: false, buffered: 0, total: 0, dropped: 0 })
          const [autoScroll, setAutoScroll] = React.useState(true)
          const [follow, setFollow] = React.useState(0)
          const listRef = React.useRef(null)
          /* 已收到的最大 seq；回拉时用它算缺口。 */
          const lastSeq = React.useRef(0)

          /* 初次进入：探测前台应用并默认跟随它。 */
          React.useEffect(() => {
            let alive = true
            post('/logcat/foreground', {})
              .then((state) => {
                if (!alive) return
                setForeground(state.packageName ?? null)
                /* 默认跟随当前 App：绝大多数时候只看自己正在调的应用。 */
                if (state.packageName) {
                  return post('/logcat/package', { packageName: state.packageName })
                    .then((r) => { if (alive) setPkg(r.packageName ?? null) })
                    .catch(() => {})
                }
                return undefined
              })
              .catch(() => {})
            return () => { alive = false }
          }, [])

          /* 订阅实时流。 */
          React.useEffect(() => {
            let closed = false
            const controller = new AbortController()
            const run = async () => {
              try {
                const response = await fetch(`${ROUTE}/logcat/stream?t=${follow}`, { signal: controller.signal })
                if (!response.ok || response.body === null) return
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                let pending = ''
                for (;;) {
                  const { value, done } = await reader.read()
                  if (done || closed) break
                  if (value === undefined) continue
                  pending += decoder.decode(value, { stream: true })
                  const parts = pending.split('\n')
                  pending = parts.pop() ?? ''
                  for (const part of parts) {
                    const text = part.trim()
                    if (text.length === 0) continue
                    let payload
                    try { payload = JSON.parse(text) } catch { continue }
                    if (Array.isArray(payload.lines) === false) continue
                    const batch = payload.lines
                    if (batch.length === 0) continue
                    const maxSeq = batch[batch.length - 1].seq
                    const gap = maxSeq - lastSeq.current - batch.length
                    lastSeq.current = Math.max(lastSeq.current, maxSeq)
                    setLines((prev) => {
                      /* 环形缓冲上限 3000 行：日志量太大，浏览器只留最近的一段。 */
                      const next = prev.concat(batch)
                      return next.length > 3000 ? next.slice(next.length - 3000) : next
                    })
                    /* 有明显缺口就回拉补齐，补的是「刚才漏掉的那些行」。 */
                    if (gap > 0 && lastSeq.current > 0) {
                      post('/logcat/snapshot', { limit: 3000 })
                        .then((snap) => {
                          if (closed || Array.isArray(snap.lines) === false) return
                          const maxBack = snap.lines[snap.lines.length - 1]?.seq ?? 0
                          lastSeq.current = Math.max(lastSeq.current, maxBack)
                          setLines(() => snap.lines.slice(-3000))
                        })
                        .catch(() => {})
                    }
                  }
                }
              } catch (cause) {
                if (!closed && cause?.name !== 'AbortError') setStatus((s) => ({ ...s, lastError: String(cause?.message ?? cause) }))
              }
            }
            run()
            return () => { closed = true; controller.abort() }
          }, [follow])

          /* 状态轮询：显示缓冲行数、是否在采。 */
          React.useEffect(() => {
            let alive = true
            const pull = () => {
              post('/logcat/status', {})
                .then((s) => { if (alive) setStatus(s) })
                .catch(() => {})
            }
            pull()
            const timer = setInterval(pull, 3000)
            return () => { alive = false; clearInterval(timer) }
          }, [])

          /* 自动滚动到底；用户手动上翻时暂停，不然读日志会被顶走。 */
          React.useEffect(() => {
            const list = listRef.current
            if (list === null || autoScroll !== true) return
            list.scrollTop = list.scrollHeight
          }, [lines, autoScroll])

          const onScroll = () => {
            const list = listRef.current
            if (list === null) return
            /* 距离底部 40px 内算「贴着底」，此时继续自动跟随。 */
            const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40
            setAutoScroll(atBottom)
          }

          /** 按级别与关键词过滤；只在本地筛，不动服务端缓冲。 */
          const visible = (() => {
            const ranks = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 }
            const min = ranks[minLevel] ?? 0
            const kw = keyword.trim().toLowerCase()
            return lines.filter((line) => {
              if (line.kind === 'section') return minLevel === 'V' && kw.length === 0 && !onlyCrash
              if (onlyCrash && line.crash !== true) return false
              if ((ranks[line.level] ?? 0) < min) return false
              if (kw.length > 0) {
                const hay = `${line.tag ?? ''} ${line.message ?? line.raw ?? ''}`.toLowerCase()
                if (!hay.includes(kw)) return false
              }
              return true
            })
          })()

          const switchTarget = (packageName) => {
            post('/logcat/package', { packageName })
              .then((r) => {
                setPkg(r.packageName ?? null)
                lastSeq.current = 0
                setLines([])
                setFollow((v) => v + 1)
              })
              .catch(() => {})
          }

          const clear = () => {
            post('/logcat/clear', {})
              .then(() => { lastSeq.current = 0; setLines([]) })
              .catch(() => {})
          }

          return h('div', { className: 'damp-logcat' },
            h('div', { className: 'damp-logbar' },
              h('select', {
                className: 'damp-btn',
                value: pkg ?? '',
                onChange: (event) => switchTarget(event.target.value),
                title: L('log.target'),
              },
                h('option', { value: '' }, L('log.all')),
                pkg !== null ? h('option', { value: pkg }, pkg) : null,
                foreground !== null && foreground !== pkg ? h('option', { value: foreground }, `${L('log.follow')} ${foreground}`) : null,
              ),
              h('select', {
                className: 'damp-btn',
                value: minLevel,
                onChange: (event) => setMinLevel(event.target.value),
                title: L('log.level'),
              }, ['V', 'D', 'I', 'W', 'E', 'F'].map((lv) => h('option', { key: lv, value: lv }, lv))),
              h('input', {
                className: 'damp-input damp-logfilter',
                value: keyword,
                placeholder: L('log.filter'),
                onChange: (event) => setKeyword(event.target.value),
              }),
              h('button', {
                className: 'damp-btn',
                'data-active': onlyCrash ? 'true' : 'false',
                onClick: () => setOnlyCrash((v) => !v),
                title: L('log.onlyCrash'),
              }, L('log.crash')),
              h('button', { className: 'damp-btn', onClick: clear, title: L('log.clear') }, L('log.clear')),
            ),
            h('div', { className: 'damp-loglist', ref: listRef, onScroll },
              visible.length === 0
                ? h('div', { className: 'damp-empty' }, status.running ? L('log.empty') : L('log.waiting'))
                : visible.map((line) => line.kind === 'section'
                  ? h('div', { key: line.seq, className: 'damp-logsection' }, line.text)
                  : h('div', {
                    key: line.seq,
                    className: line.crash ? 'damp-logline is-crash' : 'damp-logline',
                  },
                    h('span', { className: 'damp-logtime' }, line.time ?? ''),
                    h('span', { className: 'damp-loglevel', style: { color: LEVEL_COLOR[line.level] ?? '#999' } }, line.level),
                    h('span', { className: 'damp-logtag' }, line.tag ?? ''),
                    h('span', { className: 'damp-logmsg' }, line.message ?? line.raw ?? ''),
                  )),
            ),
            h('div', { className: 'damp-status' },
              h('span', { className: 'damp-dot', 'data-live': status.running ? 'true' : 'false' }),
              h('span', null, status.running ? L('log.live') : L('log.paused')),
              h('span', null, `${L('log.shown')} ${visible.length} / ${lines.length}`),
              h('span', null, `${L('log.total')} ${status.total}`),
              status.dropped > 0 ? h('span', null, `${L('log.dropped')} ${status.dropped}`) : null,
            ),
          )
        }

        /**
         * 拼一个「会话」查询串片段，供 GET 路由使用。
         *
         * 面板挂在会话上，会话决定扫哪个安卓仓库；POST 走请求体，
         * GET（图片、语义树）只能用查询串，所以单独抽一个。
         *
         * @param {string | undefined} sessionId
         * @returns {string}
         */
        function sessionQuery(sessionId) {
          return typeof sessionId === 'string' && sessionId.length > 0
            ? `sessionId=${encodeURIComponent(sessionId)}`
            : ''
        }

        /**
         * 预览详情：左边是渲染图，右边是语义树，两边按 bounds 联动。
         *
         * 联动是这一页存在的理由：只看图分不清「这个按钮到底多高」，
         * 只看树不知道「这行对应屏幕哪儿」。所以树行的 hover 要在图上
         * 画一个框，用的是语义树自带的 bounds，坐标和图的像素一一对应
         * （两条渲染路径的 tree.width/height 就是出图尺寸，已实测一致）。
         *
         * @param {{ entry: any, job?: any, sessionId?: string, onBack: () => void, onRender: (key: string) => void }} props
         */
        function PreviewDetail(props) {
          const { entry, job, sessionId, onBack, onRender } = props
          const [tree, setTree] = React.useState(null)
          const [treeError, setTreeError] = React.useState(null)
          const [hover, setHover] = React.useState(null)
          /* 图上点选出来的节点。和 hover 分开存：两者会同时存在，
             hover 跟着鼠标走（蓝框），selected 是定下来的那个（橙框）。 */
          const [selected, setSelected] = React.useState(null)
          const [showAll, setShowAll] = React.useState(false)
          /* 图片缩放倍率；1 是适应窗口，和画面 tab 用同一套步进（0.25x–4x）。 */
          const [zoom, setZoom] = React.useState(1)
          /* 容器可用区域（已扣 padding），算图片像素尺寸要用。 */
          const [stageBox, setStageBox] = React.useState(null)
          /* 一次性提示：点中被过滤的节点、导出结果，都走这一条。 */
          const [notice, setNotice] = React.useState(null)
          /* 剪贴板不可用时的降级文本；非 null 就显示一个只读 textarea。 */
          const [exportText, setExportText] = React.useState(null)
          const exportRef = React.useRef(null)
          const stageRef = React.useRef(null)
          const imgRef = React.useRef(null)
          /* 语义树每一行对应的 DOM；点选后要把它滚进视野。 */
          const rowRefs = React.useRef(new Map())
          /* 图片在容器里的实际绘制区域（相对容器左上角）。
             必须实测而不是用百分比：图片是 object-fit:contain 居中的，
             容器比例与图不一致时上下/左右会有留白，按容器百分比算就会整体偏移。 */
          const [imageBox, setImageBox] = React.useState(null)
          /* 右侧那一栏的两个视图：语义树 / 对比上一版，二选一。
             不做并排——两边都要占满整栏才读得清，而且 diff 是可选功能，
             放进 tab 才能做到「点开才算」，不拖慢首屏。 */
          const [pane, setPane] = React.useState('tree')
          /* diff 结果与加载态。null 表示还没拉过，和「拉了但没数据」要分开。 */
          const [diff, setDiff] = React.useState(null)
          const [diffError, setDiffError] = React.useState(null)
          const [diffLoading, setDiffLoading] = React.useState(false)
          /* 「重新对比」的计数器：加一即重新拉，不额外造一个布尔开关。 */
          const [diffToken, setDiffToken] = React.useState(0)
          /* 悬停的 diff 条目 `{ kind, item }`；决定左侧图上画哪种颜色的框。 */
          const [diffHover, setDiffHover] = React.useState(null)

          /* 图片地址要在下面的 effect 依赖里用到，必须先定义——
             之前放在后面导致 TDZ 报错、整个面板白屏。 */
          const imageUrl = entry.hasImage
            ? `${ROUTE}/preview/image?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}&v=${entry.renderedAt ?? 0}`
            : undefined

          const measureImage = React.useCallback(() => {
            const stage = stageRef.current
            const img = imgRef.current
            if (stage === null || img === null) return
            if (img.naturalWidth < 1 || img.naturalHeight < 1) return
            const stageRect = stage.getBoundingClientRect()
            const imgRect = img.getBoundingClientRect()
            if (imgRect.width < 1 || imgRect.height < 1) return
            /* 基准换算：getBoundingClientRect 从 border 外沿量起，而
               `.damp-pvbox` 是 position:absolute，它的包含块是最近定位祖先的
               **padding box**（即 border 内沿，不含 border）。实测验证：
               容器 padding:3px、无 border 时，left:0 的绝对定位子元素落在 (0,0)，
               而不是 (3,3)——所以只需减 border，**不能减 padding**，
               多减一个 padding 就会让框恒定偏移。 */
            const style = window.getComputedStyle(stage)
            const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0
            const borderTop = Number.parseFloat(style.borderTopWidth) || 0
            const measured = {
              /* 加上滚动偏移：容器可滚动时 getBoundingClientRect 是视口坐标。 */
              left: imgRect.left - stageRect.left + stage.scrollLeft - borderLeft,
              top: imgRect.top - stageRect.top + stage.scrollTop - borderTop,
              width: imgRect.width,
              height: imgRect.height,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
            }
            setImageBox(measured)
            /* 顺手返回：滚动/缩放后立刻要用最新值时，不必等下一轮渲染拿 state。 */
            return measured
          }, [])

          /* 图加载完、容器尺寸变化、窗口缩放都要重测，否则框会停在旧位置。 */
          React.useEffect(() => {
            const stage = stageRef.current
            const img = imgRef.current
            measureImage()
            if (img !== null) {
              if (img.complete) measureImage()
              img.addEventListener('load', measureImage)
            }
            const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measureImage)
            if (observer !== undefined) {
              if (stage !== null) observer.observe(stage)
              if (img !== null) observer.observe(img)
            }
            window.addEventListener('resize', measureImage)
            return () => {
              if (img !== null) img.removeEventListener('load', measureImage)
              observer?.disconnect()
              window.removeEventListener('resize', measureImage)
            }
          }, [measureImage, imageUrl])

          /* 容器可用区域：缩放要按它算「适应窗口」的基准像素，之后再乘 zoom。
             和画面 tab 不同，这里不能用 CSS 百分比——框的位置要显式像素，
             图片的显示尺寸必须自己算出来。 */
          React.useEffect(() => {
            const stage = stageRef.current
            if (stage === null) return undefined
            const measure = () => {
              const rect = stage.getBoundingClientRect()
              if (typeof window.getComputedStyle !== 'function') return
              const style = window.getComputedStyle(stage)
              const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
              const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
              const borderX = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0)
              const borderY = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0)
              /* clientWidth 已排掉 border 与滚动条，比 rect.width 准：
                 用 rect 会把滚动条宽度算成可用空间，1x 时就会莫名其妙多出一条滚动条。 */
              const rawW = Number.isFinite(stage.clientWidth) && stage.clientWidth > 0
                ? stage.clientWidth
                : rect.width - borderX
              const rawH = Number.isFinite(stage.clientHeight) && stage.clientHeight > 0
                ? stage.clientHeight
                : rect.height - borderY
              setStageBox({
                w: Math.max(0, Math.floor(rawW - padX)),
                h: Math.max(0, Math.floor(rawH - padY)),
              })
            }
            measure()
            const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
            observer?.observe(stage)
            window.addEventListener('resize', measure)
            return () => {
              observer?.disconnect()
              window.removeEventListener('resize', measure)
            }
          }, [])

          /* 缩放或容器变化后必须重测：图片的 CSS 尺寸变了，
             getBoundingClientRect 才会给出新的绘制区域，框随之跟上。
             这里显式重测一次，不依赖 ResizeObserver 一定会触发
             （部分环境对 flex 子项的尺寸变化不报）。 */
          React.useEffect(() => {
            measureImage()
            /* 布局在同一帧里可能还没稳定（滚动条出现会再挤窄一点），下一帧补测。 */
            if (typeof requestAnimationFrame !== 'function') return undefined
            const handle = requestAnimationFrame(() => measureImage())
            return () => {
              if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
            }
          }, [measureImage, zoom, stageBox])

          /* 树与图一起失效：重新渲染后 renderedAt 变，两个 URL 都要跟着换。 */
          React.useEffect(() => {
            let alive = true
            setTree(null)
            setTreeError(null)
            setHover(null)
            setSelected(null)
            if (entry.renderedAt === undefined) return () => { alive = false }
            fetch(`${ROUTE}/preview/tree?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}`)
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
              .then((payload) => { if (alive) setTree(payload) })
              .catch((cause) => { if (alive) setTreeError(String(cause?.message ?? cause)) })
            return () => { alive = false }
          }, [entry.key, entry.renderedAt, sessionId])

          /* diff 只在切到「对比上一版」时才拉。这是刻意的：它是可选功能，
             进详情页就发请求会拖慢首屏（首屏已经在拉图和拉树了）。
             切回语义树时不清空结果——再切回来只要 renderedAt 没变就不用重算。
             重新渲染后 renderedAt 变，依赖带动它自动重拉，旧结论同时作废。 */
          React.useEffect(() => {
            if (pane !== 'diff') return undefined
            if (entry.renderedAt === undefined) return undefined
            let alive = true
            setDiffLoading(true)
            setDiffError(null)
            setDiffHover(null)
            fetch(`${ROUTE}/preview/diff?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}`)
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
              .then((payload) => { if (alive) setDiff(payload ?? null) })
              .catch((cause) => { if (alive) setDiffError(String(cause?.message ?? cause)) })
              .finally(() => { if (alive) setDiffLoading(false) })
            return () => { alive = false }
          }, [pane, entry.key, entry.renderedAt, sessionId, diffToken])

          /* 默认只显示有语义的节点：实测 headless 77 个节点里只有 16 个带语义，
             整棵铺开反而找不到要看的那几行。 */
          const nodes = tree?.nodes ?? []
          const visible = showAll ? nodes : nodes.filter((node) => node.hasSemantics === true)
          /* 坐标基准取语义树自己的画布尺寸（bounds 就在这个坐标系里），
             再乘「图片实际显示宽度 / 基准宽度」换算成屏幕像素。 */
          const baseWidth = tree?.width > 0 ? tree.width : imageBox?.naturalWidth ?? 0
          const baseHeight = tree?.height > 0 ? tree.height : imageBox?.naturalHeight ?? 0

          /**
           * 把语义树坐标里的一个矩形换算成 `.damp-pvbox` 的样式。
           *
           * imageBox 是实测的图片绘制区域（相对容器左上角、已含滚动偏移），
           * 缩放平移后由 measureImage 重测，所以这里每次都用最新的它。
           *
           * @param {{ left: number, top: number, right: number, bottom: number }} bounds - 语义树坐标。
           * @returns {object|null} 没有图或尺寸未就绪时返回 null。
           */
          const rectStyle = React.useCallback((bounds) => {
            if (bounds === undefined || bounds === null) return null
            if (imageBox === null || baseWidth < 1 || baseHeight < 1) return null
            const scaleX = imageBox.width / baseWidth
            const scaleY = imageBox.height / baseHeight
            return {
              left: `${Math.round(imageBox.left + bounds.left * scaleX)}px`,
              top: `${Math.round(imageBox.top + bounds.top * scaleY)}px`,
              width: `${Math.max(1, Math.round((bounds.right - bounds.left) * scaleX))}px`,
              height: `${Math.max(1, Math.round((bounds.bottom - bounds.top) * scaleY))}px`,
            }
          }, [imageBox, baseWidth, baseHeight])

          const box = rectStyle(hover?.bounds)
          const selectedBox = rectStyle(selected?.bounds)

          /* diff 悬停框：added 绿、removed 红虚线、changed 紫。
             changed 画两个框——实线是新位置、虚线是旧位置，一眼看出往哪挪了；
             纯文字变化没有 boundsChange，这时只高亮行、图上不画框。
             坐标换算全部走上面的 rectStyle，不另写一套。 */
          const diffBoxes = (() => {
            if (diffHover === null) return []
            const item = diffHover.item
            if (diffHover.kind === 'changed') {
              const before = rectStyle(item?.boundsChange?.before)
              const after = rectStyle(item?.boundsChange?.after)
              const list = []
              if (before !== null) list.push({ tone: 'was', style: before })
              if (after !== null) list.push({ tone: 'changed', style: after })
              return list
            }
            const style = rectStyle(item?.bounds)
            return style === null ? [] : [{ tone: diffHover.kind, style }]
          })()

          /**
           * 图上点击 → 反查最内层节点 → 右侧树定位。
           *
           * 换算基准必须和 measureImage 完全同源，否则框和点击会差一个 border 宽：
           * imageBox 的原点是 stage 的 **padding box** 左上角（那里已经减掉了 border），
           * 所以这里也要先减 stageRect.left/top 再减 border，才落在同一个坐标系里；
           * 容器可滚动，最后还要补回 scrollLeft/scrollTop。
           *
           * 命中判定用「包含该点的节点里面积最小的那个」：语义树是嵌套的，
           * 父节点的 bounds 一定包住子节点，面积最小即最内层那个。
           *
           * @param {any} event - 鼠标/指针事件。
           */
          const pickAt = React.useCallback((event) => {
            const stage = stageRef.current
            if (stage === null || imageBox === null || baseWidth < 1 || baseHeight < 1) return
            const stageRect = stage.getBoundingClientRect()
            const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(stage) : {}
            const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0
            const borderTop = Number.parseFloat(style.borderTopWidth) || 0
            /* 变到 imageBox 所在的坐标系（padding box 原点 + 滚动量）。 */
            const localX = event.clientX - stageRect.left - borderLeft + stage.scrollLeft - imageBox.left
            const localY = event.clientY - stageRect.top - borderTop + stage.scrollTop - imageBox.top
            /* 点在图片外（contain 留白区）不算命中，直接清空。 */
            if (localX < 0 || localY < 0 || localX > imageBox.width || localY > imageBox.height) {
              setSelected(null)
              return
            }
            const treeX = (localX / imageBox.width) * baseWidth
            const treeY = (localY / imageBox.height) * baseHeight
            let best = null
            let bestArea = Infinity
            for (const node of nodes) {
              const { left, top, right, bottom } = node.bounds
              if (right - left <= 0 || bottom - top <= 0) continue
              if (treeX < left || treeX > right || treeY < top || treeY > bottom) continue
              const area = (right - left) * (bottom - top)
              if (area < bestArea) {
                best = node
                bestArea = area
              }
            }
            if (best === null) {
              setSelected(null)
              return
            }
            setSelected(best)
            /* 被「只看语义节点」挡住的节点：自动打开 showAll 再滚过去。
               选自动展开而不是「滚到祖先并提示」——用户点的就是这一层，
               指到祖先等于没回答他的问题，还要他再找一遍；展开的代价只是
               树长一点，而且这个开关就在树顶部，随时能关回去。 */
            if (showAll !== true && best.hasSemantics !== true) {
              setShowAll(true)
              setNotice(L('pv.pickHidden'))
            }
          }, [imageBox, baseWidth, baseHeight, nodes, showAll])

          /* 选中变化后把右侧那一行滚进视野。依赖里只有 selected 与 showAll，
             两者都在上面定义好了，rowRefs 是 ref（不是 const 声明在后面）。 */
          React.useEffect(() => {
            if (selected === null) return
            const row = rowRefs.current.get(selected.id)
            if (row === undefined || row === null) return
            /* 冒烟测试与老浏览器里可能没有 scrollIntoView，缺了就当已经可见。 */
            if (typeof row.scrollIntoView !== 'function') return
            row.scrollIntoView({ block: 'nearest' })
          }, [selected, showAll])

          /* 一次性提示自动消失：和画面 tab 一致，2.6 秒后收掉。 */
          React.useEffect(() => {
            if (notice === null) return undefined
            const timer = setTimeout(() => setNotice(null), 2600)
            return () => clearTimeout(timer)
          }, [notice])

          /**
           * 把当前语义树拼成 Markdown 表格。
           *
           * 导出范围跟随 showAll：默认视图就是用户眼前看到的那些行，
           * 导出的东西和屏幕对得上，才不会让人怀疑漏了节点。
           *
           * @returns {string} Markdown 文本。
           */
          const buildMarkdown = React.useCallback(() => {
            const scope = showAll ? L('pv.exportScopeAll') : L('pv.exportScopeSemantic')
            const count = visible.length
            const lines = [
              `# ${entry.title} · ${L('pv.tree')}`,
              '',
              `- ${L('pv.repo')}: ${entry.fqn}`,
              `- ${L('pv.exportScope')}: ${scope} (${count}/${nodes.length})`,
            ]
            if (baseWidth > 0 && baseHeight > 0) lines.push(`- ${L('pv.size')}: ${baseWidth}×${baseHeight}`)
            lines.push(
              '',
              '| type | text | bounds | semantics |',
              '|---|---|---|---|',
            )
            for (const node of visible) {
              /* 竖线会把表格切坏，统一转义；换行压成空格。 */
              const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
              const text = node.text !== undefined
                ? node.text
                : node.contentDescription !== undefined ? `“${node.contentDescription}”` : ''
              const semantics = [
                node.role !== undefined && node.role !== '' ? `role=${node.role}` : '',
                node.hasSemantics === true ? 'semantic' : 'layout',
                ...(Array.isArray(node.actions) ? node.actions.map((action) => `action=${action}`) : []),
              ].filter((part) => part !== '').join(' ')
              lines.push(`| ${cell(node.type)} | ${cell(text)} | ${node.bounds.left},${node.bounds.top} → ${node.bounds.right},${node.bounds.bottom} | ${cell(semantics)} |`)
            }
            return lines.join('\n')
          }, [entry.title, entry.fqn, showAll, visible, nodes.length, baseWidth, baseHeight])

          /* 导出：优先写剪贴板；拿不到剪贴板就退化成一段可全选的只读文本。 */
          const exportTree = React.useCallback(() => {
            const text = buildMarkdown()
            setExportText(null)
            const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
            if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') {
              setExportText(text)
              setNotice(L('pv.exportPrompt'))
              return
            }
            let promise
            try {
              promise = clipboard.writeText(text)
            } catch {
              /* 老浏览器里 writeText 会直接抛（非安全上下文）。 */
              setExportText(text)
              setNotice(L('pv.exportPrompt'))
              return
            }
            Promise.resolve(promise)
              .then(() => setNotice(L('pv.exportCopied')))
              .catch(() => {
                /* 权限被拒、非安全上下文都会走到这里：把文本摆出来让用户自己复制。 */
                setExportText(text)
                setNotice(L('pv.exportFailed'))
              })
          }, [buildMarkdown])

          /* 降级文本出现后自动聚焦并全选，用户按一次 ⌘C 就完事。 */
          React.useEffect(() => {
            if (exportText === null) return
            const area = exportRef.current
            if (area === null || area === undefined) return
            if (typeof area.focus === 'function') area.focus()
            if (typeof area.select === 'function') area.select()
          }, [exportText])

          const zoomIn = () => setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))
          const zoomOut = () => setZoom((value) => Math.max(0.25, Math.round((value - 0.25) * 100) / 100))
          const zoomFit = () => setZoom(1)

          /* 图片按「适应窗口的基准尺寸 × zoom」显式给像素：
             不能用 max-width:100% 让它自适应，那样缩放后没有可滚动的内容。
             容器 flex 居中的 margin:auto 保证放大后起始边仍滚得到。 */
          const imageStyle = (() => {
            if (stageBox === null || imageBox === null) return undefined
            if (imageBox.naturalWidth < 1 || imageBox.naturalHeight < 1) return undefined
            if (stageBox.w < 1 || stageBox.h < 1) return undefined
            const fit = Math.min(stageBox.w / imageBox.naturalWidth, stageBox.h / imageBox.naturalHeight)
            const width = Math.max(1, Math.round(imageBox.naturalWidth * fit * zoom))
            const height = Math.max(1, Math.round(imageBox.naturalHeight * fit * zoom))
            return { width: `${width}px`, height: `${height}px` }
          })()

          const statusText = job?.status === 'running'
            ? L('pv.running')
            : job?.status === 'queued' ? L('pv.queued') : undefined

          /**
           * diff 里一项的标签文字：控件类型 + 文字或描述。
           *
           * `changed` 项本身没有 text，变化前后的值在 `changes` 里，
           * 所以这里回退到 before/after 里的那一个，至少能认出是哪一行。
           *
           * @param {any} item - added / removed / changed 里的一项。
           * @returns {string} 形如 `TextView “Alarms”`。
           */
          const diffLabel = (item) => {
            const describe = (node) => {
              if (node === null || node === undefined) return ''
              if (typeof node.text === 'string' && node.text.length > 0) return node.text
              if (typeof node.contentDescription === 'string' && node.contentDescription.length > 0) return `“${node.contentDescription}”`
              return ''
            }
            let text = describe(item)
            if (text === '' && Array.isArray(item?.changes)) {
              const first = item.changes[0]
              text = describe({ text: first?.after ?? first?.before })
            }
            const type = item?.type ?? '?'
            return text === '' ? type : `${type} ${text}`
          }

          /**
           * 一条 `changed` 的细节：每个字段的 before → after，以及位移量。
           *
           * @param {any} item - changed 里的一项。
           * @returns {string} 单行摘要；没有可说的字段时返回空串。
           */
          const diffDetail = (item) => {
            const parts = []
            const FIELD_LABEL = {
              text: L('pv.diffFieldText'),
              contentDescription: L('pv.diffFieldDesc'),
              role: L('pv.diffFieldRole'),
            }
            if (Array.isArray(item?.changes)) {
              for (const change of item.changes) {
                const label = FIELD_LABEL[change?.field] ?? String(change?.field ?? '')
                const before = change?.before === null || change?.before === undefined ? '∅' : String(change.before)
                const after = change?.after === null || change?.after === undefined ? '∅' : String(change.after)
                parts.push(`${label} ${before} → ${after}`)
              }
            }
            /* 位移只报最大的一边：四个方向都列出来在 10px 字号下没法读。
               坐标变了但位移量为 0 的情况（同尺寸换位置）也算「有位移」，
               所以不能拿 maxDelta > 0 当条件。 */
            const boundsChange = item?.boundsChange
            if (boundsChange !== undefined && boundsChange !== null) {
              const maxDelta = boundsChange.maxDelta
              const delta = boundsChange.delta
              if (typeof maxDelta === 'number' && Number.isFinite(maxDelta) && delta !== null && typeof delta === 'object') {
                const horizontal = Math.abs(delta.left ?? 0) >= Math.abs(delta.top ?? 0)
                const axis = horizontal
                  ? `Δx ${delta.left ?? 0}`
                  : `Δy ${delta.top ?? 0}`
                parts.push(`${L('pv.diffMoved')} ${axis}（${maxDelta}px）`)
              } else {
                /* 某一侧缺 bounds：没法和上一版对齐比较，如实说一句。 */
                parts.push(`${L('pv.diffMoved')} ?`)
              }
            }
            return parts.join(' · ')
          }

          /**
           * 渲染 diff 列表里的一行。
           *
           * @param {'added'|'removed'|'changed'} kind
           * @param {any} item
           * @param {string} key
           * @returns {any}
           */
          const diffRow = (kind, item, key) => {
            const detail = kind === 'changed' ? diffDetail(item) : ''
            const badge = kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'
            return h('div', {
              key,
              className: 'damp-pvdiffrow',
              'data-kind': kind,
              onMouseEnter: () => setDiffHover({ kind, item }),
              onMouseLeave: () => setDiffHover((current) => (current?.item?.id === item?.id && current?.kind === kind ? null : current)),
              title: detail === '' ? diffLabel(item) : `${diffLabel(item)}\n${detail}`,
            },
              h('span', { className: 'damp-pvrowtype' }, badge),
              h('span', { className: 'damp-pvdifftext' }, diffLabel(item)),
              detail === '' ? null : h('span', { className: 'damp-pvdiffdetail' }, detail),
            )
          }

          /**
           * 右侧那一栏里的 diff 视图。
           *
           * 四种形态：还没拉过 / 正在拉 / 拉失败 / 有结果。有结果里还要区分
           * 「首次渲染没有基线」——这种情况绝不能显示「无变化」，那是在撒谎。
           *
           * @returns {any}
           */
          const diffPane = (() => {
            /* 空态与加载态统一用 position:static 的普通块：
               `.damp-empty` 是 absolute inset:0 的，放在这一栏里会跑去盖住整块区域。 */
            const placeholder = (text) => h('div', {
              className: 'damp-pvcount',
              style: { padding: '10px 6px', textAlign: 'center', whiteSpace: 'pre-wrap', opacity: '.72' },
            }, text)
            if (diffLoading) return placeholder(L('pv.diffLoading'))
            if (diffError !== null) return placeholder(diffError)
            if (diff === null) {
              return placeholder(entry.renderedAt === undefined ? L('pv.diffFirst') : L('pv.diffEmpty'))
            }
            /* 没有基线：只给一句话，其余东西一概不显示。 */
            if (diff.hasBaseline !== true) {
              return placeholder(L('pv.diffFirst'))
            }
            const summary = diff.summary ?? {}
            const frame = diff.frame
            const added = Array.isArray(diff.added) ? diff.added : []
            const removed = Array.isArray(diff.removed) ? diff.removed : []
            const changed = Array.isArray(diff.changed) ? diff.changed : []
            /* 尺寸变了坐标就不可比：这句话必须排在所有节点差异之前，
               否则用户会先看到一堆「位移 300px」而不知道那是画布换了。 */
            const frameWarn = frame?.sizeChanged === true
              ? h('div', { className: 'damp-pvdiffwarn' },
                `${L('pv.diffFrame')}（${frame.before?.width ?? '?'}×${frame.before?.height ?? '?'} → ${frame.after?.width ?? '?'}×${frame.after?.height ?? '?'}），${L('pv.diffFrameHint')}`)
              : null
            const summaryRow = h('div', { className: 'damp-pvdiffsummary' },
              `${L('pv.diffAdded')} ${summary.added ?? 0}`,
              `· ${L('pv.diffRemoved')} ${summary.removed ?? 0}`,
              `· ${L('pv.diffTextChanged')} ${summary.textChanged ?? 0}`,
              `· ${L('pv.diffGeometry')} ${summary.geometryChanged ?? 0}`,
            )
            const nothing = added.length === 0 && removed.length === 0 && changed.length === 0
            return h('div', { className: 'damp-pvdiff' },
              frameWarn,
              summaryRow,
              nothing
                ? placeholder(L('pv.diffNone'))
                : h('div', { className: 'damp-pvdifflist' },
                  added.length === 0 ? null : h('div', { className: 'damp-pvcount' }, `${L('pv.diffAdded')} ${added.length}`),
                  added.map((item, index) => diffRow('added', item, `a-${item?.id ?? index}`)),
                  removed.length === 0 ? null : h('div', { className: 'damp-pvcount' }, `${L('pv.diffRemoved')} ${removed.length}`),
                  removed.map((item, index) => diffRow('removed', item, `r-${item?.id ?? index}`)),
                  changed.length === 0 ? null : h('div', { className: 'damp-pvcount' }, `${L('pv.diffTextChanged')} / ${L('pv.diffGeometry')} ${changed.length}`),
                  changed.map((item, index) => diffRow('changed', item, `c-${item?.id ?? index}`)),
                ),
              h('div', { className: 'damp-pvcount', style: { padding: '4px 3px' } }, L('pv.diffHover')),
            )
          })()

          return h('div', { className: 'damp-pv' },
            h('div', { className: 'damp-pvbar' },
              h('button', { className: 'damp-btn', onClick: onBack, title: L('pv.back') }, `← ${L('pv.back')}`),
              h('span', { className: 'damp-pvname', style: { flex: '1 1 auto', WebkitLineClamp: '1' }, title: entry.fqn }, entry.title),
              /* 缩放三件套与画面 tab 同构：− / 百分比（点了回适应窗口）/ +。
                 百分比按钮兼作「适应窗口」，和画面 tab 的交互保持一致。 */
              h('button', { className: 'damp-btn', onClick: zoomOut, title: L('pv.zoomOut') }, '−'),
              h('button', {
                className: 'damp-btn',
                'data-active': zoom === 1 ? 'true' : 'false',
                onClick: zoomFit,
                title: L('pv.zoomFit'),
              }, `${Math.round(zoom * 100)}%`),
              h('button', { className: 'damp-btn', onClick: zoomIn, title: L('pv.zoomIn') }, '+'),
              /* 对比按钮：只切视图，不发请求——真正的 diff 由下面的 effect
                 在切到 diff 时才拉，保证首屏不多一次往返。 */
              h('button', {
                className: 'damp-btn',
                'data-active': pane === 'diff' ? 'true' : 'false',
                onClick: () => setPane((value) => (value === 'diff' ? 'tree' : 'diff')),
                title: L('pv.diffHint'),
              }, L('pv.diffOpen')),
              h('button', {
                className: 'damp-btn damp-primary',
                onClick: () => onRender(entry.key),
              }, statusText ?? L('pv.rerender')),
            ),
            h('div', { className: 'damp-pvcount' },
              entry.renderer !== undefined ? `${L('pv.renderer')} ${entry.renderer}` : null,
              entry.width !== undefined ? ` · ${L('pv.size')} ${entry.width}×${entry.height}` : null,
              tree !== null ? ` · ${L('pv.tree')} ${nodes.length} ${L('pv.ofNodes')}` : null,
              entry.lastError !== undefined ? ` · ${L('pv.error')}` : null,
            ),
            /* 失败原因贴在最上面，而不是塞进 tooltip：它是这一页最该先看到的东西。 */
            entry.lastError !== undefined
              ? h('div', {
                className: 'damp-pvcount',
                style: { color: 'color-mix(in srgb,#e05252 80%,currentColor)', whiteSpace: 'pre-wrap', maxHeight: '72px', overflow: 'auto' },
                title: entry.lastError,
              }, `${L('pv.errorTitle')}：${entry.lastError}`)
              : null,
            /* 一次性反馈（点中被过滤的节点、导出结果）贴在工具条下方，
               不放进语义树底部——树很长时底部滚不到，等于没提示。 */
            notice === null
              ? null
              : h('div', { className: 'damp-notice', style: { fontSize: '10.5px' } }, notice),
            h('div', { className: 'damp-pvdetail' },
              /* stage 的 ref 与 onClick 都在这一处：点击位置要先换算成图片坐标，
                 所以命中判定必须在容器上做，而不是在 <img> 上——
                 放大后图片只占容器的一部分，留白区点下去也该能清空选中。 */
              h('div', {
                className: 'damp-pvstage',
                ref: stageRef,
                onClick: pickAt,
                title: L('pv.pickHint'),
              },
                imageUrl === undefined
                  ? h('div', { className: 'damp-empty' }, L('pv.noImage'))
                  : h('img', {
                    src: imageUrl,
                    alt: entry.title,
                    ref: imgRef,
                    style: imageStyle,
                    /* 尺寸一旦由我们算出来，就要解除 max-width/max-height，
                       否则放大只是「不再缩小」，图停在容器大小看不出区别。 */
                    'data-zoomed': imageStyle === undefined ? 'false' : 'true',
                  }),
                box === null ? null : h('div', { className: 'damp-pvbox', style: box }),
                /* 选中框画在 hover 框之后：两者重叠时橙色压在上面，不会被盖掉。 */
                selectedBox === null ? null : h('div', {
                  className: 'damp-pvbox',
                  'data-selected': 'true',
                  style: selectedBox,
                }),
                /* diff 悬停框画在最后：它是一次性的、语义最强的反馈，压在最上面。 */
                ...diffBoxes.map((entry, index) => h('div', {
                  key: `diff-${index}`,
                  className: 'damp-pvbox',
                  'data-diff': entry.tone,
                  style: entry.style,
                })),
              ),
              h('div', { className: 'damp-pvtree' },
                /* 顶部两个视图按钮就是「语义树 / 对比上一版」的开关：
                   两者都吃满这一栏，并排会两边都读不清，所以二选一。 */
                h('div', { className: 'damp-pvbar', style: { marginBottom: '3px' } },
                  h('button', {
                    className: 'damp-btn',
                    'data-active': pane === 'tree' ? 'true' : 'false',
                    onClick: () => setPane('tree'),
                    title: L('pv.tree'),
                  }, L('pv.tree')),
                  h('button', {
                    className: 'damp-btn',
                    'data-active': pane === 'diff' ? 'true' : 'false',
                    onClick: () => setPane('diff'),
                    title: L('pv.diffHint'),
                  }, L('pv.diffTab')),
                  pane === 'tree'
                    ? [
                      h('button', {
                        key: 'all',
                        className: 'damp-btn',
                        'data-active': showAll ? 'true' : 'false',
                        onClick: () => setShowAll((value) => !value),
                        title: L('pv.treeAll'),
                      }, showAll ? L('pv.treeAll') : L('pv.treeSemantic')),
                      h('span', { key: 'count', className: 'damp-pvcount' }, `${visible.length}/${nodes.length}`),
                      h('button', {
                        key: 'export',
                        className: 'damp-btn',
                        disabled: nodes.length === 0,
                        onClick: exportTree,
                        title: L('pv.exportHint'),
                      }, L('pv.export')),
                    ]
                    : [
                      h('button', {
                        key: 'rediff',
                        className: 'damp-btn',
                        disabled: diffLoading || entry.renderedAt === undefined,
                        onClick: () => setDiffToken((value) => value + 1),
                        title: L('pv.diffHint'),
                      }, L('pv.diffRefresh')),
                    ],
                ),
                /* 剪贴板不可用时的降级面板：只读 textarea，已经全选好，⌘C 即可。
                   只在语义树视图里出现——导出的是树，摆在 diff 面板里没有意义。 */
                exportText === null || pane !== 'tree'
                  ? null
                  : h('div', { className: 'damp-pvexport' },
                    h('div', { className: 'damp-pvcount' }, L('pv.exportPrompt')),
                    h('textarea', {
                      className: 'damp-pvexporttext',
                      ref: exportRef,
                      readOnly: true,
                      value: exportText,
                      onFocus: (event) => { event.target?.select?.() },
                    }),
                  ),
                pane === 'diff'
                  ? diffPane
                  : [
                    tree === null
                      ? h('div', { className: 'damp-empty' }, treeError ?? L('pv.treeEmpty'))
                      : visible.length === 0
                        ? h('div', { className: 'damp-empty' }, L('pv.treeEmpty'))
                        : visible.map((node) => h('div', {
                          key: node.id,
                          className: 'damp-pvrow',
                          'data-hover': hover?.id === node.id ? 'true' : 'false',
                          'data-active': selected?.id === node.id ? 'true' : 'false',
                          ref: (element) => {
                            /* 用 ref 回调登记每一行：选中后要 scrollIntoView。
                               卸载时（element 为 null）顺手删掉，别留着失效节点。 */
                            if (element === null) rowRefs.current.delete(node.id)
                            else rowRefs.current.set(node.id, element)
                          },
                          style: { paddingLeft: `${3 + node.depth * 7}px` },
                          onMouseEnter: () => setHover(node),
                          onMouseLeave: () => setHover((current) => (current?.id === node.id ? null : current)),
                          onClick: () => setSelected(node),
                          title: `${node.type} (${node.bounds.left},${node.bounds.top}) - (${node.bounds.right},${node.bounds.bottom})`,
                        },
                          h('span', { className: 'damp-pvrowtype' }, node.type),
                          node.text !== undefined ? h('span', { className: 'damp-pvrowtext' }, node.text) : null,
                          node.text === undefined && node.contentDescription !== undefined
                            ? h('span', { className: 'damp-pvrowtext', style: { opacity: '.7' } }, `“${node.contentDescription}”`)
                            : null,
                          h('span', { className: 'damp-pvrowbounds' }, `${node.bounds.right - node.bounds.left}×${node.bounds.bottom - node.bounds.top}`),
                        )),
                    /* 选中节点的完整信息：bounds 精确值在树行里被省略了，这里补上。 */
                    selected === null
                      ? null
                      : h('div', { className: 'damp-pvcount', style: { padding: '4px 3px', whiteSpace: 'pre-wrap' } },
                        `${selected.type} · ${selected.bounds.left},${selected.bounds.top} → ${selected.bounds.right},${selected.bounds.bottom}`),
                    tree !== null && visible.length > 0
                      ? h('div', { className: 'damp-pvcount', style: { padding: '4px 3px' } }, L('pv.treeHint'))
                      : null,
                  ],
              ),
            ),
          )
        }

        /**
         * 预览总览：按模块分组的卡片网格。
         *
         * 首屏只读索引、不触发任何渲染——40 个 preview 全渲染要 200 秒，
         * 那是不可接受的等待。所以卡片要么显示上次的图（可能已过期，
         * 用黄点标出来），要么显示灰底占位。
         */
        function PreviewTab(props) {
          const sessionId = props?.sessionId
          const [data, setData] = React.useState(null)
          const [error, setError] = React.useState(null)
          const [scanning, setScanning] = React.useState(false)
          const [keyword, setKeyword] = React.useState('')
          const [moduleFilter, setModuleFilter] = React.useState('')
          const [onlyStale, setOnlyStale] = React.useState(false)
          const [selectedKey, setSelectedKey] = React.useState(null)
          /* 已提交但还没跑完的任务 id；用来在卡片上显示「渲染中」并驱动轮询。 */
          const [jobs, setJobs] = React.useState([])
          /* 最近一次批量渲染的进度快照。数据来自 `/preview/status` 的 `summary`
             （聚合值由宿主给，前端不数数组——队列只保留有限条历史，
             一次几十个的批量会把早先的条目挤掉，自己数会让总数中途缩水）。
             `batches` 一起存下来：`summary` 是全局的，批次粒度只有它有。 */
          const [batch, setBatch] = React.useState(null)
          /* 正在等 render-batch 响应：按钮禁用，避免连点排出两批。 */
          const [queuing, setQueuing] = React.useState(null)
          /* 批量相关的短暂提示（纯字符串）；超时由 effect 收掉。 */
          const [batchNotice, setBatchNotice] = React.useState(null)
          const alive = React.useRef(true)
          /* 上一轮是否还有活着的批次；用来只在「刚跑完」那一下刷新列表。 */
          const batchActive = React.useRef(false)

          React.useEffect(() => () => { alive.current = false }, [])

          const apply = React.useCallback((payload) => {
            if (!alive.current) return
            setData(payload)
            setJobs(Array.isArray(payload?.jobs) ? payload.jobs : [])
            /* 列表响应里也带进度聚合，顺手同步一次：
               面板刚打开时没有轮询，只能靠它显示已有批次。 */
            if (payload?.jobSummary !== undefined) {
              setBatch({ summary: payload.jobSummary, batches: Array.isArray(payload?.batches) ? payload.batches : [] })
            }
          }, [])

          /**
           * 把 `/preview/status` 的响应记进进度快照。
           *
           * `/status` 只回 `summary`（不含 `batches`），所以这里要**保留**已有的
           * `batches`——它来自 `/preview/list`。两个来源写同一个 state，谁都不能
           * 把对方清空，否则「批次粒度的进度」会随每次轮询消失。
           *
           * 定义位置必须在使用它的轮询 effect **之上**：放进 effect 依赖数组的变量
           * 若在后面声明，就会在首次渲染时触发 TDZ、整个面板白屏（历史事故）。
           *
           * @param {{ summary?: any }} payload
           * @returns {void}
           */
          const applyStatus = React.useCallback((payload) => {
            if (!alive.current) return
            if (payload?.summary === undefined) return
            /* 批次快照优先于全局 summary：`summary` 统计的是整个 job 队列，
               分母含已经跑完的历史记录，拿它算「本次批量」进度会明显偏小。
               `/status` 现在也返回 batches，所以轮询期间批次进度是活的。 */
            setBatch((current) => ({
              summary: payload.summary,
              batches: Array.isArray(payload.batches) ? payload.batches : current?.batches ?? [],
            }))
          }, [])

          const load = React.useCallback(() => post('/preview/list', { sessionId })
            .then((payload) => { apply(payload); setError(null) })
            .catch((cause) => { if (alive.current) setError(String(cause?.message ?? cause)) }), [apply, sessionId])

          const rescan = React.useCallback(() => {
            setScanning(true)
            return post('/preview/reconcile', { sessionId })
              .then((payload) => { apply(payload); setError(null) })
              .catch((cause) => { if (alive.current) setError(String(cause?.message ?? cause)) })
              .finally(() => { if (alive.current) setScanning(false) })
          }, [apply, sessionId])

          /* 首次进入：先读索引；索引是空的就自动扫一次，免得用户对着空面板发呆。
             判断条件是「从没扫完过」（finishedAt 为空）——扫完但确实没有 preview
             时不再反复触发，否则会陷入无休止的 Gradle 扫描。 */
          React.useEffect(() => {
            load()
          }, [load])

          const scanTriggered = React.useRef(false)
          React.useEffect(() => {
            if (data === null || scanTriggered.current) return
            if (data.entries.length > 0) return
            if (data.scan?.running === true) return
            if (data.scan?.finishedAt !== undefined) return
            scanTriggered.current = true
            rescan()
          }, [data, rescan])

          /* 有任务在跑就轮询；跑完顺手重新取一次索引，让新图与状态一起更新。 */
          const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
          const activeIds = active.map((job) => job.id).join(',')
          React.useEffect(() => {
            if (activeIds.length === 0) return undefined
            const timer = setInterval(() => {
              post('/preview/status', { sessionId })
                .then((payload) => {
                  const next = Array.isArray(payload?.jobs) ? payload.jobs : []
                  if (!alive.current) return
                  setJobs(next)
                  /* 进度聚合与 `jobs` 一起存：同一个响应里两样都有，
                     不必为了进度条再开一次轮询（这一条就是复用点）。 */
                  applyStatus(payload)
                  const stillRunning = next.some((job) => job.status === 'queued' || job.status === 'running')
                  if (!stillRunning) load()
                })
                .catch(() => {})
            }, 1500)
            return () => clearInterval(timer)
          }, [activeIds, applyStatus, load, sessionId])

          const render = React.useCallback((key) => {
            post('/preview/render', { key, sessionId })
              .then(() => post('/preview/status', { sessionId }))
              .then((payload) => {
                if (!alive.current) return
                if (Array.isArray(payload?.jobs)) setJobs(payload.jobs)
                applyStatus(payload)
              })
              .catch((cause) => { if (alive.current) setError(String(cause?.message ?? cause)) })
          }, [applyStatus, sessionId])

          /**
           * 批量渲染：把一批 key 或一个模块整体排进队列。
           *
           * 入队本身很快（宿主只建 job 记录，不等渲染），真正的进度靠轮询里的
           * `summary` 带回来。`accepted === false` 不算错误：那是「无事可做」，
           * 比如全 fresh 或都已在队列里，用一条提示说明就行。
           *
           * @param {{ module?: string, keys?: string[], onlyOutdated?: boolean, scope: string, leftOut?: number }} request
           *   `scope` 只用于显示「哪个按钮正在排队」，与请求体无关。
           * @returns {void}
           */
          const renderBatch = React.useCallback((request) => {
            const body = { sessionId }
            if (request.module !== undefined) body.module = request.module
            if (Array.isArray(request.keys)) body.keys = request.keys
            if (request.onlyOutdated === true) body.onlyOutdated = true
            setQueuing({ key: request.scope })
            setBatchNotice(null)
            post('/preview/render-batch', body)
              .then((payload) => {
                if (!alive.current) return
                /* 入队后立刻问一次状态：进度条要马上出现，不能等 1.5 秒。
                   这一步不新建轮询，只是复用同一个响应形态。 */
                return post('/preview/status', { sessionId }).then((status) => {
                  if (!alive.current) return
                  if (Array.isArray(status?.jobs)) setJobs(status.jobs)
                  /* `/status` 不带 `batches`，所以走 applyStatus——它保留已有的批次快照。 */
                  applyStatus(status)
                  if (payload?.accepted !== true) {
                    setBatchNotice(L('pv.batchNothing'))
                    return
                  }
                  const parts = [`${L('pv.batchQueued')} ${typeof payload?.total === 'number' ? payload.total : 0}`]
                  /* 被范围裁掉的那部分要如实说出来，否则用户以为全排上了。 */
                  if (typeof request.leftOut === 'number' && request.leftOut > 0) {
                    parts.push(`${request.leftOut} ${L('pv.batchLeftOut')}`)
                  }
                  /* 宿主回带的两个计数各有含义，别合并：skipped 是「已在队列里」
                     （本来就会跑），unknown 是「索引里压根没有」（不会跑）。 */
                  const skipped = Array.isArray(payload?.skipped) ? payload.skipped.length : 0
                  const unknown = Array.isArray(payload?.unknown) ? payload.unknown.length : 0
                  if (skipped > 0) parts.push(`${L('pv.batchSkipped')} ${skipped}`)
                  if (unknown > 0) parts.push(`${L('pv.batchUnknown')} ${unknown}`)
                  setBatchNotice(parts.join(' · '))
                })
              })
              .catch((cause) => { if (alive.current) setError(String(cause?.message ?? cause)) })
              .finally(() => { if (alive.current) setQueuing(null) })
          }, [applyStatus, sessionId])

          /* 批次跑完 → 刷新一次列表让新图出现。
             只在「上一轮还有活着的批次、这一轮没有了」那一下触发，
             否则每次轮询都会刷新，把面板打成持续重载。 */
          const summary = batch?.summary
          const batchRunning = (summary?.queued ?? 0) + (summary?.running ?? 0) > 0
          React.useEffect(() => {
            const was = batchActive.current
            batchActive.current = batchRunning
            if (was !== true || batchRunning) return
            if (!alive.current) return
            load()
            setBatchNotice(L('pv.batchDone'))
          }, [batchRunning, load])

          /* 完成提示 4 秒后收掉；进度条本身由 `batchRunning` 决定，跑完即消失。 */
          React.useEffect(() => {
            if (batchNotice === null) return undefined
            const timer = setTimeout(() => setBatchNotice(null), 4000)
            return () => clearTimeout(timer)
          }, [batchNotice])

          const entries = data?.entries ?? []
          const modules = data?.modules ?? []
          const jobByKey = new Map()
          for (const job of jobs) {
            if (job.status === 'queued' || job.status === 'running') jobByKey.set(job.key, job)
          }

          const filtered = (() => {
            const kw = keyword.trim().toLowerCase()
            return entries.filter((entry) => {
              if (moduleFilter.length > 0 && entry.module !== moduleFilter) return false
              /* 「只看要更新的」把从未渲染、已过期、失败三种都算进来——
                 这三种都是「现在看到的不是最新」，这才是要动作的集合。 */
              if (onlyStale && entry.status === 'fresh') return false
              if (kw.length === 0) return true
              return `${entry.title} ${entry.fqn} ${entry.module}`.toLowerCase().includes(kw)
            })
          })()

          /* 选中项从最新的 entries 里取，这样重新渲染后它自动带上新图。 */
          const selected = selectedKey === null ? null : entries.find((entry) => entry.key === selectedKey) ?? null

          if (selected !== null) {
            return h(PreviewDetail, {
              entry: selected,
              job: jobByKey.get(selected.key),
              sessionId,
              onBack: () => setSelectedKey(null),
              onRender: render,
            })
          }

          const groups = []
          for (const entry of filtered) {
            const last = groups[groups.length - 1]
            if (last !== undefined && last.module === entry.module) last.entries.push(entry)
            else groups.push({ module: entry.module, entries: [entry] })
          }

          /* 「渲染全部缺失」的范围：当前筛选下、从未渲染过、且不在队列里的那些。
             刻意**不含** stale（源码变了但图还在）：那些是本机 Gradle 增量重排，
             一次几十个要按分钟算，用户真正缺的是「连图都没有」的那批。
             stale 另有入口——「只看要更新的」筛出来，然后按模块点「渲染本模块」。
             外加 10 个的硬上限：一个 2–8 秒，排 39 个就是几分钟，
             一次塞进队列只会让人干等，还不如让他看着 10 个跑完再点一次。 */
          const missingKeys = filtered
            .filter((entry) => entry.status === 'never' && !jobByKey.has(entry.key))
            .map((entry) => entry.key)
          const missingLimit = 10
          const missingScope = missingKeys.slice(0, missingLimit)
          const missingLeftOut = Math.max(0, missingKeys.length - missingScope.length)

          const queuingAny = queuing !== null
          const queuingScope = queuing?.key
          /* 进度优先用**批次口径**（activeBatch），拿不到才退回全局 summary。
             全局 summary 的分母是整个 job 队列，含历史记录——用它显示
             「本次批量」的进度，跑完 3 个时可能还停在 13%。 */
          const activeBatch = (Array.isArray(batch?.batches) ? batch.batches : []).find((item) => item?.active === true)
          const useBatchScope = Number.isFinite(activeBatch?.total) && activeBatch.total > 0
          const batchPercent = Math.max(0, Math.min(100, useBatchScope
            ? Math.round(Number(activeBatch.percent) || 0)
            : Math.round(summary?.percent ?? 0)))
          const batchTotal = useBatchScope ? activeBatch.total : (summary?.total ?? 0)
          const batchFinished = useBatchScope
            ? (Number(activeBatch.done ?? 0) + Number(activeBatch.failed ?? 0) + Number(activeBatch.cancelled ?? 0))
            : (summary?.finished ?? 0)
          const failedShown = useBatchScope
            ? Number(activeBatch.failed ?? 0)
            : (summary?.failed ?? 0)
          const batchBar = batchRunning
            ? h('div', { className: 'damp-pvbatch' },
              h('div', { className: 'damp-pvbatchrow' },
                h('span', null, `${L('pv.batchRendering')} ${batchFinished}/${batchTotal}${failedShown > 0 ? ` · ${L('pv.batchFailed')} ${failedShown}` : ''}`),
                h('span', null, `${batchPercent}%`),
              ),
              h('div', { className: 'damp-pvbar-track' },
                h('div', { className: 'damp-pvbar-fill', style: { width: `${batchPercent}%` } }),
              ),
            )
            : null

          return h('div', { className: 'damp-pv' },
            h('div', { className: 'damp-pvbar' },
              h('input', {
                className: 'damp-input damp-pvsearch',
                value: keyword,
                placeholder: L('pv.search'),
                onChange: (event) => setKeyword(event.target.value),
              }),
              h('select', {
                className: 'damp-btn',
                value: moduleFilter,
                onChange: (event) => setModuleFilter(event.target.value),
              },
                h('option', { value: '' }, L('pv.allModules')),
                modules.map((module) => h('option', { key: module, value: module }, module)),
              ),
              h('button', {
                className: 'damp-btn',
                'data-active': onlyStale ? 'true' : 'false',
                onClick: () => setOnlyStale((value) => !value),
                title: L('pv.onlyStale'),
              }, L('pv.onlyStale')),
              h('button', {
                className: 'damp-btn',
                'data-active': scanning ? 'true' : 'false',
                disabled: scanning,
                onClick: rescan,
                title: L('pv.refresh'),
              }, scanning ? L('pv.refreshing') : L('pv.refresh')),
              h('button', {
                className: 'damp-btn damp-primary',
                disabled: queuingAny || missingScope.length === 0,
                onClick: () => renderBatch({
                  keys: missingScope,
                  scope: 'missing',
                  leftOut: missingLeftOut,
                }),
                title: L('pv.renderMissingHint'),
              }, queuingScope === 'missing'
                ? L('pv.batchQueuing')
                : `${L('pv.renderMissing')}${missingScope.length > 0 ? ` (${missingScope.length})` : ''}`),
            ),
            /* 批量进度条紧贴工具条下方：它是「刚才那次点击的结果」，
               放到计数行下面会被扫描信息挤远。 */
            batchBar,
            batchNotice === null
              ? null
              : h('div', {
                className: 'damp-pvcount',
                style: { color: 'color-mix(in srgb,#34c759 78%,currentColor)' },
              }, batchNotice),
            h('div', { className: 'damp-pvcount' },
              data?.repoLabel !== undefined ? `${L('pv.repo')} ${data.repoLabel} · ` : null,
              `${L('pv.total')} ${filtered.length}/${entries.length}`,
              data?.counts !== undefined ? ` · ${L('pv.fresh')} ${data.counts.fresh} · ${L('pv.stale')} ${data.counts.stale}` : null,
              data?.studio !== undefined ? ` · ${data.studio.available ? L('pv.studioReady') : L('pv.studioAway')}` : null,
              active.length > 0 ? ` · ${L('pv.running')} ${active.length}` : null,
              data?.scan?.discovery?.summary !== undefined ? ` · ${L('pv.discovery')} ${data.scan.discovery.summary}` : null,
            ),
            error !== null
              ? h('div', { className: 'damp-pvcount', style: { color: 'color-mix(in srgb,#e05252 80%,currentColor)' } }, error)
              : null,
            data?.scan?.error !== undefined && data.scan.error !== null
              ? h('div', {
                className: 'damp-pvcount',
                style: { color: 'color-mix(in srgb,#e5a50a 80%,currentColor)' },
                title: data.scan.error,
              }, data.scan.error)
              : null,
            data !== null && data.scan?.cliAvailable === false
              ? h('div', { className: 'damp-pvcount' }, L('pv.noCli'))
              : null,
            h('div', { className: 'damp-pvgrid' },
              entries.length === 0
                ? h('div', { className: 'damp-empty' }, scanning
                  ? `${L('pv.discovering')}${data?.scan?.progress !== undefined && data.scan.progress.total > 0
                    ? ` ${data.scan.progress.done}/${data.scan.progress.total}` : ''}`
                  : L('pv.empty'))
                : filtered.length === 0
                  ? h('div', { className: 'damp-empty' }, L('pv.emptyFilter'))
                  : groups.map((group) => [
                    h('div', { key: `g-${group.module}`, className: 'damp-pvgroup' },
                      h('span', null, group.module),
                      h('span', null, String(group.entries.length)),
                      /* 模块级批量：交给宿主的 `enqueueModule` 自己决定排哪些，
                         这里只传模块名和 onlyOutdated——筛选逻辑在服务端，
                         面板不要再抄一份，否则两边口径迟早分叉。 */
                      h('button', {
                        className: 'damp-pvgroupbtn',
                        disabled: queuingAny,
                        onClick: (event) => {
                          /* 分组标题行外层是普通 div，但它在卡片网格里，
                             阻止冒泡避免将来套进可点区域后误触发。 */
                          event?.stopPropagation?.()
                          renderBatch({ module: group.module, onlyOutdated: true, scope: `m:${group.module}` })
                        },
                        title: L('pv.renderModuleHint'),
                      }, queuingScope === `m:${group.module}` ? L('pv.batchQueuing') : L('pv.renderModule')),
                    ),
                    ...group.entries.map((entry) => {
                      const job = jobByKey.get(entry.key)
                      const status = job !== undefined ? (job.status === 'running' ? 'running' : 'never') : entry.status
                      return h('button', {
                        key: entry.key,
                        className: 'damp-pvcard',
                        onClick: () => setSelectedKey(entry.key),
                        title: entry.fqn,
                      },
                        h('div', { className: 'damp-pvthumb', 'data-empty': entry.hasImage ? 'false' : 'true' },
                          entry.hasImage
                            ? h('img', {
                              src: `${ROUTE}/preview/image?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}&v=${entry.renderedAt ?? 0}`,
                              alt: entry.title,
                              loading: 'lazy',
                            })
                            : h('span', null, entry.title),
                        ),
                        h('div', { className: 'damp-pvname' }, entry.title),
                        h('div', { className: 'damp-pvmeta' },
                          h('span', { className: 'damp-pvdot', 'data-s': status }),
                          h('span', null, job !== undefined
                            ? (job.status === 'running' ? L('pv.running') : L('pv.queued'))
                            : L(`pv.${entry.status}`)),
                          entry.needsStudio === true
                            ? h('span', { title: L('pv.needsStudioHint'), style: { opacity: '.8' } }, '· Studio')
                            : null,
                        ),
                      )
                    }),
                  ]),
            ),
          )
        }

        /**
         * 面板外壳：三个标签页（画面 / 日志 / 预览）。
         * 分开是因为看画面要尽可能多的竖直空间，看日志要整屏高度，
         * 看预览要整块宽度放卡片网格；塞进同一页都不够用。
         */
        function Body(props) {
          const [tab, setTab] = React.useState('screen')
          return h('div', { className: 'damp-shell' },
            h('div', { className: 'damp-tabs' },
              h('button', {
                className: 'damp-tab',
                'data-active': tab === 'screen' ? 'true' : 'false',
                onClick: () => setTab('screen'),
              }, L('tab.screen')),
              h('button', {
                className: 'damp-tab',
                'data-active': tab === 'log' ? 'true' : 'false',
                onClick: () => setTab('log'),
              }, L('tab.log')),
              h('button', {
                className: 'damp-tab',
                'data-active': tab === 'preview' ? 'true' : 'false',
                onClick: () => setTab('preview'),
              }, L('tab.preview')),
            ),
            h('div', { className: 'damp-tabpane' },
              tab === 'screen' ? h(ScreenTab, props) : tab === 'log' ? h(LogcatTab, props) : h(PreviewTab, props),
            ),
          )
        }

        return {
          inject: ['slots', 'locale'],
          /**
           * 注册右栏页签类型与渲染槽。
           * @param {any} ctx - 客户端插件上下文。
           */
          apply(ctx) {
            ctx.effect(() => {
              const style = document.createElement('style')
              style.id = 'dsh-android-mirror-pane-css'
              style.dataset.pluginCss = ID
              style.textContent = CSS
              document.head.appendChild(style)
              return () => style.remove()
            }, 'dsh-android-mirror-pane: 面板样式')

            ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scope) => scope.effect(() => {
              const done = []
              /* 先登记页签类型：没有这一条，右栏的“+”里就找不到它。 */
              try {
                const tabs = scope.sidebarRightTabs
                if (tabs !== undefined && typeof tabs.register === 'function') {
                  const registration = tabs.register({
                    id: KIND, // ui-copy-ignore
                    kind: KIND, // ui-copy-ignore
                    title: () => L('type.label'),
                    guide: [{
                      order: 45,
                      title: () => L('type.label'),
                      description: () => L('type.hint'),
                      icon: 'mdi:cellphone-link',
                    }],
                  })
                  if (registration !== undefined) done.push(registration)
                }
              } catch {
                /* 重名注册说明旧实例还在：本页不再重复登记，避免整栏重建。 */
              }

              done.push(scope.slots.inject(SLOT, () => scope.slots.register({
                name: SLOT, // ui-copy-ignore
                key: KIND, // ui-copy-ignore
                locale: NS, // ui-copy-ignore
                inject: (sessionId) => ({ sessionId }),
              }, Body)))

              done.push(scope.slots.inject(TITLE_SLOT, () => scope.slots.register({
                name: TITLE_SLOT, // ui-copy-ignore
                key: KIND, // ui-copy-ignore
                locale: NS, // ui-copy-ignore
              }, () => h('span', null, L('type.label')))))

              return () => {
                for (const dispose of done.reverse()) {
                  try { dispose?.() } catch { /* 已撤 */ }
                }
              }
            }, 'dsh-android-mirror-pane: 右栏页签'))
          },
        }
      },
    })
  } catch (error) {
    window.__DAMP_LOADED__ = false
    throw error
  }
}
