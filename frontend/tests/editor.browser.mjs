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
    await call('Runtime.addBinding', { name: 'dispatchDrag' })
    socket.addEventListener('message', async message => {
      const event = JSON.parse(message.data)
      if (event.method !== 'Runtime.bindingCalled' || event.params.name !== 'dispatchDrag') return
      const { x, y } = JSON.parse(event.params.payload)
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
    await waitFor(() => settings.querySelector('input')?.value === 'team-demo')

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
    const { postJson } = await import('/src/api.ts')
    const addAndSelect = () => palette.querySelectorAll('button')[1].click()
    addAndSelect()
    await waitFor(() => document.querySelector('[data-id="secrets-1"] .source'))
    const clickHandle = async selector => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      document.querySelector(selector).click()
    }
    await clickHandle('[data-id="start"] .source')
    await clickHandle('[data-id="secrets-1"] .target')
    await clickHandle('[data-id="secrets-1"] .source')
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
    const edgePath = branch => document.querySelector(`[data-testid="rf__edge-gate:${branch}"] path.react-flow__edge-path`)?.getAttribute('d')
    await waitFor(() => edgePath("yes") && edgePath("no"))
    const yesPath = edgePath('yes')
    const noPath = edgePath('no')
    assert(yesPath && noPath, 'Existing branch paths')
    await clickHandle('[data-id="gate"] [data-handleid="yes"]')
    await clickHandle('.react-flow__node[data-id="end"] .target')
    await waitFor(() => edgePath('yes') && edgePath('yes') !== yesPath)
    assert(edgePath('no') === noPath, 'Changing yes leaves no unchanged')
    condition.querySelector('.garden-node').click()
    await waitFor(() => settings.querySelector('button'))
    settings.querySelector('button').click()
    await waitFor(() => !document.querySelector('.react-flow__node[data-id="gate"]'))
    assert(!edgePath('yes') && !edgePath('no'), 'Deleted block has no outgoing edges')
    assert(document.querySelectorAll('.react-flow__edge').length === 5, 'Incoming edge removed; unrelated edges preserved')
    return 'Editor: graph, palette, selection, drag, branch connections, settings, deletion, API save/run and error recovery passed'
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
    document.querySelector('.garden-actions button').click()
    for (let attempt = 0; attempt < 80; attempt++) {
      const id = new URL(location.href).searchParams.get('workflow')
      if (id === 'wf-2') return 'Create: submitted a draft and opened its persisted record'
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Created workflow was not opened')
  }, '/?workflow=new')

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
