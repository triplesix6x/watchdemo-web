// QA-only deferred-order fixture. Uses the production hook and controls; it is
// not a replacement implementation of either. No production route imports it.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { useAsync } from '../src/lib/useAsync'
import { Button } from '../src/ui'
import '../src/styles/index.css'

const pending: Array<(value: string) => void> = []
function MountedAsync() {
  const state = useAsync(() => new Promise<string>(resolve => pending.push(resolve)), [])
  return <main>
    <h1>Production useAsync deferred order</h1>
    <output data-testid="value">{state.data ?? 'empty'}</output>
    <output data-testid="loading">{String(state.loading)}</output>
    <Button onClick={state.refresh}>Refresh</Button>
    <Button onClick={() => pending.at(-1)?.('new')}>Resolve latest</Button>
    <Button onClick={() => pending.at(-2)?.('old')}>Resolve initial</Button>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><MountedAsync /></BrowserRouter></StrictMode>)
