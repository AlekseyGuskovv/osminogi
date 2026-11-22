import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './editor/editor.css'
import './security-replay/replay.css'
import './theme.css'
import './ui/icons.css'
import './ui/prism-interactions.css'
import { PrismIntro } from './ui/Theme'
import App from './App.tsx'
import { installMocks } from './mocks/worker'

async function startApp() {
  await installMocks()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <PrismIntro />
    </StrictMode>,
  )
}

void startApp().catch(error => {
  console.error('Не удалось запустить приложение. Проверьте настройки MSW.', error)
})
