import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initDesktopAuth } from './api'

async function boot(): Promise<void> {
  await initDesktopAuth()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider delay={200}>
        <App />
      </TooltipProvider>
    </StrictMode>,
  )
}

void boot()
