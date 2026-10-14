import type { Page, Route } from '@playwright/test'

const startTime = Date.UTC(2026, 0, 1)
const klines = Array.from({ length: 240 }, (_, index) => {
  const time = startTime + index * 60_000
  const close = 65_000 + index * 8 + Math.sin(index / 5) * 35
  const open = close - Math.cos(index / 4) * 9
  const high = Math.max(open, close) + 14
  const low = Math.min(open, close) - 14
  const volume = 12 + Math.sin(index / 7) * 2
  return [time, open, high, low, close, volume, time + 59_999, close * volume]
})

const ticker = {
  symbol: 'BTCUSDT',
  lastPrice: '66900.25',
  priceChangePercent: '1.35',
  highPrice: '67200.00',
  lowPrice: '65100.00',
  quoteVolume: '1200000000',
}

async function respond(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(payload),
  })
}

/** Keep browser smoke tests deterministic and independent of Binance uptime. */
export async function mockMarketApi(page: Page) {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3

      readonly url: string
      readyState = MockWebSocket.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null

      constructor(url: string | URL) {
        super()
        this.url = String(url)
        window.addEventListener('mock-orderflow-liquidation', this.handleMockLiquidation)
        window.addEventListener('mock-orderflow-depth-disconnect', this.handleMockDepthDisconnect)
        window.addEventListener('mock-orderflow-depth-gap', this.handleMockDepthGap)
        window.setTimeout(() => this.open(), 0)
      }

      send(_data: string) {}

      close(code = 1000, reason = '') {
        if (this.readyState >= MockWebSocket.CLOSING) return
        this.readyState = MockWebSocket.CLOSED
        window.removeEventListener('mock-orderflow-liquidation', this.handleMockLiquidation)
        window.removeEventListener('mock-orderflow-depth-disconnect', this.handleMockDepthDisconnect)
        window.removeEventListener('mock-orderflow-depth-gap', this.handleMockDepthGap)
        const event = new CloseEvent('close', { code, reason, wasClean: true })
        this.dispatchEvent(event)
        this.onclose?.(event)
      }

      private open() {
        if (this.readyState !== MockWebSocket.CONNECTING) return
        this.readyState = MockWebSocket.OPEN
        const event = new Event('open')
        this.dispatchEvent(event)
        this.onopen?.(event)
        if (this.url.includes('@depth')) {
          window.setTimeout(() => this.emitDepth({
            e: 'depthUpdate', s: 'BTCUSDT', U: 799_999, u: 800_001, pu: 799_998,
            b: [['66900', '1.25']], a: [['66901', '1.2']],
          }), 25)
          window.setTimeout(() => this.emitDepth({
            e: 'depthUpdate', s: 'BTCUSDT', U: 800_002, u: 800_003, pu: 800_001,
            b: [['66899', '0.9']], a: [['66902', '0.75']],
          }), 45)
        }
        if (this.url.includes('@aggTrade')) {
          window.setTimeout(() => this.emitMessage({
            e: 'aggTrade', s: 'BTCUSDT', p: '66900.25', q: '6',
            T: Date.UTC(2026, 0, 1) + 238 * 60_000, m: false,
          }), 55)
        }
      }

      private readonly handleMockLiquidation = () => {
        if (!this.url.includes('@forceOrder') || this.readyState !== MockWebSocket.OPEN) return
        const timestamp = Date.now()
        this.emitMessage({
          e: 'forceOrder', s: 'BTCUSDT', E: timestamp,
          o: { s: 'BTCUSDT', S: 'BUY', o: 'MARKET', f: 'IOC', q: '6', ap: '66900.25', X: 'FILLED', l: '6', z: '6', T: timestamp },
        })
      }

      private readonly handleMockDepthDisconnect = () => {
        if (!this.url.includes('@depth') || this.readyState !== MockWebSocket.OPEN) return
        this.close(4001, 'deterministic depth disconnect')
      }

      private readonly handleMockDepthGap = () => {
        if (!this.url.includes('@depth') || this.readyState !== MockWebSocket.OPEN) return
        this.emitDepth({
          e: 'depthUpdate', s: 'BTCUSDT', U: 800_010, u: 800_011, pu: 800_010,
          b: [['66900', '1.1']], a: [['66901', '1.0']],
        })
        window.setTimeout(() => this.emitDepth({
          e: 'depthUpdate', s: 'BTCUSDT', U: 800_000, u: 800_001, pu: 800_000,
          b: [['66900', '1.25']], a: [['66901', '1.2']],
        }), 50)
      }

      private emitMessage(payload: Record<string, unknown>) {
        if (this.readyState !== MockWebSocket.OPEN) return
        const event = new MessageEvent('message', { data: JSON.stringify(payload) })
        this.dispatchEvent(event)
        this.onmessage?.(event)
      }

      private emitDepth(payload: Record<string, unknown>) {
        if (this.readyState !== MockWebSocket.OPEN) return
        const event = new MessageEvent('message', { data: JSON.stringify(payload) })
        this.dispatchEvent(event)
        this.onmessage?.(event)
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    })
  })

  await page.route('https://fapi.binance.com/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url())

    if (pathname.endsWith('/fapi/v1/exchangeInfo')) {
      await respond(route, {
        symbols: [{
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          status: 'TRADING',
          contractType: 'PERPETUAL',
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }],
        }],
      })
      return
    }
    if (pathname.endsWith('/fapi/v1/klines')) {
      await respond(route, klines.slice(-Number(searchParams.get('limit') ?? 500)))
      return
    }
    if (pathname.endsWith('/fapi/v1/ticker/24hr')) {
      await respond(route, searchParams.has('symbol') ? ticker : [ticker])
      return
    }
    if (pathname.endsWith('/fapi/v1/premiumIndex')) {
      await respond(route, { symbol: 'BTCUSDT', markPrice: '66901.1', lastFundingRate: '0.0001' })
      return
    }
    if (pathname.endsWith('/fapi/v1/openInterest')) {
      await respond(route, { symbol: 'BTCUSDT', openInterest: '18000.5' })
      return
    }
    if (pathname.endsWith('/fapi/v1/depth')) {
      await respond(route, {
        lastUpdateId: 800_000,
        bids: [['66900', '1.2'], ['66899', '0.8'], ['66898', '1.6']],
        asks: [['66901', '1.1'], ['66902', '0.7'], ['66903', '1.4']],
      })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
}
