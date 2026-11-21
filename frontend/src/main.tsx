import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './editor/editor.css'
import App from './App.tsx'
import { installMocks } from './mocks/worker'

async function startApp() {
  await installMocks()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void startApp().catch(error => {
  console.error('Не удалось запустить приложение. Проверьте настройки MSW.', error)
})
