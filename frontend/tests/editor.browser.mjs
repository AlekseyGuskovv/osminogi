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

async function evaluate(port, test) {
  const url = 'http://127.0.0.1:' + port
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
  start(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-port=0', '--user-data-dir=' + join(root, 'chrome-v2'), 'about:blank'])
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
      throw new Error('Editor did not reach the expected state')
    }

    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 8)
    await waitFor(() => document.querySelectorAll('.react-flow__edge').length === 7)
    const palette = document.querySelector('[aria-label="Палитра"]')
    assert(palette.querySelectorAll('button').length === 8, 'Eight palette items')
    const condition = document.querySelector('.react-flow__node[data-id="gate"]')
    condition.querySelector('.garden-node').click()
    assert(condition.querySelectorAll('.source').length === 2, 'Two condition outputs')
    const settings = document.querySelector('[aria-label="Настройки блока"]')
    await waitFor(() => settings.textContent.includes('critical'))

    const canvas = document.querySelector('.garden-canvas')
    const rect = condition.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    globalThis.dispatchDrag(JSON.stringify({ x, y }))
    await waitFor(() => Math.abs(condition.getBoundingClientRect().left - rect.left) > 5)
    assert(canvas.contains(condition), 'Dragged condition still on canvas')

    const select = document.querySelector('select')
    assert(select.options.length === 5, 'Snapshot options loaded from API')
    select.value = 'pr-1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const buttons = [...document.querySelectorAll('.garden-actions button')]
    await waitFor(() => !buttons.find(button => button.textContent.includes('Запустить')).disabled)
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('ревизия 2'))
    const { getJson } = await import('/src/api.ts')
    const workflow = await getJson('/workflows/wf-1')
    assert(workflow.nodes.find(node => node.id === 'gate').x !== 430, 'Drag coordinates saved to API')
    buttons.find(button => button.textContent.includes('Запустить')).click()
    await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('в очередь'))

    palette.querySelectorAll('button')[1].click()
    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 9)
    buttons.find(button => button.textContent === 'Сохранить').click()
    await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('графа'))
    assert(document.querySelectorAll('.react-flow__node').length === 9, 'Rejected save retains changes')
    palette.querySelectorAll('button')[1].click()
    await waitFor(() => document.querySelectorAll('.react-flow__node').length === 10)
    assert(document.querySelector('[data-id="secrets-1"]') && document.querySelector('[data-id="secrets-2"]'), 'Duplicate block types receive distinct IDs')
    const edgePath = branch => document.querySelector(`[data-testid="rf__edge-gate:${branch}"] path.react-flow__edge-path`)?.getAttribute('d')
    const yesPath = edgePath('yes')
    const noPath = edgePath('no')
    assert(yesPath && noPath, 'Existing branch paths')
    condition.querySelector('[data-handleid="yes"]').click()
    document.querySelector('.react-flow__node[data-id="end"] .target').click()
    await waitFor(() => edgePath('yes') && edgePath('yes') !== yesPath)
    assert(edgePath('no') === noPath, 'Changing yes leaves no unchanged')
    return 'Editor: graph, palette, selection, drag, branch connections, API save/run and error recovery passed'
  })

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
