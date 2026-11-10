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
/* 详情页：左图右树，窄面板下自动上下堆叠。 */
.damp-pvdetail{display:flex;flex:1 1 auto;min-height:0;gap:6px}
.damp-pvstage{position:relative;flex:1 1 58%;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;border-radius:7px;background:color-mix(in srgb,#888 12%,transparent);padding:3px}
.damp-pvstage img{max-width:100%;max-height:100%;display:block;object-fit:contain}
.damp-pvbox{position:absolute;pointer-events:none;border:1.5px solid #0a84ff;border-radius:2px;box-shadow:0 0 0 1px #fff6;z-index:3}
.damp-pvtree{flex:1 1 42%;min-width:0;min-height:0;overflow:auto;border-radius:7px;background:color-mix(in srgb,#888 8%,transparent);padding:3px 4px;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:10.5px;line-height:1.5}
.damp-pvrow{display:flex;gap:5px;padding:1px 3px;border-radius:3px;cursor:default;white-space:nowrap}
.damp-pvrow[data-hover="true"]{background:color-mix(in srgb,#0a84ff 18%,transparent)}
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
          const [showAll, setShowAll] = React.useState(false)

          /* 树与图一起失效：重新渲染后 renderedAt 变，两个 URL 都要跟着换。 */
          React.useEffect(() => {
            let alive = true
            setTree(null)
            setTreeError(null)
            setHover(null)
            if (entry.renderedAt === undefined) return () => { alive = false }
            fetch(`${ROUTE}/preview/tree?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}`)
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
              .then((payload) => { if (alive) setTree(payload) })
              .catch((cause) => { if (alive) setTreeError(String(cause?.message ?? cause)) })
            return () => { alive = false }
          }, [entry.key, entry.renderedAt, sessionId])

          const imageUrl = entry.hasImage
            ? `${ROUTE}/preview/image?${sessionQuery(sessionId)}&key=${encodeURIComponent(entry.key)}&v=${entry.renderedAt ?? 0}`
            : undefined

          /* 默认只显示有语义的节点：实测 headless 77 个节点里只有 16 个带语义，
             整棵铺开反而找不到要看的那几行。 */
          const nodes = tree?.nodes ?? []
          const visible = showAll ? nodes : nodes.filter((node) => node.hasSemantics === true)
          const scaleX = tree?.width ? 100 / tree.width : 0
          const scaleY = tree?.height ? 100 / tree.height : 0
          const box = hover === null || tree === null
            ? null
            : {
              left: `${hover.bounds.left * scaleX}%`,
              top: `${hover.bounds.top * scaleY}%`,
              width: `${(hover.bounds.right - hover.bounds.left) * scaleX}%`,
              height: `${(hover.bounds.bottom - hover.bounds.top) * scaleY}%`,
            }

          const statusText = job?.status === 'running'
            ? L('pv.running')
            : job?.status === 'queued' ? L('pv.queued') : undefined

          return h('div', { className: 'damp-pv' },
            h('div', { className: 'damp-pvbar' },
              h('button', { className: 'damp-btn', onClick: onBack, title: L('pv.back') }, `← ${L('pv.back')}`),
              h('span', { className: 'damp-pvname', style: { flex: '1 1 auto', WebkitLineClamp: '1' }, title: entry.fqn }, entry.title),
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
            h('div', { className: 'damp-pvdetail' },
              h('div', { className: 'damp-pvstage' },
                imageUrl === undefined
                  ? h('div', { className: 'damp-empty' }, L('pv.noImage'))
                  : h('img', { src: imageUrl, alt: entry.title }),
                box === null ? null : h('div', { className: 'damp-pvbox', style: box }),
              ),
              h('div', { className: 'damp-pvtree' },
                h('div', { className: 'damp-pvbar', style: { marginBottom: '3px' } },
                  h('button', {
                    className: 'damp-btn',
                    'data-active': showAll ? 'true' : 'false',
                    onClick: () => setShowAll((value) => !value),
                    title: L('pv.treeAll'),
                  }, showAll ? L('pv.treeAll') : L('pv.treeSemantic')),
                  h('span', { className: 'damp-pvcount' }, `${visible.length}/${nodes.length}`),
                ),
                tree === null
                  ? h('div', { className: 'damp-empty' }, treeError ?? L('pv.treeEmpty'))
                  : visible.length === 0
                    ? h('div', { className: 'damp-empty' }, L('pv.treeEmpty'))
                    : visible.map((node) => h('div', {
                      key: node.id,
                      className: 'damp-pvrow',
                      'data-hover': hover?.id === node.id ? 'true' : 'false',
                      style: { paddingLeft: `${3 + node.depth * 7}px` },
                      onMouseEnter: () => setHover(node),
                      onMouseLeave: () => setHover((current) => (current?.id === node.id ? null : current)),
                      title: `${node.type} (${node.bounds.left},${node.bounds.top}) - (${node.bounds.right},${node.bounds.bottom})`,
                    },
                      h('span', { className: 'damp-pvrowtype' }, node.type),
                      node.text !== undefined ? h('span', { className: 'damp-pvrowtext' }, node.text) : null,
                      node.text === undefined && node.contentDescription !== undefined
                        ? h('span', { className: 'damp-pvrowtext', style: { opacity: '.7' } }, `“${node.contentDescription}”`)
                        : null,
                      h('span', { className: 'damp-pvrowbounds' }, `${node.bounds.right - node.bounds.left}×${node.bounds.bottom - node.bounds.top}`),
                    )),
                tree !== null && visible.length > 0
                  ? h('div', { className: 'damp-pvcount', style: { padding: '4px 3px' } }, L('pv.treeHint'))
                  : null,
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
          const alive = React.useRef(true)

          React.useEffect(() => () => { alive.current = false }, [])

          const apply = React.useCallback((payload) => {
            if (!alive.current) return
            setData(payload)
            setJobs(Array.isArray(payload?.jobs) ? payload.jobs : [])
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
                  const stillRunning = next.some((job) => job.status === 'queued' || job.status === 'running')
                  if (!stillRunning) load()
                })
                .catch(() => {})
            }, 1500)
            return () => clearInterval(timer)
          }, [activeIds, load, sessionId])

          const render = React.useCallback((key) => {
            post('/preview/render', { key, sessionId })
              .then(() => post('/preview/status', { sessionId }))
              .then((payload) => { if (alive.current && Array.isArray(payload?.jobs)) setJobs(payload.jobs) })
              .catch((cause) => { if (alive.current) setError(String(cause?.message ?? cause)) })
          }, [sessionId])

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
            ),
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
