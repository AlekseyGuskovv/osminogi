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

async function evaluate(port, test, path = "/") {
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
        const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 20000)
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
    socket.addEventListener('message', async message => {
      const event = JSON.parse(message.data)
      if (event.method !== 'Runtime.bindingCalled') return
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
  for (const [port, enabled] of [[4175, 'true'], [4176, 'false']]) {
    start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { ...process.env, VITE_USE_MOCKS: enabled, VITE_API_BASE: '/api/v1/' })
    await until(async () => (await fetch('http://127.0.0.1:' + port + '/')).ok)
  }
  start(chrome, ['--headless', '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-port=0', '--user-data-dir=' + join(root, 'chrome-v2'), 'about:blank'])
  debug = await until(async () => (await readFile(join(root, 'chrome-v2', 'DevToolsActivePort'), 'utf8')).split('\n')[0])

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
    assert(palette.querySelectorAll('button').length === 8, 'Eight palette items')
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

    const canvas = document.querySelector('.garden-canvas')
    const rect = condition.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    assert(condition.contains(document.elementFromPoint(x, y)), 'Drag starts on visible node')
    globalThis.dispatchDrag(JSON.stringify({ x, y }))
    await waitFor(() => Math.abs(condition.getBoundingClientRect().left - rect.left) > 5)
    await waitFor(() => globalThis.dragComplete)
    assert(canvas.contains(condition), 'Dragged condition still on canvas')

    const select = document.querySelector('.garden-actions select')
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
    assert(gate.settings.value === 'high', 'Condition form updates saved threshold')
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
    assert(document.querySelector('[data-id="secret"] [data-node-status="succeeded"]'), 'Secret status updated on the graph')
    document.querySelector('[data-id="secret"] .garden-node').click()
    await waitFor(() => settings.querySelector('pre')?.textContent.includes('F-key'))
    assert(document.querySelector('[data-id="gate"] [data-node-status="succeeded"]'), 'Other nodes retain their status')
    const { postJson } = await import('/src/api.ts')
    const addAndSelect = () => palette.querySelectorAll('button')[1].click()
    addAndSelect()
    await waitFor(() => document.querySelector('[data-id="secrets-1"] .source'))
    const clickHandle = async selector => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const handle = document.querySelector(selector)
      const rect = handle.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      assert(document.elementFromPoint(x, y) === handle, 'Handle must be visible: ' + selector)
      globalThis.clickComplete = false
      globalThis.dispatchClick(JSON.stringify({ x, y }))
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

    palette.querySelectorAll('button')[1].click()
    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 10)
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('актуальную ревизию'))
    assert(document.querySelectorAll('.react-flow__node').length === 10, 'Rejected save retains changes')
    palette.querySelectorAll('button')[1].click()
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
    await check(() => settings.querySelector('button'), 'Delete action')
    settings.querySelector('button').click()
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
      saved.nodes.find(node => node.id === 'gate')?.settings.value !== 'high') {
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
    const form = await waitFor(() => document.querySelector('.garden-template-form'))
    if (!document.querySelector('.garden-results').textContent.includes('пока нет шаблонов')) throw new Error('Missing empty catalog state')
    const input = form.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Проверка PR')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => !form.querySelector('button').disabled)
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
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Найди секреты и объясни риски')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => !button('Сгенерировать черновик')?.disabled)
    document.querySelector('.garden-draft-form').requestSubmit()
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
    if (saved.nodes.find(node => node.id === 'gate').settings.value !== 'high') throw new Error('Draft edits lost on save')
    button('▷ Запустить').click()
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
    await waitFor(() => document.querySelector('.garden-notice[role="status"]')?.textContent.includes('Сохранено'))
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

  await evaluate(4176, async () => {
    const { installMocks } = await import('/src/mocks/worker.ts')
    await installMocks()
    if ((await navigator.serviceWorker.getRegistrations()).length) throw new Error('Unexpected worker')
    const api = await fetch('/api/v1/snapshots')
    if (api.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected mock response')
    return 'MSW disabled: no worker or mock response'
  })
} finally {
  for (const child of children.reverse()) child.kill()
}
