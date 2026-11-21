let installation: Promise<void> | undefined

export async function installMocks(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== 'true') {
    return
  }

  installation ??= startWorker().catch(error => {
    installation = undefined
    throw error
  })
  await installation
}

async function startWorker(): Promise<void> {
  const [{ setupWorker }, { handlers }] = await Promise.all([
    import('msw/browser'),
    import('./handlers'),
  ])
  const worker = setupWorker(...handlers)
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
  })
}
