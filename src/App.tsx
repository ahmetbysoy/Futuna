import { AppProvider } from './app/AppContext'
import { AppShell } from './app/AppShell'
import { AlertMonitor } from './features/alerts/AlertMonitor'
import { DecisionProvider } from './features/signals/DecisionContext'
import { MarketProvider } from './features/market/MarketContext'
import { SessionProvider } from './features/session/SessionContext'

export default function App() {
  return (
    <AppProvider>
      <MarketProvider>
        <DecisionProvider>
          <SessionProvider>
            <AlertMonitor />
            <AppShell />
          </SessionProvider>
        </DecisionProvider>
      </MarketProvider>
    </AppProvider>
  )
}
