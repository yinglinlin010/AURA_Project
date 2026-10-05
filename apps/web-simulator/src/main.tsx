import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PactDemo from './PactDemo.tsx'
import PremiumJourneyDemo from './PremiumJourneyDemo.tsx'

const inspector = new URLSearchParams(window.location.search).get('debug') === 'premium-journey' || new URLSearchParams(window.location.search).get('demo') === 'premium-journey';
const pact = new URLSearchParams(window.location.search).get('demo') === 'pact'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {inspector ? <PremiumJourneyDemo /> : pact ? <PactDemo /> : <App />}
  </StrictMode>,
)
