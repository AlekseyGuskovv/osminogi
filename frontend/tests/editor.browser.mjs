import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'cyber-garden-browser-'))
const chrome = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const children = []
function start(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })
  children.push(child)
  child.on('error', error => console.error(error.message))
  child.stderr.on('data', chunk => {
    if (process.env.DEBUG_MSW_CHECK) process.stderr.write(chunk)
  })
}

async function until(action) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const value = await action()
      if (value) return value
    } catch {}
    await wait(100)
  }
  throw new Error('Browser or Vite did not become ready')
}

async function evaluate(port, test, path = "/", reducedMotion = false) {
  const url = 'http://127.0.0.1:' + port + path
  const response = await fetch('http://127.0.0.1:' + debug + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  if (!response.ok) throw new Error(await response.text())
  const target = await response.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    let id = 0
    function call(method, params) {
      const requestId = ++id
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), method === 'Runtime.evaluate' ? 95000 : 20000)
        function listen(message) {
          const response = JSON.parse(message.data)
          if (response.id !== requestId) return
          clearTimeout(timer)
          socket.removeEventListener('message', listen)
          if (response.error) reject(new Error(response.error.message))
          else resolve(response.result)
        }
        socket.addEventListener('message', listen)
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    }
    await until(async () => {
      const result = await call('Runtime.evaluate', { expression: '!!document.querySelector("#root")?.children.length', returnByValue: true })
      return result.result.value
    })
    if (reducedMotion) await call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await call('Runtime.enable', {})
    let syntheticTokenLogged = false
    socket.addEventListener('message', message => {
      const event = JSON.parse(message.data)
      if (event.method === 'Runtime.consoleAPICalled' && JSON.stringify(event.params.args).includes('DEMO-CONNECTION-TOKEN')) {
        syntheticTokenLogged = true
      }
    })
    await call('Runtime.addBinding', { name: 'dispatchDrag' })
    await call('Runtime.addBinding', { name: 'dispatchClick' })
    await call('Runtime.addBinding', { name: 'insertText' })
    socket.addEventListener('message', async message => {
      const event = JSON.parse(message.data)
      if (event.method !== 'Runtime.bindingCalled') return
      if (event.params.name === 'insertText') {
        await call('Input.insertText', { text: event.params.payload })
        return
      }
      const { x, y } = JSON.parse(event.params.payload)
      if (event.params.name === 'dispatchClick') {
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
        await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
        await call('Runtime.evaluate', { expression: 'globalThis.clickComplete = true' })
        return
      }
      if (event.params.name !== 'dispatchDrag') return
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      for (const distance of [10, 25, 45]) {
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + distance, y: y + distance / 2, buttons: 1 })
      }
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 45, y: y + 22.5, button: 'left', clickCount: 1 })
      await call('Runtime.evaluate', { expression: 'setTimeout(() => { globalThis.dragComplete = true }, 35)' })
    })
    const result = await call('Runtime.evaluate', {
      expression: '(' + test.toString() + ')()',
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    if (syntheticTokenLogged) throw new Error('A connection token appeared in console output')
    console.log(result.result.value)
  } finally {
    socket.close()
  }
}

let debug
try {
  for (const [port, enabled] of [[4175, 'true'], [4176, 'false'], [4177, 'true']]) {
    start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { ...process.env, VITE_USE_MOCKS: enabled, VITE_API_BASE: '/api/v1/' })
    await until(async () => (await fetch('http://127.0.0.1:' + port + '/')).ok)
  }
  start(chrome, ['--headless', '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-port=0', '--user-data-dir=' + join(root, 'chrome-v2'), 'about:blank'])
  debug = await until(async () => (await readFile(join(root, 'chrome-v2', 'DevToolsActivePort'), 'utf8')).split('\n')[0])

  await evaluate(4177, async () => {
    async function until(test) {
      for (let i = 0; i < 150; i++) {
        const value = test()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('Focus Canvas did not reach the expected state')
    }
    const ring = document.querySelector('.garden-theme-picker select')
    const canvas = await until(() => document.querySelector('.react-flow'))
    const viewport = await until(() => canvas.querySelector('.react-flow__viewport'))
    const gate = await until(() => canvas.querySelector('[data-id="gate"]'))
    gate.querySelector('.garden-node').click()
    const inspector = document.querySelector('#workflow-inspector')
    const palette = document.querySelector('#workflow-palette')
    const toggle = document.querySelector('.garden-focus-toggle')
    const threshold = await until(() => inspector.querySelector('select:has(option[value="critical"])'))
    threshold.value = 'high'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => document.querySelector('.garden-save-state[data-dirty="true"]'))
    canvas.querySelector('.react-flow__controls-zoomin').click()
    await new Promise(resolve => setTimeout(resolve, 350))
    const width = canvas.getBoundingClientRect().width
    const transform = viewport.style.transform
    const nodePosition = gate.style.transform
    const requestCount = () => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/v1/')).length
    const beforeFocusRequests = requestCount()
    const key = (target, value) => {
      const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    if (key(threshold, 'f') || toggle.getAttribute('aria-pressed') !== 'false') throw new Error('Editable field triggered Focus Canvas')
    toggle.click()
    await until(() => toggle.getAttribute('aria-pressed') === 'true' && canvas.getBoundingClientRect().width > width + 150)
    if (!inspector.inert || !palette.inert || !toggle.getAttribute('aria-controls') ||
        !canvas.querySelector('[aria-label="Выйти из режима фокуса"]')) throw new Error('Focus controls are not accessible')
    for (const theme of ['prism-light', 'dark']) {
      ring.value = theme
      ring.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 320))
      if (toggle.getAttribute('aria-pressed') !== 'true' || canvas !== document.querySelector('.react-flow') ||
          viewport.style.transform !== transform || gate.style.transform !== nodePosition || !gate.classList.contains('selected')) {
        throw new Error('Theme switch changed Focus Canvas, camera or selection')
      }
    }
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    dialog.showModal()
    if (key(dialog, 'Escape') || toggle.getAttribute('aria-pressed') !== 'true') throw new Error('Focus hotkey interfered with a modal')
    dialog.close()
    dialog.remove()
    if (!key(toggle, 'Escape')) throw new Error('Escape did not exit Focus Canvas')
    await until(() => toggle.getAttribute('aria-pressed') === 'false' && Math.abs(canvas.getBoundingClientRect().width - width) < 1)
    if (inspector !== document.querySelector('#workflow-inspector') || inspector.inert || palette.inert ||
        threshold.value !== 'high' || viewport.style.transform !== transform) throw new Error('Editor state was lost leaving Focus Canvas')
    key(toggle, 'f')
    await until(() => toggle.getAttribute('aria-pressed') === 'true')
    canvas.querySelector('[aria-label="Выйти из режима фокуса"]').click()
    await until(() => toggle.getAttribute('aria-pressed') === 'false')
    if (document.activeElement !== toggle) throw new Error('Focus was not restored to the trigger')
    if (beforeFocusRequests !== requestCount()) throw new Error('Focus Canvas repeated API requests')
    toggle.click()
    const save = [...document.querySelectorAll('.garden-actions button')].find(button => button.textContent === 'Сохранить')
    save.click()
    const toast = await until(() => document.querySelector('.prism-toast:not([hidden]) [role="status"]'))
    if (!toast.textContent.includes('Сохранено')) throw new Error('Workflow did not save in Focus Canvas')
    toast.parentElement.querySelector('[aria-label="Закрыть уведомление"]').click()
    if (!toast.parentElement.hidden) await until(() => toast.parentElement.hidden)
    const snapshot = document.querySelector('.garden-snapshot-select')
    snapshot.value = 'pr-1'
    snapshot.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => document.querySelector('.garden-actions .garden-primary:not(:disabled)')).then(button => button.click())
    const hologram = await until(() => canvas.querySelector('.hologram[data-phase="running"]'))
    const playbackTransform = viewport.style.transform
    toggle.click()
    await until(() => toggle.getAttribute('aria-pressed') === 'false')
    if (!hologram.isConnected || !canvas.isConnected || viewport.style.transform !== playbackTransform) {
      throw new Error('Focus Canvas interrupted active playback')
    }
    return 'Focus Canvas: camera, node, unsaved edit, theme, dialog, keyboard, save, toast and active playback retained'
  }, '/?workflow=wf-1')

  for (const [id, branch, status, reason] of [
    ['run-1', 'YES', 'FAILED', 'CRITICAL_FOUND'],
    ['run-2', 'NO', 'PASSED', 'NO_CRITICAL'],
  ]) {
    await evaluate(4175, new Function(`return async () => {
      async function until(predicate) {
        for (let i = 0; i < 150; i++) {
          const value = predicate()
          if (value) return value
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        throw Error('Explainable CI did not reach the expected state')
      }
      const button = (root, label) => [...root.querySelectorAll('button')].find(item => item.textContent === label)
      const preview = await until(() => document.querySelector('.garden-preview'))
      const threshold = preview.querySelector('select')
      threshold.value = 'high'
      threshold.dispatchEvent(new Event('change', { bubbles: true }))
      button(preview, 'Предпросмотр').click()
      await until(() => preview.querySelector('[data-preview-branch]'))
      const trigger = button(document, '${status}' === 'FAILED' ? 'Почему CI не пройден?' : 'Объяснение CI')
      const open = () => document.querySelector('section[aria-label="Объяснение CI"]')
      trigger.click()
      const panel = await until(open)
      if (document.querySelectorAll('.garden-preview').length !== 1 || threshold.value !== 'high' ||
        !(panel.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)) throw Error('Threshold duplicated or reset')
      const step = () => panel.querySelector('.replay-step').textContent
      if ('${status}' === 'FAILED') {
        await until(() => step().includes('Secrets') && step().includes('secret'))
      }
      button(panel, 'Далее').click()
      await until(() => panel.querySelector('nav [aria-pressed="true"]').textContent.includes('Находка'))
      if ('${status}' === 'FAILED') {
        if (!step().includes('F-key') || !step().includes('Critical')) throw Error('Critical finding missing')
        button(panel, 'Открыть находку').click()
        await until(() => panel.querySelector('[data-finding-id="F-key"]'))
      } else if (panel.textContent.includes('F-key') || button(panel, 'Открыть находку')) throw Error('Old finding leaked into green CI')
      button(panel, 'Далее').click()
      await until(() => step().includes('gate') && step().includes('${branch}'))
      button(panel, 'Далее').click()
      await until(() => step().includes('CI ${status}') && step().includes('${reason}'))
      button(panel, 'Назад').click()
      await until(() => step().includes('${branch}'))
      const link = new URL(panel.querySelector('a[href*="ciRun"]').href)
      if (link.searchParams.get('ciRun') !== '${id}' || link.searchParams.get('explain') !== '1') throw Error('Wrong explanation link')
      button(panel, 'Закрыть').click()
      await until(() => !open() && document.activeElement === trigger)
      trigger.click()
      await until(open)
      if (document.querySelectorAll('.garden-preview').length !== 1) throw Error('Reopening duplicated the preview')
      const { getJson } = await import('/src/api.ts')
      const run = await getJson('/runs/${id}')
      if ('${status}' === 'PASSED' && (!run.steps.some(item => item.nodeId === 'tg' && item.status === 'skipped') ||
        run.findings.some(item => item.id === 'F-key'))) throw Error('Green run fixture is inconsistent')
      return 'Explainable CI ${id}: all four steps, correct finding and route, stable threshold preview and focus'
    }`)(), '/?view=runs&workflow=wf-1&run=' + id)

    await evaluate(4175, new Function(`return async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
      const edgeId = 'gate:${branch.toLowerCase()}'
      const panel = () => document.querySelector('.replay-inspector [aria-label="Объяснение CI"]')
      for (let i = 0; i < 150 && (!panel() || !document.querySelector('[data-id="' + edgeId + '"].garden-ci-edge')); i++) await sleep(20)
      const canvas = document.querySelector('.react-flow')
      const gate = canvas?.querySelector('[data-id="gate"] [data-ci-highlight]')
      if (!gate || !panel() || !canvas.querySelector('[data-id="' + edgeId + '"].garden-ci-edge') ||
        ('${status}' === 'FAILED' && !canvas.querySelector('[data-id="secret"] [data-ci-highlight]'))) throw Error('Graph evidence is incorrect')
      const identity = [...canvas.querySelectorAll('.react-flow__node, .react-flow__edge')]
      ;[...panel().querySelectorAll('button')].find(button => button.textContent === 'Закрыть').click()
      await sleep(100)
      if (panel() || !identity.every(element => element.isConnected) || canvas !== document.querySelector('.react-flow')) throw Error('Close remounted the graph')
      return 'Explainable graph ${id}: correct branch and stable Canvas'
    }`)(), '/?workflow=wf-1&ciRun=' + id + '&explain=1')
  }

  await evaluate(4175, async () => {
    function assert(value, message) {
      if (!value) throw new Error(message)
    }
    async function waitFor(condition) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (condition()) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Editor did not reach the expected state: ' + document.querySelector('.garden-notice')?.textContent)
    }

    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 8)
    await waitFor(() => document.querySelectorAll('.react-flow__edge').length === 7)
    const palette = document.querySelector('[aria-label="Палитра"]')
    const { nodeTypes } = await import('/src/workflow.ts')
    assert([...palette.querySelectorAll('[data-block-type]')].map(item => item.dataset.blockType).sort().join() ===
      [...nodeTypes].sort().join(), 'Palette contains every workflow node type')
    const condition = document.querySelector('.react-flow__node[data-id="gate"]')
    condition.querySelector('.garden-node').click()
    assert(condition.querySelectorAll('.source').length === 2, 'Two condition outputs')
    const settings = document.querySelector('[aria-label="Настройки блока"]')
    await waitFor(() => settings.querySelector('select option[value="critical"]'))
    const threshold = settings.querySelector('select:has(option[value="critical"])')
    assert(threshold.value === 'critical', 'Initial condition threshold')
    threshold.value = 'high'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => threshold.value === 'high')
    document.querySelector('[data-id="start"] .garden-node').click()
    await waitFor(() => settings.querySelector('input[type="checkbox"]'))
    settings.querySelector('input[type="checkbox"]').click()
    await waitFor(() => settings.querySelector('input[type="time"]')?.value === '09:00')
    document.querySelector('[data-id="tg"] .garden-node').click()
    await waitFor(() => settings.querySelector('.garden-connection-select')?.value === 'team-demo')

    const flowDuringDrag = document.querySelector('.react-flow')
    const stableElements = [
      flowDuringDrag, flowDuringDrag.querySelector('.react-flow__background'),
      ...flowDuringDrag.querySelectorAll('.react-flow__node, .react-flow__edge'),
    ]
    let edgeDisappeared = false
    const observer = new MutationObserver(() => {
      if (stableElements.some(element => !element?.isConnected)) edgeDisappeared = true
    })
    observer.observe(flowDuringDrag, { subtree: true, childList: true })
    const canvas = document.querySelector('.garden-canvas')
    const rect = condition.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    assert(condition.contains(document.elementFromPoint(x, y)), 'Drag starts on visible node')
    globalThis.dispatchDrag(JSON.stringify({ x, y }))
    await waitFor(() => Math.abs(condition.getBoundingClientRect().left - rect.left) > 5)
    await waitFor(() => globalThis.dragComplete)
    assert(canvas.contains(condition), 'Dragged condition still on canvas')
    observer.disconnect()
    assert(!edgeDisappeared && stableElements.every(element => element?.isConnected),
      'Canvas, background, nodes and edges retain their DOM identity on drag')

    const select = document.querySelector('.garden-snapshot-select')
    assert(select.options.length === 5, 'Snapshot options loaded from API')
    select.value = 'pr-1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const buttons = [...document.querySelectorAll('.garden-actions button')]
    await waitFor(() => !buttons.find(button => button.textContent.includes('Запустить')).disabled)
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('ревизия 2'))
    const { getJson } = await import('/src/api.ts')
    const workflow = await getJson('/workflows/wf-1')
    const gate = workflow.nodes.find(node => node.id === 'gate')
    assert(gate.x !== 430, 'Drag coordinates saved to API')
    assert(gate.settings.rules?.[0]?.value === 'high', 'Condition form updates saved threshold')
    assert(workflow.schedule?.timezone === 'Europe/Moscow', 'Schedule form updates saved workflow')
    assert(workflow.nodes.find(node => node.id === 'tg').settings.channelId === 'team-demo', 'Telegram channel remains in graph')
    const runButton = buttons.find(button => button.textContent.includes('Запустить'))
    const nativeFetch = window.fetch
    let starts = 0
    window.fetch = (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/workflows/wf-1/runs')) {
        starts++
        return new Promise(resolve => setTimeout(resolve, 150)).then(() => nativeFetch(input, init))
      }
      return nativeFetch(input, init)
    }
    runButton.click()
    runButton.click()
    try {
      await waitFor(() => runButton.disabled)
      await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('в очередь'))
      assert(starts === 1, 'Only one POST runs is sent')
      assert(document.querySelector('[data-run-status="queued"]'), 'Accepted run opens as queued')
    } finally {
      window.fetch = nativeFetch
    }

    await waitFor(() => document.querySelector('[data-run-status="succeeded"]'))
    assert(document.querySelector('[data-ci-status="failed"]'), 'Native SSE separates completed run from red CI')
    assert(!document.body.textContent.includes('Запуск поставлен в очередь'), 'Completed run clears its queued message')
    assert(document.querySelector('.garden-run-accepted').textContent.includes('Воспроизводится анимация'),
      'Actual CI is available before visual playback finishes')
    await waitFor(() => document.querySelector('[data-id="secret"] [data-node-status="succeeded"]'))
    document.querySelector('[data-id="secret"] .garden-node').click()
    await waitFor(() => settings.querySelector('pre')?.textContent.includes('F-key'))
    await waitFor(() => document.querySelector('[data-id="gate"] [data-node-status="succeeded"]'))
    const { postJson } = await import('/src/api.ts')
    const addAndSelect = () => palette.querySelector('[data-block-type=secrets]').click()
    addAndSelect()
    await waitFor(() => document.querySelector('[data-id="secrets-1"] .source'))
    const clickHandle = async selector => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const handle = document.querySelector(selector)
      function point() {
        const rect = handle.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        return document.elementFromPoint(x, y) === handle ? { x, y } : undefined
      }
      if (!point()) document.querySelector('.react-flow__controls-fitview')?.click()
      let position
      try { await waitFor(() => { position = point(); return position }) }
      catch {
        const rect = handle.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        throw new Error(selector + ' handle at ' + JSON.stringify(rect.toJSON()) + ' has ' + handle.className + ', hit ' + hit?.className)
      }
      globalThis.clickComplete = false
      globalThis.dispatchClick(JSON.stringify(position))
      await waitFor(() => globalThis.clickComplete)
    }
    await clickHandle('[data-id="start"] .source')
    await waitFor(() => document.querySelector('[data-id="start"] .source.clickconnecting'))
    await clickHandle('[data-id="secrets-1"] .target')
    await waitFor(() => !document.querySelector('[data-id="start"] .source.clickconnecting'))
    await clickHandle('[data-id="secrets-1"] .source')
    await waitFor(() => document.querySelector('[data-id="secrets-1"] .source.clickconnecting'))
    await clickHandle('[data-id="secret"] .target')
    await waitFor(() => document.querySelector('[data-testid="rf__edge-secrets-1:next"]'))
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('ревизия 3'))
    const committed = await getJson('/workflows/wf-1')
    assert(committed.edges.some(edge => edge.from === 'start' && edge.to === 'secrets-1'), 'Added node connected before save')
    assert(committed.edges.some(edge => edge.from === 'secrets-1' && edge.to === 'secret'), 'Added node output saved')
    await postJson('/workflows/wf-1/save', { ...committed, name: 'Изменено параллельно' })

    palette.querySelector('[data-block-type=secrets]').click()
    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 10)
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('актуальную ревизию'))
    assert(document.querySelectorAll('.react-flow__node').length === 10, 'Rejected save retains changes')
    palette.querySelector('[data-block-type=secrets]').click()
    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 11)
    assert(document.querySelector('[data-id="secrets-2"]') && document.querySelector('[data-id="secrets-3"]'), 'Duplicate block types receive distinct IDs')
    return 'Editor: graph, palette, selection, drag, settings, API save/run and error recovery passed'
  })

  await evaluate(4175, async () => {
    async function check(condition, message) {
      for (let i = 0; i < 80; i++) {
        if (condition()) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error(message)
    }
    const edgePath = branch => document.querySelector(`[data-testid="rf__edge-gate:${branch}"] path.react-flow__edge-path`)?.getAttribute('d')
    await check(() => edgePath('yes') && edgePath('no'), 'Initial branch paths')
    const yesPath = edgePath('yes')
    const noPath = edgePath('no')
    const gate = document.querySelector('.react-flow__node[data-id="gate"]')
    gate.querySelector('[data-handleid="yes"]').click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    document.querySelector('.react-flow__node[data-id="end"] .target').click()
    await check(() => edgePath('yes') && edgePath('yes') !== yesPath, 'Yes branch updated')
    if (edgePath('no') !== noPath) throw new Error('Changing yes must preserve no')
    gate.querySelector('.garden-node').click()
    const settings = document.querySelector('[aria-label="Настройки блока"]')
    await check(() => settings.querySelector('.garden-remove'), 'Delete action')
    settings.querySelector('.garden-remove').click()
    await check(() => !document.querySelector('.react-flow__node[data-id="gate"]'), 'Deleted block')
    await check(() => !edgePath('yes') && !edgePath('no') && document.querySelectorAll('.react-flow__edge').length === 5,
      'Incident edges removed; unrelated edges preserved')
    return 'Editor: independent branches and deletion passed'
  })

  await evaluate(4175, async () => {
    const { getJson } = await import('/src/api.ts')
    const saved = await getJson('/workflows/wf-1')
    if (saved.revision !== 4 || !saved.nodes.some(node => node.id === 'secrets-1') ||
      saved.nodes.some(node => node.id === 'secrets-2') ||
      saved.nodes.find(node => node.id === 'gate')?.settings.rules?.[0]?.value !== 'high') {
      throw new Error('Stored workflow was not restored')
    }
    for (let attempt = 0; attempt < 80 && !document.querySelector('.react-flow__node'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (document.querySelector('h1')?.textContent !== 'Изменено параллельно') throw new Error('Restored workflow not displayed')
    return 'Reload: saved graph, settings and latest revision restored'
  })

  await evaluate(4175, async () => {
    for (let attempt = 0; attempt < 80 && !document.querySelector('.garden-actions button'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    [...document.querySelectorAll('.garden-actions button')].find(button => button.textContent === 'Сохранить').click()
    for (let attempt = 0; attempt < 80; attempt++) {
      const id = new URL(location.href).searchParams.get('workflow')
      if (id === 'wf-2') return 'Create: submitted a draft and opened its persisted record'
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Created workflow was not opened')
  }, '/?workflow=new')

  await evaluate(4175, async () => {
    for (let i = 0; i < 80 && !document.querySelector('[data-finding-id="F-key"]'); i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const card = document.querySelector('[data-finding-id="F-key"]')
    if (!card?.textContent.includes('application.yml:12') ||
      card.querySelector('pre')?.textContent !== 'api-key: ••••' ||
      !card.querySelector('[data-severity="critical"]') ||
      !card.querySelector('[data-recommendation-source="ai"]')) throw new Error('Incomplete finding card')
    if (!document.querySelector('a[href="?workflow=wf-1&ciRun=run-1"]')) throw new Error('Missing graph link from red CI')
    const { postJson } = await import('/src/api.ts')
    const aiError = await postJson('/workflows/wf-1/runs?scenario=aiError', { trigger: 'manual', snapshotId: 'pr-1' })
    if (aiError.id !== 'run-5') throw new Error('Expected next run ID and persisted history')
    await new Promise(resolve => setTimeout(resolve, 650))
    return 'Findings: criticality, location, masked evidence and AI source displayed'
  }, '/?view=runs&workflow=wf-1&run=run-1')

  await evaluate(4175, async () => {
    for (let i = 0; i < 80 && !document.querySelector('[data-recommendation-source="rule"]'); i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!document.querySelector('[data-recommendation-source="rule"]')?.textContent.includes('правило')) {
      throw new Error('Expected rule recommendation on AI error')
    }
    return 'Findings: fallback rule recommendation displayed'
  }, '/?view=runs&workflow=wf-1&run=run-5')

  await evaluate(4175, async () => {
    async function waitFor(condition) {
      for (let i = 0; i < 80; i++) {
        if (condition()) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Comparison not loaded')
    }
    const comparison = document.querySelector.bind(document)
    await waitFor(() => comparison('[data-comparison-group="existing"] [data-finding-id="F-dep"]'))
    if (comparison('[data-comparison-group="resolved"] [data-finding-id="F-key"]')) {
      throw new Error('Baseline should not record F-key as resolved')
    }
    await waitFor(() => comparison('option[value="run-1"]'))
    const base = comparison('.garden-comparison select')
    base.value = 'run-1'
    base.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => comparison('[data-comparison-group="resolved"] [data-finding-id="F-key"]'))
    if (!comparison('[data-comparison-group="existing"] [data-finding-id="F-dep"]')) {
      throw new Error('Existing finding lost')
    }
    const { getJson } = await import('/src/api.ts')
    const before = await Promise.all([getJson('/workflows/wf-1'), getJson('/workflows/wf-1/runs')])
    const threshold = comparison('.garden-preview select')
    threshold.value = 'high'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(resolve))
    comparison('.garden-preview button').click()
    await waitFor(() => comparison('[data-preview-branch="yes"]')?.textContent.includes('Будет отправлено'))
    const after = await Promise.all([getJson('/workflows/wf-1'), getJson('/workflows/wf-1/runs')])
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Preview changed the workflow or run history')
    threshold.value = 'critical'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(resolve))
    comparison('.garden-preview button').click()
    await waitFor(() => comparison('[data-preview-branch="no"]'))
    return 'Comparison and threshold preview: categories, notifications, and unchanged workflow/history passed'
  }, '/?view=runs&workflow=wf-1&run=run-2')

  await evaluate(4175, async () => {
    for (let i = 0; i < 80 && !document.querySelector('.garden-ci-edge'); i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const nodes = [...document.querySelectorAll('[data-ci-highlight]')].map(node => node.closest('.react-flow__node').dataset.id).sort()
    if (nodes.join(',') !== 'gate,secret') throw new Error('Analyzer and gate must be highlighted')
    if (document.querySelector('.garden-ci-edge')?.getAttribute('data-testid') !== 'rf__edge-gate:yes') {
      throw new Error('Only yes branch must be highlighted')
    }
    if (!document.querySelector('[aria-label="Настройки блока"]')?.textContent.includes('Поиск секретов')) {
      throw new Error('Analyzer was not selected')
    }
    return 'Red CI: analyzer, condition and yes branch highlighted in the editor'
  }, '/?workflow=wf-1&ciRun=run-1')

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 80; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Fix dialog did not reach the expected state')
    }
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
    const { postJson, ApiError } = await import('/src/api.ts')
    async function expectError(path, body, status, code) {
      try { await postJson(path, body) }
      catch (error) { if (error instanceof ApiError && error.status === status && error.code === code) return; throw error }
      throw new Error('Missing API error ' + code)
    }
    await expectError('/runs/run-2/fix-preview', { findingId: 'F-dep' }, 422, 'FIX_UNAVAILABLE')
    await expectError('/runs/run-1/apply-fix', { previewId: 'unknown' }, 409, 'STALE_PREVIEW')
    const open = await waitFor(() => button('Посмотреть учебное исправление'))
    open.click()
    const apply = await waitFor(() => button('Применить исправление'))
    const parts = [...document.querySelectorAll('dialog pre')].map(item => item.textContent)
    if (parts[0] !== 'api-key: ••••' || parts[1] !== 'api-key: ${DEMO_API_KEY}') throw new Error('Unexpected masked diff')
    apply.click()
    await waitFor(() => document.querySelector('[data-fixed-snapshot="pr-2"]'))
    await expectError('/runs/run-1/apply-fix', { previewId: 'fix-1' }, 409, 'STALE_PREVIEW')
    button('Проверить новый снимок').click()
    const next = await waitFor(() => document.querySelector('dialog a'))
    if (!next.href.includes('run=run-6')) throw new Error('Expected repeat run link')
    return 'Fix: masked diff, confirmation, stale preview, unsupported finding and repeat launch passed'
  }, '/?view=runs&workflow=wf-1&run=run-1')

  await evaluate(4175, async () => {
    for (let i = 0; i < 80; i++) {
      const status = document.querySelector('[data-detail-ci="passed"]')
      if (status?.textContent.includes('pr-2')) return 'Fix flow: repeated run against pr-2 is green'
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Repeat run did not turn green')
  }, '/?view=runs&workflow=wf-1&run=run-6')

  await evaluate(4175, async () => {
    async function waitFor(condition) {
      for (let i = 0; i < 80; i++) {
        const value = condition()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Finding history was not rendered')
    }
    const card = await waitFor(() => document.querySelector('[data-finding-id="F-key"] summary'))
    card.click()
    await waitFor(() => document.querySelector('[data-finding-state="returned"]'))
    const rows = [...document.querySelectorAll('.garden-finding-history li')].slice(0, 3)
    if (rows.map(row => row.dataset.findingState).join() !== 'found,resolved,returned') throw new Error('Incorrect history order')
    if (rows.map(row => row.querySelector('a').textContent).join() !== 'run-1,run-2,run-3') throw new Error('Incorrect history links')
    const { getJson, ApiError } = await import('/src/api.ts')
    try { await getJson('/workflows/wf-1/findings/missing/history') }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'Finding history: found, resolved, returned and not-found passed'
      throw error
    }
    throw new Error('Missing finding should return 404')
  }, '/?view=runs&workflow=wf-1&run=run-3')

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 80; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Template catalog did not reach expected state')
    }
    const publish = await waitFor(() => document.querySelector('.garden-template-empty button'))
    if (!document.querySelector('.garden-template-empty').textContent.includes('Здесь появятся ваши шаблоны')) throw new Error('Missing empty catalog state')
    publish.click()
    const form = await waitFor(() => document.querySelector('dialog[open] .garden-template-form'))
    const input = form.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Проверка PR')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => !form.querySelector('button:last-child').disabled)
    form.querySelector('button[type="button"]').click()
    publish.click()
    if (input.value !== 'Проверка PR') throw new Error('Closing the modal discarded the template draft')
    form.requestSubmit()
    const card = await waitFor(() => document.querySelector('[data-template-id="tpl-1"]'))
    const { getJson } = await import('/src/api.ts')
    const [template] = await getJson('/templates')
    if (template.workflow.snapshotId || template.workflow.schedule ||
      template.workflow.nodes.find(node => node.type === 'telegram').settings.channelId) {
      throw new Error('Public template retained private settings')
    }
    setTimeout(() => card.querySelector('button').click(), 100)
    return 'Templates: empty catalog, publication and scrubbed template payload passed'
  }, '/?view=templates&workflow=wf-1')
  await until(async () => {
    const tabs = await (await fetch('http://127.0.0.1:' + debug + '/json/list')).json()
    return tabs.some(tab => tab.url.endsWith('?workflow=wf-3&setup=1'))
  })
  await evaluate(4175, async () => {
    const { getJson } = await import('/src/api.ts')
    const [copy, original] = await Promise.all([getJson('/workflows/wf-3'), getJson('/workflows/wf-1')])
    if (copy.revision !== 1 || copy.name !== 'Проверка PR' || copy.snapshotId || copy.schedule ||
      copy.nodes.find(node => node.type === 'telegram').settings.channelId ||
      original.snapshotId !== 'pr-1' || !original.schedule) {
      throw new Error('Copy and original are not isolated')
    }
    return 'Templates: copy opens in editor without modifying the original'
  }, '/?workflow=wf-3')

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Draft did not reach expected state')
    }
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
    const { getJson } = await import('/src/api.ts')
    const count = (await getJson('/workflows')).length
    const open = await waitFor(() => button('AI-черновик'))
    open.click()
    const input = document.querySelector('dialog textarea')
    input.focus()
    globalThis.insertText('Найди секреты и объясни риски')
    const generate = await waitFor(() => {
      const submit = button('Сгенерировать черновик')
      return submit && !submit.disabled && submit
    })
    generate.click()
    const accept = await waitFor(() => button('Открыть в редакторе'))
    accept.click()
    await waitFor(() => location.search === '?workflow=new' && document.querySelector('h1').textContent === 'Черновик проверки проекта')
    if ((await getJson('/workflows')).length !== count) throw new Error('Generated draft was automatically saved')
    document.querySelector('[data-id="gate"] .garden-node').click()
    const threshold = await waitFor(() => document.querySelector('[aria-label="Настройки блока"] select:has(option[value="critical"])'))
    threshold.value = 'high'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    const snapshot = document.querySelector('.garden-snapshot-select')
    snapshot.value = 'pr-2'
    snapshot.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(resolve))
    button('Сохранить').click()
    await waitFor(() => location.search === '?workflow=wf-4')
    const saved = await getJson('/workflows/wf-4')
    if (saved.nodes.find(node => node.id === 'gate').settings.rules?.[0]?.value !== 'high') throw new Error('Draft edits lost on save')
    button('Запустить').click()
    await waitFor(() => document.querySelector('[data-run-status="succeeded"]'))
    if (!document.querySelector('[data-ci-status="passed"]')) throw new Error('Draft run did not pass')
    return 'AI draft: generated, edited, explicitly saved, and ran to green CI'
  })

  await evaluate(4175, async () => {
    const { importSnapshot, getJson, ApiError } = await import('/src/api.ts')
    const bytes = Uint8Array.from(atob('UEsDBBQAAAAIALWwdF1L9CGBHQAAABsAAAAKAAAAUkVBRE1FLnR4dHOuTEotUnBPLEpJzVMoSS0uUSjOSywozsgv4QIAUEsBAhQDFAAAAAgAtbB0XUv0IYEdAAAAGwAAAAoAAAAAAAAAAAAAAIABAAAAAFJFQURNRS50eHRQSwUGAAAAAAEAAQA4AAAARQAAAAAA'), char => char.charCodeAt(0))
    const file = new File([bytes], 'learning.zip', { type: 'application/zip' })
    const nativeFetch = window.fetch
    let status
    window.fetch = async (input, options) => {
      const request = new Request(new URL(input, location.origin), options)
      if (!request.headers.get('content-type')?.startsWith('multipart/form-data; boundary=') ||
        options.headers || options.method !== 'POST' || request.url.split(location.origin)[1] !== '/api/v1/snapshots/import') {
        throw new Error('Invalid upload request')
      }
      const response = await nativeFetch(input, options)
      status = response.status
      return response
    }
    let snapshot
    try { snapshot = await importSnapshot(file) }
    finally { window.fetch = nativeFetch }
    if (status !== 201 || snapshot.label !== 'learning' || !(await getJson('/snapshots')).some(item => item.id === snapshot.id)) {
      throw new Error('Imported snapshot missing')
    }
    for (const [badFile, statusCode, code] of [
      [new File(['broken'], 'bad.zip'), 422, 'INVALID_ARCHIVE'],
      [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.zip'), 413, 'ARCHIVE_TOO_LARGE'],
    ]) {
      try { await importSnapshot(badFile); throw new Error('Accepted invalid upload') }
      catch (error) { if (!(error instanceof ApiError) || error.status !== statusCode || error.code !== code) throw error }
    }
    return 'Snapshot import: browser-generated multipart boundary and statuses 201, 413, 422 passed'
  })

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Snapshot picker did not reach expected state')
    }
    const picker = await waitFor(() => document.querySelector('.garden-snapshot-picker'))
    const select = picker.querySelector('select')
    const input = picker.querySelector('input[type="file"]')
    if (select.value !== 'pr-1') throw new Error('Expected the original workflow snapshot')
    function upload(file) {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    upload(new File(['invalid'], 'bad.zip'))
    await waitFor(() => picker.querySelector('[role="alert"]'))
    if (select.value !== 'pr-1') throw new Error('Rejected upload changed the selection')
    const bytes = Uint8Array.from(atob('UEsDBBQAAAAIALWwdF1L9CGBHQAAABsAAAAKAAAAUkVBRE1FLnR4dHOuTEotUnBPLEpJzVMoSS0uUSjOSywozsgv4QIAUEsBAhQDFAAAAAgAtbB0XUv0IYEdAAAAGwAAAAoAAAAAAAAAAAAAAIABAAAAAFJFQURNRS50eHRQSwUGAAAAAAEAAQA4AAAARQAAAAAA'), char => char.charCodeAt(0))
    const file = new File([bytes], 'picked.zip', { type: 'application/zip' })
    upload(file)
    await waitFor(() => select.selectedOptions[0]?.textContent === 'picked')
    const selected = select.value
    const button = [...document.querySelectorAll('.garden-actions button')].find(item => item.textContent.includes('Запустить'))
    button.click()
    await waitFor(() => document.querySelector('[data-run-status="succeeded"]'))
    const { getJson } = await import('/src/api.ts')
    const runId = document.querySelector('.garden-run-accepted a').textContent
    const run = await getJson('/runs/' + runId)
    if (run.snapshotId !== selected || !run.report.summary) throw new Error('Imported snapshot was not used in final report')
    return 'Snapshot picker: rejected upload retained selection; valid ZIP selected and used in a completed run'
  })

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Telegram picker did not reach expected state')
    }
    const node = await waitFor(() => document.querySelector('[data-id="tg"] .garden-node'))
    node.click()
    const picker = await waitFor(() => document.querySelector('.garden-connection-picker'))
    await waitFor(() => picker.querySelector('option[value="team-demo"]')?.textContent === 'Чат команды')
    picker.querySelector('summary').click()
    const form = picker.querySelector('form')
    const token = 'DEMO-CONNECTION-TOKEN'
    if (form.elements.token.type !== 'password') throw new Error('Token input must be masked')
    form.elements.name.value = 'Учебный чат'
    form.elements.chatId.value = '123456'
    form.elements.token.value = token
    form.requestSubmit()
    const selected = await waitFor(() => {
      const value = picker.querySelector('select').value
      return value.startsWith('telegram-') && value
    })
    if (form.elements.token.value !== '') throw new Error('Token input not cleared')
    const save = [...document.querySelectorAll('.garden-actions button')].find(item => item.textContent === 'Сохранить')
    save.click()
    await waitFor(() => document.querySelector('.prism-toast [role="status"]')?.textContent.includes('Сохранено'))
    const { getJson, postJson } = await import('/src/api.ts')
    const [workflow, connections] = await Promise.all([getJson('/workflows/wf-1'), getJson('/connections')])
    const settings = workflow.nodes.find(item => item.id === 'tg').settings
    const metadata = connections.find(item => item.id === selected)
    if (settings.channelId !== selected || 'token' in settings ||
      Object.keys(metadata).sort().join() !== 'configured,id,name,type' ||
      JSON.stringify([workflow, connections, { ...localStorage }]).includes(token)) {
      throw new Error('Graph or connection metadata contains unsupported data')
    }
    const accepted = await postJson('/workflows/wf-3/runs', { trigger: 'manual', snapshotId: 'pr-1' })
    await new Promise(resolve => setTimeout(resolve, 700))
    const run = await getJson('/runs/' + accepted.id)
    if (run.ci.status !== 'failed' || run.delivery !== 'failed' ||
      run.steps.find(step => step.nodeId === 'tg')?.error?.code !== 'CONNECTION_REQUIRED') {
      throw new Error('Missing Telegram connection should not change CI result')
    }
    return 'Telegram: masked input, cleared token, metadata-only storage and CONNECTION_REQUIRED passed'
  })

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Copy setup did not reach expected state')
    }
    const setup = await waitFor(() => document.querySelector('.garden-copy-setup'))
    const snapshot = document.querySelector('.garden-snapshot-select')
    if (snapshot.value) throw new Error('Snapshot choice should be explicit')
    snapshot.value = 'pr-3'
    snapshot.dispatchEvent(new Event('change', { bubbles: true }))
    setup.querySelector('button').click()
    const connection = await waitFor(() => document.querySelector('.garden-connection-select option[value="team-demo"]')?.parentElement)
    if (connection.value) throw new Error('Telegram channel was auto-selected')
    connection.value = 'team-demo'
    connection.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => setup.textContent.includes('Сохраните'))
    const action = word => [...document.querySelectorAll('.garden-actions button')].find(item => item.textContent.includes(word))
    action('Сохранить').click()
    await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('ревизия 2'))
    action('Запустить').click()
    await waitFor(() => document.querySelector('[data-run-status="succeeded"]'))
    const { getJson } = await import('/src/api.ts')
    const runId = document.querySelector('.garden-run-accepted a').textContent
    const [copy, original, run] = await Promise.all([getJson('/workflows/wf-3'), getJson('/workflows/wf-1'), getJson('/runs/' + runId)])
    const channelOf = workflow => workflow.nodes.find(node => node.type === 'telegram').settings.channelId
    if (copy.snapshotId !== 'pr-3' || channelOf(copy) !== 'team-demo' || channelOf(original) === 'team-demo' ||
      original.snapshotId === 'pr-3' || run.snapshotId !== 'pr-3' || run.delivery !== 'sent') {
      throw new Error('Copy did not use independently configured snapshot and channel')
    }
    return 'Template setup: explicit snapshot and Telegram selection, separate save and successful delivery'
  }, '/?workflow=wf-3&setup=1')

  await evaluate(4175, async () => {
    for (let i = 0; i < 80 && !document.querySelector('[data-comparison-group="existing"] [data-finding-id="F-key"]'); i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const reason = document.querySelector('[data-ci-reason="CRITICAL_FOUND"]')
    if (!document.querySelector('[data-detail-ci="failed"]') ||
      !document.querySelector('[data-comparison-group="existing"] [data-finding-id="F-key"]') ||
      document.querySelector('[data-comparison-group="introduced"] [data-finding-id="F-key"]') ||
      !reason?.textContent.includes('F-key') || !reason.querySelector('a')?.href.includes('ciRun=run-existing')) {
      throw new Error('Existing critical finding must explain red CI independently of introduced group')
    }
    const { getJson, ApiError } = await import('/src/api.ts')
    const foreign = (await getJson('/workflows/wf-3/runs'))[0].id
    try { await getJson('/runs/run-existing/comparison?againstRunId=' + foreign) }
    catch (error) {
      if (error instanceof ApiError && error.code === 'INCOMPARABLE_RUNS' && error.status === 409) {
        return 'CI reason: existing critical finding explains red CI; incompatible comparison returns 409'
      }
      throw error
    }
    throw new Error('Expected incompatible runs error')
  }, '/?view=runs&workflow=wf-1&run=run-existing')

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Draft warning flow did not reach expected state')
    }
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
    const { getJson } = await import('/src/api.ts')
    const before = (await getJson('/workflows')).length
    const open = await waitFor(() => button('AI-черновик'))
    open.click()
    const prompt = document.querySelector('dialog textarea')
    prompt.focus()
    globalThis.insertText('Проверяй проект каждый день в 08:30 и отправляй отчёт на email')
    const generate = await waitFor(() => {
      const submit = button('Сгенерировать черновик')
      return submit && !submit.disabled && submit
    })
    generate.click()
    await waitFor(() => document.querySelector('dialog .garden-draft-warnings')?.textContent.includes('Доступен Telegram'))
    button('Открыть в редакторе').click()
    const warnings = await waitFor(() => document.querySelector('.garden-draft-notice'))
    if (!warnings.textContent.includes('Выберите канал')) throw new Error('Draft warning lost in the editor')
    warnings.querySelector('button').click()
    const telegram = await waitFor(() => document.querySelector('.garden-connection-select'))
    if (telegram.value !== '') throw new Error('Telegram channel was automatically selected')
    document.querySelector('[data-id="start"] .garden-node').click()
    const schedule = await waitFor(() => document.querySelector('[aria-label="Настройки блока"] input[type="time"]'))
    if (schedule.value !== '08:30' || (await getJson('/workflows')).length !== before) {
      throw new Error('Requested schedule not shown or draft saved unexpectedly')
    }
    return 'Draft warnings: email fallback remains explicit; editable schedule uses requested 08:30'
  })

  await evaluate(4175, async () => {
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const value = predicate()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Full fix acceptance did not reach expected state')
    }
    const select = await waitFor(() => document.querySelector('.garden-comparison select option[value="run-1"]')?.parentElement)
    select.value = 'run-1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const resolved = await waitFor(() => document.querySelector('[data-comparison-group="resolved"] [data-finding-id="F-key"]'))
    if (!document.querySelector('[data-detail-ci="passed"]') || resolved.querySelector('pre')?.textContent !== 'api-key: ••••') {
      throw new Error('Re-run must be green and resolved proof must stay masked')
    }
    const stream = await fetch('/api/v1/runs/run-1/events', { headers: { 'Last-Event-ID': '2' } })
    const events = await stream.text()
    const { getJson } = await import('/src/api.ts')
    const body = JSON.stringify(await getJson('/runs/run-1'))
    if (events.includes('DEMO-CONNECTION-TOKEN') || events.includes('api-key:') || body.includes('DEMO-CONNECTION-TOKEN') ||
      !events.startsWith('id: 3') || !body.includes('api-key: ••••')) {
      throw new Error('SSE resume or masking invariant failed')
    }
    return 'Full fix acceptance: red CI → masked finding → fix → pr-2 → green CI → resolved F-key; resumed SSE and redaction checked'
  }, '/?view=runs&workflow=wf-1&run=run-6')

  await evaluate(4175, async () => {
    async function until(predicate) {
      for (let i = 0; i < 160; i++) {
        const result = predicate()
        if (result) return result
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      throw new Error('Security Replay did not reach the expected state')
    }
    const find = (root, text) => [...root.querySelectorAll('button')].find(button => button.textContent === text)
    const canvas = await until(() => document.querySelector('.react-flow'))
    await until(() => canvas.querySelectorAll('.react-flow__edge').length >= 7)
    const graph = [...canvas.querySelectorAll('.react-flow__background, .react-flow__node, .react-flow__edge')]
    const view = () => canvas.querySelector('.react-flow__viewport').style.transform
    const camera = view()
    const nativeFetch = window.fetch
    const writes = []
    window.fetch = (input, options) => {
      if (options?.method === 'POST') writes.push(String(input))
      return nativeFetch(input, options)
    }
    try {
      find(document, 'Режим демонстрации').click()
      const panel = await until(() => document.querySelector('.replay-presentation'))
      if (!panel.textContent.includes('Демо · тестовые данные')) throw new Error('Demo label missing')
      await until(() => !find(panel, 'Пауза')?.disabled)
      const controls = panel.querySelector('.pulse-controls select')
      const setSpeed = speed => {
        controls.value = String(speed)
        controls.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const surface = canvas.closest('.garden-canvas')
      const offset = () => Number(surface.style.getPropertyValue('--pulse-offset'))
      const beam = await until(() => canvas.querySelector('.hologram[data-phase="running"] .hologram-motion'))
      const animation = beam.getAnimations()[0]
      await until(() => animation.currentTime > 200)
      for (const speed of [0.5, 2, 1]) {
        const previous = animation.currentTime
        setSpeed(speed)
        const started = await new Promise(resolve => requestAnimationFrame(resolve))
        if (animation.currentTime < previous || !beam.isConnected) throw new Error('Speed change reset the hologram')
        const current = animation.currentTime
        let ended = started
        while (ended - started < 100) ended = await new Promise(resolve => requestAnimationFrame(resolve))
        const rate = (animation.currentTime - current) / (ended - started)
        if (Math.abs(rate - speed) > 0.4) throw new Error(`Unexpected hologram speed: ${rate}`)
      }
      find(panel, 'Пауза').click()
      await until(() => !animation.pending && animation.playState === 'paused')
      const activationTime = animation.currentTime
      await new Promise(resolve => setTimeout(resolve, 100))
      if (animation.currentTime !== activationTime) throw new Error('Scanner moved while paused')
      find(panel, 'Продолжить').click()
      await until(() => animation.currentTime > activationTime)
      await until(() => canvas.querySelector('.pulse-edge-core') && offset() < -3 && offset() > -35)
      setSpeed(0.5)
      await new Promise(resolve => setTimeout(resolve, 40))
      const slowStart = offset()
      await new Promise(resolve => setTimeout(resolve, 110))
      const slowDistance = slowStart - offset()
      const beforeSwitch = offset()
      setSpeed(2)
      await new Promise(resolve => setTimeout(resolve, 35))
      const fastStart = offset()
      if (fastStart > beforeSwitch + 1) throw new Error('Speed change restarted travel')
      await new Promise(resolve => setTimeout(resolve, 110))
      const fastDistance = fastStart - offset()
      if (!(slowDistance > 0 && fastDistance > slowDistance * 2)) throw new Error(`Playback speeds are indistinguishable: ${slowDistance} / ${fastDistance}`)
      find(panel, 'Пауза').click()
      await until(() => find(panel, 'Продолжить'))
      const frozen = offset()
      await new Promise(resolve => setTimeout(resolve, 120))
      if (offset() !== frozen) throw new Error('Pause did not freeze progress')
      find(panel, 'Продолжить').click()
      await until(() => offset() < frozen)
      setSpeed(1)
      find(panel, 'Повторить анимацию').click()
      const replayBeam = await until(() => canvas.querySelector('.hologram[data-phase="running"] .hologram-motion'))
      if (replayBeam === beam || replayBeam.getAnimations()[0].currentTime > 500) throw new Error('Replay did not restart the hologram')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await until(() => canvas.querySelector('.garden-ci-edge'))
      if (canvas.querySelectorAll('[data-ci-highlight]').length !== 2) throw new Error('Expected analyzer and condition')
      find(panel, 'Открыть находку').click()
      await until(() => panel.querySelector('[data-finding-id="F-key"]'))
      find(panel.querySelector(':scope > .replay-controls'), 'Далее').click()
      await until(() => panel.textContent.includes('Учебное исправление'))
      find(panel.querySelector(':scope > .replay-controls'), 'Далее').click()
      await until(() => panel.querySelector('.replay-resolved [data-finding-id="F-key"]'))
      const compare = panel.querySelector('[aria-label="Машина времени безопасности"]')
      find(compare, 'До').click()
      await until(() => compare.querySelector('[data-replay-phase="before"] [data-finding-id="F-key"]'))
      await until(() => canvas.querySelector('[data-id="gate:yes"].garden-ci-edge'))
      find(compare, 'После').click()
      await until(() => compare.querySelector('[data-replay-phase="after"] .replay-resolved [data-finding-id="F-key"]'))
      await until(() => canvas.querySelector('[data-id="gate:no"].garden-ci-edge'))
      find(panel.querySelector(':scope > .replay-controls'), 'Назад').click()
      await until(() => panel.textContent.includes('Учебное исправление'))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await until(() => !document.querySelector('.replay-presentation') && view() === camera)
      if (writes.length || !graph.every(element => element.isConnected)) throw new Error('Slideshow modified data or remounted the graph')
      return 'Security Replay: SSE pulse, explanation, four stages, time machine, unchanged graph and zero writes passed'
    } finally {
      window.fetch = nativeFetch
    }
  })

  for (const reducedMotion of [false, true]) await evaluate(4175, async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    async function until(predicate) {
      for (let i = 0; i < 470; i++) {
        const result = predicate()
        if (result) return result
        await sleep(30)
      }
      throw new Error('Active graph check timed out')
    }
    const button = (root, text) => [...root.querySelectorAll('button')].find(item => item.textContent.includes(text))
    const canvas = await until(() => document.querySelector('.react-flow'))
    const viewport = canvas.querySelector('.react-flow__viewport')
    const pane = canvas.querySelector('.react-flow__pane')
    const snapshot = await until(() => document.querySelector('.garden-snapshot-select'))
    snapshot.value = 'pr-1'
    snapshot.dispatchEvent(new Event('change', { bubbles: true }))
    const run = await until(() => {
      const launch = button(document.querySelector('.garden-actions'), 'Запустить')
      return !launch.disabled && launch
    })
    run.click()
    const controls = await until(() => document.querySelector('.garden-run-accepted .pulse-controls'))
    const select = controls.querySelector('select')
    select.value = '0.5'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const hologram = await until(() => canvas.querySelector('.hologram[data-phase="running"]'))
    const active = hologram.closest('.garden-node')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = hologram.firstElementChild.getAnimations()[0]
    const dragStart = animation?.currentTime
    const center = active.getBoundingClientRect()
    globalThis.dispatchDrag(JSON.stringify({ x: center.x + center.width / 2, y: center.y + center.height / 2 }))
    await until(() => globalThis.dragComplete && Math.abs(active.getBoundingClientRect().x - center.x) > 10)
    if (!reduced && animation.currentTime <= dragStart) throw new Error('Scanner stalled during drag')
    button(controls, 'Пауза').click()
    const hologramStyle = getComputedStyle(hologram)
    if (hologramStyle.pointerEvents !== 'none') throw new Error('Decoration intercepts pointers')
    if (reduced && (animation || getComputedStyle(hologram.querySelector('i')).display !== 'none' ||
      getComputedStyle(hologram.firstElementChild).borderTopWidth !== '1px')) {
      throw new Error('Reduced motion should show a static holographic contour')
    }
    const matrix = () => new DOMMatrix(getComputedStyle(viewport).transform)
    for (const scale of [0.5, 1, 1.5]) {
      const rect = pane.getBoundingClientRect()
      pane.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -Math.log2(scale / matrix().a) / 0.002,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        bubbles: true, cancelable: true,
      }))
      await until(() => Math.abs(matrix().a - scale) < 0.015)
      if (!active.isConnected || !active.contains(hologram)) throw new Error('Zoom removed the active hologram')
    }
    const rect = pane.getBoundingClientRect()
    const initialPan = matrix().e
    globalThis.dragComplete = false
    globalThis.dispatchDrag(JSON.stringify({ x: rect.left + 25, y: rect.top + 25 }))
    await until(() => globalThis.dragComplete && Math.abs(matrix().e - initialPan) > 10)
    await until(() => document.querySelector('.garden-run-accepted [data-ci-status="failed"]'))
    if (!active.isConnected || !canvas.isConnected) throw new Error('Interaction remounted the active graph')
    button(controls, 'Продолжить').click()
    const core = await until(() => canvas.querySelector('.pulse-edge-core'))
    if ((getComputedStyle(core).display === 'none') !== reduced || !canvas.querySelector('.pulse-edge-guide')) {
      throw new Error('Reduced motion should leave only the static edge guide')
    }
    return `Live Holographic Activation: drag, pan, zoom 50/100/150%, independent final result (reduced motion: ${reduced})`
  }, '/?workflow=wf-1', reducedMotion)

  await evaluate(4175, async () => {
    async function until(predicate) {
      for (let i = 0; i < 90; i++) {
        const result = predicate()
        if (result) return result
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('Scanner fixture step timed out')
    }
    // Exercise all eight rendered types with an explicit test-only SSE stream.
    let stream
    window.EventSource = class {
      constructor(url) { this.runId = url.split('/').at(-2); stream = this }
      close() {}
    }
    let seq = 0
    const send = (nodeId, status) => stream.onmessage({ data: JSON.stringify({
      seq: ++seq, runId: stream.runId, type: 'node.status', at: new Date().toISOString(),
      data: { nodeId, status },
    }) })
    const node = id => document.querySelector(`.react-flow__node[data-id="${id}"] .garden-node`)
    const launch = await until(() => [...document.querySelectorAll('.garden-actions button')].find(
      element => element.textContent.includes('Запустить'),
    ))
    const snapshot = document.querySelector('.garden-snapshot-select')
    snapshot.value = 'pr-1'
    snapshot.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => !launch.disabled)
    launch.click()
    const speed = await until(() => stream && document.querySelector('.pulse-controls select'))
    speed.value = '2'
    speed.dispatchEvent(new Event('change', { bubbles: true }))

    send('end', 'skipped')
    await until(() => node('end')?.dataset.execution === 'skipped')
    if (node('end').querySelector('.hologram[data-phase="running"]')) throw new Error('Skipped Finish activated')
    send('start', 'queued')
    await until(() => node('start')?.dataset.execution === 'queued')
    if (node('start').querySelector('.hologram[data-phase="running"]')) throw new Error('Queued Start activated')

    const colors = new Set()
    for (const id of ['start', 'secret', 'deps', 'code', 'ai', 'gate', 'tg', 'end']) {
      send(id, 'running')
      const beam = await until(() => node(id)?.querySelector('.hologram[data-phase="running"] .hologram-motion'))
      const style = getComputedStyle(beam)
      colors.add(getComputedStyle(beam.querySelector('i')).borderTopColor)
      if (style.animationDuration !== '1.8s' || node(id).dataset.execution !== 'running') {
        throw new Error(`Invalid hologram for ${id}`)
      }
      const status = id === 'tg' ? 'failed' : 'succeeded'
      send(id, status)
      await until(() => node(id).dataset.execution === status)
      if (status === 'succeeded') {
        const release = await until(() => node(id).querySelector('.hologram[data-phase="succeeded"] .hologram-motion'))
        if (release !== beam || getComputedStyle(release).animationName !== 'hologram-release') {
          throw new Error('Successful activation did not collapse in place')
        }
      } else if (beam.isConnected) throw new Error('Failed activation remained visible')
    }
    if (colors.size !== 5) throw new Error('Hologram did not inherit the existing accents')
    return 'Holographic Activation: all eight node types, all five accents, queued/skipped and succeeded/failed'
  }, '/?workflow=wf-1')

  await evaluate(4175, async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    async function until(predicate) {
      for (let i = 0; i < 160; i++) {
        const value = predicate()
        if (value) return value
        await sleep(25)
      }
      throw new Error('Time Machine did not reach the expected state')
    }
    const root = await until(() => document.querySelector('.evolution'))
    const [before, after] = await until(() => {
      const controls = root.querySelectorAll('.evolution-select select')
      return controls.length === 2 && controls
    })
    const choose = (select, id) => {
      select.value = id
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    choose(before, 'run-1')
    await until(() => before.value === 'run-1')
    choose(after, 'run-2')
    const track = await until(() => {
      const candidate = root.querySelector('.evolution-track')
      return candidate?.textContent.includes('run-1') && candidate?.textContent.includes('run-2') && candidate
    })
    const press = phase => [...track.querySelectorAll('button')].find(button => button.textContent === phase).click()
    const card = id => root.querySelector(`[data-evolution-card="${id}"]`)
    const link = () => new URL(root.querySelector('.evolution-workflow a').href)
    const outcome = root.querySelector('.evolution-outcome')
    const nativeFetch = window.fetch
    const requests = []
    window.fetch = (input, init) => {
      requests.push({ path: String(input), method: init?.method ?? 'GET' })
      return nativeFetch(input, init)
    }
    try {
      if (![...track.querySelectorAll('[data-ci]')].map(element => element.dataset.ci).join(',').includes('failed,passed')) {
        throw new Error('Expected historical CI failed and passed')
      }
      const metrics = [...root.querySelectorAll('.evolution-metrics dd')].map(element => element.textContent.match(/\d+/g)?.join(' → '))
      if (metrics.join(',') !== '2 → 1,1 → 0,1,1') throw new Error('Incorrect comparison metrics: ' + metrics)
      const key = card('F-key')
      const dependency = card('F-dep')
      if (!key.querySelector('[data-finding-variant="resolved"]') || key.querySelector('[data-severity]') ||
        !dependency.querySelector('[data-severity="high"]') || link().searchParams.get('ciRun') !== 'run-2') {
        throw new Error('Resolved and active cards or graph link are incorrect')
      }
      for (let i = 0; i < 4; i++) {
        press('До')
        await until(() => outcome.dataset.ci === 'failed')
        if (card('F-key') !== key || !key.querySelector('[data-severity="critical"]') ||
          link().searchParams.get('ciRun') !== 'run-1') throw new Error('Before lost the shared card or graph link')
        press('После')
        await until(() => outcome.dataset.ci === 'passed')
      }
      if (requests.length || card('F-dep') !== dependency || card('F-key') !== key) {
        throw new Error('Phase switching fetched data or recreated a shared finding')
      }

      choose(before, 'run-2')
      await until(() => root.querySelector('[role="alert"]')?.textContent.includes('разные'))
      if (root.querySelector('.evolution-track')) throw new Error('Duplicate pair retained stale results')
      let release
      window.fetch = (input, init) => {
        if (String(input).includes('/run-2/comparison?againstRunId=run-1')) return new Promise(resolve => {
          release = () => resolve(nativeFetch(input, init))
        })
        if (String(input).includes('/run-1/comparison?againstRunId=run-2')) return Promise.resolve(new Response(
          JSON.stringify({ code: 'INCOMPARABLE_RUNS', message: 'Incompatible runs' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ))
        return nativeFetch(input, init)
      }
      choose(before, 'run-1')
      await until(() => release)
      if (root.querySelector('.evolution-track')) throw new Error('Loading reused stale comparison')
      choose(after, 'run-1')
      await until(() => root.querySelector('[role="alert"]')?.textContent.includes('разные'))
      choose(before, 'run-2')
      await until(() => root.querySelector('[role="alert"]')?.textContent.includes('нельзя сравнить'))
      release()
      await sleep(180)
      if (root.querySelector('.evolution-track') || !root.querySelector('[role="alert"]')?.textContent.includes('нельзя сравнить')) {
        throw new Error('Late response replaced the current error')
      }
      window.fetch = nativeFetch
      choose(before, 'run-1')
      await until(() => root.querySelector('[role="alert"]')?.textContent.includes('разные'))
      choose(after, 'run-2')
      await until(() => root.querySelector('.evolution-outcome[data-ci="passed"]'))
      return 'Time Machine: metrics, shared findings, rapid switching, graph links, duplicate pair, 409 and stale responses'
    } finally {
      window.fetch = nativeFetch
    }
  }, '/?view=runs&workflow=wf-1&run=run-2&replay=1')

  await evaluate(4175, async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    async function until(predicate, limit = 5000) {
      const end = performance.now() + limit
      while (performance.now() < end) {
        const value = predicate()
        if (value) return value
        await sleep(25)
      }
      throw new Error('Extended demo timed out: ' + document.querySelector('.long-demo')?.innerText)
    }
    const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(item => item.textContent === text)
    const nativeFetch = window.fetch
    const nativeEvents = window.EventSource
    const requests = []
    const canvas = await until(() => document.querySelector('.react-flow'))
    await until(() => canvas.querySelectorAll('.react-flow__edge').length >= 7)
    const camera = canvas.querySelector('.react-flow__viewport').style.transform
    button('Режим демонстрации').click()
    const entry = await until(() => button('Запустить длинное демо'))
    await until(() => canvas.querySelector('.hologram[data-phase="running"] .hologram-motion'))
    window.fetch = (input, init) => { requests.push(String(input)); return nativeFetch(input, init) }
    window.EventSource = class extends nativeEvents {
      constructor(url, options) { requests.push(String(url)); super(url, options) }
    }
    try {
      entry.click()
      const panel = await until(() => document.querySelector('.long-demo'))
      const node = (id, status) => canvas.querySelector(`[data-id="demo-${id}"] [data-execution="${status}"]`)
      const origin = await until(() => node('start', 'running')?.querySelector('.hologram[data-phase="running"] .hologram-motion'))
      await until(() => canvas.querySelectorAll('.react-flow__node').length === 12 &&
        canvas.querySelectorAll('.react-flow__edge').length === 12)
      if (!panel.textContent.includes('Демо · симуляция выполнения')) throw new Error('Simulation label missing')
      const select = panel.querySelector('.pulse-controls select')
      const speed = value => {
        select.value = String(value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const animation = origin.getAnimations()[0]
      speed(0.5)
      await until(() => animation.currentTime > 50)
      button('Пауза', panel).click()
      await until(() => animation.playState === 'paused' && !animation.pending)
      const frozen = animation.currentTime
      await sleep(150)
      if (frozen !== animation.currentTime) throw new Error('Paused hologram advanced')
      speed(2)
      button('Продолжить', panel).click()
      await until(() => animation.currentTime > frozen)
      await until(() => canvas.querySelector('[data-id="demo-start:next"] .pulse-edge-core'))
      if (node('secrets', 'running')) throw new Error('Destination hologram started before arrival')
      button('Пауза', panel).click()
      const offset = () => canvas.closest('.garden-canvas').style.getPropertyValue('--pulse-offset')
      const held = offset()
      await sleep(150)
      if (offset() !== held) throw new Error('Paused edge advanced')
      const started = performance.now()
      button('Повторить анимацию', panel).click()
      await until(() => node('start', 'running'))
      await until(() => canvas.querySelector('[data-id="demo-gate:yes"] .pulse-edge-core'), 24000)
      if (canvas.querySelector('[data-id="demo-gate:no"] .pulse-edge-core')) throw new Error('YES lit the wrong edge')
      await until(() => node('telegram', 'running'))
      const deliveryPulse = await until(() => canvas.querySelector('[data-id="demo-telegram:next"] .pulse-edge-core'))
      const deliveryEdge = deliveryPulse.closest('.react-flow__edge').querySelector('.react-flow__edge-path')
      if (deliveryPulse.getAttribute('d') !== deliveryEdge.getAttribute('d')) {
        throw new Error('Telegram pulse does not follow the rendered edge')
      }
      await until(() => node('finish', 'running'))
      await until(() => panel.querySelector('[data-ci-status="failed"]'))
      const red = (performance.now() - started) / 1000
      if (red < 20 || !node('finish', 'succeeded')) throw new Error('Red run incomplete')
      button('После исправления', panel).click()
      await until(() => !node('finish', 'succeeded'))
      const greenStarted = performance.now()
      button('Запустить', panel).click()
      await until(() => node('start', 'running')?.querySelector('.hologram-motion'))
      await until(() => canvas.querySelector('[data-id="demo-gate:no"] .pulse-edge-core'), 32000)
      if (!node('telegram', 'skipped') || canvas.querySelector('[data-id="demo-gate:yes"] .pulse-edge-core')) {
        throw new Error('NO did not skip Telegram')
      }
      await until(() => panel.querySelector('[data-ci-status="passed"]'))
      const green = (performance.now() - greenStarted) / 1000
      if (requests.length || document.querySelector('.react-flow') !== canvas) throw new Error('Local demo sent a request or remounted React Flow')
      button('Выход', panel).click()
      await until(() => !document.querySelector('.long-demo') && canvas.querySelector('.react-flow__viewport').style.transform === camera)
      return `Extended simulation: both routes, synchronized controls, zero requests, stable Canvas; measured at 2×: red ${red.toFixed(1)}s, green ${green.toFixed(1)}s`
    } finally {
      window.fetch = nativeFetch
      window.EventSource = nativeEvents
    }
  })

  await evaluate(4176, async () => {
    const { installMocks } = await import('/src/mocks/worker.ts')
    await installMocks()
    if ((await navigator.serviceWorker.getRegistrations()).length) throw new Error('Unexpected worker')
    const api = await fetch('/api/v1/snapshots')
    if (api.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected mock response')
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
    button('Режим демонстрации').click()
    for (let i = 0; i < 80 && !button('Запустить учебную проверку'); i++) await new Promise(resolve => setTimeout(resolve, 25))
    button('Запустить учебную проверку').click()
    for (let i = 0; i < 80 && !document.querySelector('.long-demo'); i++) await new Promise(resolve => setTimeout(resolve, 25))
    const panel = document.querySelector('.long-demo')
    if (!panel?.textContent.includes('Учебные снимки · реальные анализаторы') ||
        panel.querySelector('[data-ci-status]')) throw new Error('Live training presented a simulated result')
    return 'MSW disabled: no worker or mock response, live training opens without a simulated result'
  })
} finally {
  for (const child of children.reverse()) child.kill()
}
