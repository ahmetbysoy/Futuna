import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readStorage, writeStorage } from '@/lib/storage'
import { useApp } from '@/app/AppContext'
import { orderflowStore } from '@/features/orderflow/orderflowStore'
import { orderflowRuntime } from '@/features/orderflow/orderflowRuntime'
import { useDepthBook, type DepthBookEvent } from './useDepthBook'
import {
  discoverProvider,
  discoverSpotProvider,
  fetchFunding,
  fetchKlines,
  fetchOpenInterest,
  fetchTicker24h,
  fetchAllTickers,
  MarketApiError,
} from './marketApi'
import type {
  Candle,
  ConnectionState,
  FlowEvent,
  FlowSnapshot,
  MarketContextValue,
  MarketMode,
  MarketSymbol,
  QuoteSnapshot,
  Timeframe,
} from './types'

const MarketContext = createContext<MarketContextValue | null>(null)
const EMPTY_QUOTE: QuoteSnapshot = {
  lastPrice: null,
  change24h: null,
  high24h: null,
  low24h: null,
  quoteVolume24h: null,
  markPrice: null,
  fundingRate: null,
  openInterest: null,
  openInterestChange: null,
  updatedAt: null,
}
const EMPTY_FLOW: FlowSnapshot = {
  cvd60: 0,
  buyNotional60: 0,
  sellNotional60: 0,
  liquidationNotional60: null,
  obi: null,
  spread: null,
  bidNotional: null,
  askNotional: null,
  bids: [],
  asks: [],
  events: [],
  lastTradeAt: null,
  depthUpdatedAt: null,
  depthStatus: 'offline',
}

interface TradeSample {
  timestamp: number
  notional: number
  side: 'buy' | 'sell'
  price: number
}

interface LiquidationSample {
  timestamp: number
  notional: number
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Piyasa verisi alınamadı.'
}

function toCandle(kline: Record<string, unknown>): Candle {
  return {
    time: Math.floor(Number(kline.t) / 1000),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
    quoteVolume: Number(kline.q),
  }
}

function wsUrl(mode: MarketMode, symbol: string, timeframe: Timeframe) {
  const pair = symbol.toLowerCase()
  const streams = [ `${pair}@kline_${timeframe}`, `${pair}@aggTrade` ]
  if (mode === 'futures') streams.push(`${pair}@markPrice@1s`, `${pair}@forceOrder`, `${pair}@ticker`)
  else streams.push(`${pair}@miniTicker`)
  const route = mode === 'futures' ? 'market/' : ''
  const host = mode === 'futures' ? 'wss://fstream.binance.com' : 'wss://data-stream.binance.vision'
  return `${host}/${route}stream?streams=${streams.join('/')}`
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const { settings } = useApp()
  const [symbols, setSymbols] = useState<MarketSymbol[]>([])
  const [symbol, setSymbolState] = useState(() => readStorage('fs.symbol.v2', 'BTCUSDT'))
  const [timeframe, setTimeframeState] = useState<Timeframe>(() => readStorage('fs.timeframe.v2', '1m'))
  const [mode, setMode] = useState<MarketMode>('offline')
  const [modeReason, setModeReason] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('starting')
  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [quote, setQuote] = useState<QuoteSnapshot>(EMPTY_QUOTE)
  const [flow, setFlow] = useState<FlowSnapshot>(EMPTY_FLOW)
  const [loadingSymbols, setLoadingSymbols] = useState(true)
  const [loadingCandles, setLoadingCandles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)
  const [discoveryNonce, setDiscoveryNonce] = useState(0)
  const modeRef = useRef<MarketMode>(mode)
  const symbolRef = useRef(symbol)
  const candlesRef = useRef<Candle[]>(candles)
  const tradesRef = useRef<TradeSample[]>([])
  const liquidationsRef = useRef<LiquidationSample[]>([])
  const flowEventsRef = useRef<FlowEvent[]>([])
  const previousOiRef = useRef<number | null>(null)
  const lastUiUpdateRef = useRef(0)
  const lastTradeQuoteAtRef = useRef(0)
  const orderflowGenerationRef = useRef(0)
  const orderflowSessionKey = `${symbol}|${mode}|${timeframe}`
  const orderflowSettings = settings.orderflow
  const whaleMin = orderflowSettings.whaleMinBySymbol[symbol] ?? orderflowSettings.whaleMin

  useEffect(() => {
    orderflowGenerationRef.current = orderflowStore.reset(symbol, mode, timeframe)
  }, [mode, symbol, timeframe])

  useEffect(() => orderflowRuntime.start(), [])

  useEffect(() => {
    orderflowRuntime.setConfig({
      whaleMin,
      whaleAlerts: orderflowSettings.whaleAlerts,
      wallPct: orderflowSettings.wallPct,
      liveWallCount: orderflowSettings.liveWallCount,
      liveWallRange: orderflowSettings.liveWallRange,
      compassHalf: orderflowSettings.compassHalf,
      compassIceTick: orderflowSettings.compassIceTick,
      compassWallTick: orderflowSettings.compassWallTick,
    })
  }, [mode, symbol, whaleMin, orderflowSettings.whaleAlerts, orderflowSettings.wallPct, orderflowSettings.liveWallCount, orderflowSettings.liveWallRange, orderflowSettings.compassHalf, orderflowSettings.compassIceTick, orderflowSettings.compassWallTick])

  useEffect(() => {
    const selected = symbols.find((item) => item.symbol === symbol)
    if (selected) orderflowStore.setTickSize(symbol, orderflowGenerationRef.current, selected.tickSize)
  }, [mode, symbol, symbols, timeframe])

  const onDepthBookEvent = useCallback((event: DepthBookEvent) => {
    const generation = orderflowGenerationRef.current
    if (!orderflowStore.isCurrentSession(orderflowSessionKey)
      || !orderflowStore.isCurrentMarket(symbol, mode, generation)) return

    if (event.type === 'status') {
      orderflowStore.setDepthStatus(symbol, generation, event)
    } else if (event.type === 'snapshot') {
      orderflowStore.ingestDepthSnapshot(symbol, generation, event)
    } else {
      orderflowStore.ingestDepthDiff(symbol, generation, event)
    }
  }, [mode, orderflowSessionKey, symbol])

  const depthBook = useDepthBook(
    symbol,
    mode,
    mode !== 'offline' && symbols.some((item) => item.symbol === symbol),
    onDepthBookEvent,
  )

  modeRef.current = mode
  symbolRef.current = symbol
  candlesRef.current = candles

  const setSymbol = useCallback((nextSymbol: string) => {
    const next = nextSymbol.trim().toUpperCase()
    if (!next) return
    setSymbolState(next)
    writeStorage('fs.symbol.v2', next)
  }, [])

  const setTimeframe = useCallback((nextTimeframe: Timeframe) => {
    setTimeframeState(nextTimeframe)
    writeStorage('fs.timeframe.v2', nextTimeframe)
  }, [])

  const loadKlines = useCallback((nextSymbol: string, nextTimeframe: Timeframe, limit = 500) => {
    const currentMode = modeRef.current
    if (currentMode === 'offline') return Promise.reject(new MarketApiError('Önce piyasa veri kaynağının bağlanması bekleniyor.'))
    return fetchKlines(nextSymbol, nextTimeframe, limit, currentMode)
  }, [])

  const loadTickers = useCallback(() => {
    const currentMode = modeRef.current
    if (currentMode === 'offline') return Promise.reject(new MarketApiError('Piyasa veri kaynağı çevrimdışı.'))
    return fetchAllTickers(currentMode)
  }, [])

  const reconnect = useCallback(() => {
    setConnection('connecting')
    setError(null)
    setDiscoveryNonce((value) => value + 1)
  }, [])

  const refresh = useCallback(() => {
    setError(null)
    setCandles([])
    setLiveCandle(null)
    setDiscoveryNonce((value) => value + 1)
  }, [])

  // Source discovery: use actual USDⓈ-M futures first, then a separately labelled
  // public spot-only mirror if the futures host is unavailable from this network.
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoadingSymbols(true)
    setConnection('connecting')
    discoverProvider(controller.signal)
      .then((result) => {
        if (!active) return
        modeRef.current = result.mode
        setMode(result.mode)
        setModeReason(result.reason)
        setSymbols(result.symbols)
        if (!result.symbols.some((item) => item.symbol === symbolRef.current)) {
          setSymbol('BTCUSDT')
        }
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        modeRef.current = 'offline'
        setMode('offline')
        setConnection('offline')
        setError(messageFrom(requestError))
      })
      .finally(() => { if (active) setLoadingSymbols(false) })
    return () => { active = false; controller.abort() }
  }, [discoveryNonce, setSymbol])

  // Fetch the selected instrument and its initial history. User-selected symbols
  // are always validated against the discovered market universe.
  useEffect(() => {
    if (mode === 'offline' || !symbols.length) return
    if (!symbols.some((item) => item.symbol === symbol)) return
    const controller = new AbortController()
    let active = true
    setLoadingCandles(true)
    setError(null)
    setCandles([])
    setLiveCandle(null)
    tradesRef.current = []
    liquidationsRef.current = []
    flowEventsRef.current = []
    setFlow((current) => ({
      ...current,
      cvd60: 0,
      buyNotional60: 0,
      sellNotional60: 0,
      liquidationNotional60: mode === 'futures' ? 0 : null,
      events: [],
      lastTradeAt: null,
    }))
    previousOiRef.current = null

    Promise.allSettled([
      fetchKlines(symbol, timeframe, 500, mode, controller.signal),
      fetchTicker24h(symbol, mode, controller.signal),
    ]).then(async ([klinesResult, tickerResult]) => {
      if (!active) return
      if (klinesResult.status === 'fulfilled') {
        const history = klinesResult.value
        setCandles(history)
        setLiveCandle(history.at(-1) ?? null)
      } else {
        const rejected = klinesResult.reason
        if (mode === 'futures' && rejected instanceof MarketApiError && rejected.status === 451) {
          try {
            const fallback = await discoverSpotProvider(controller.signal)
            if (!active) return
            modeRef.current = fallback.mode
            setMode(fallback.mode)
            setModeReason(`${rejected.message} ${fallback.reason}`)
            setSymbols(fallback.symbols)
            setError(null)
            return
          } catch (fallbackError) {
            if (active) setError(messageFrom(fallbackError))
          }
        } else {
          setError(messageFrom(rejected))
        }
      }
      if (tickerResult.status === 'fulfilled') {
        setQuote((current) => ({ ...current, ...tickerResult.value }))
      }
    }).finally(() => { if (active) setLoadingCandles(false) })

    return () => { active = false; controller.abort() }
  }, [mode, symbols, symbol, timeframe])

  // Public market stream: candles, aggregate trades and funding/liquidation
  // events. Reconnect with bounded exponential backoff and close cleanly.
  useEffect(() => {
    if (mode === 'offline' || !symbols.some((item) => item.symbol === symbol)) return
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let retry = 0
    let fallbackStarted = false
    const targetSymbol = symbol
    const targetMode = mode
    const generation = orderflowGenerationRef.current

    const isCurrent = () => orderflowStore.isCurrentMarket(targetSymbol, targetMode, generation)

    const connect = () => {
      if (!active || !isCurrent()) return
      setConnection(retry === 0 ? 'connecting' : 'reconnecting')
      try {
        socket = new WebSocket(wsUrl(targetMode, targetSymbol, timeframe))
      } catch {
        scheduleReconnect()
        return
      }
      socket.onopen = () => {
        if (!active || !isCurrent()) return
        retry = 0
        setConnection('live')
        setError(null)
      }
      socket.onmessage = (event) => {
        if (!active || !isCurrent()) return
        let packet: Record<string, unknown>
        try { packet = JSON.parse(String(event.data)) as Record<string, unknown> } catch { return }
        const message = (packet.data && typeof packet.data === 'object' ? packet.data : packet) as Record<string, unknown>
        const eventType = String(message.e ?? '')
        const now = Date.now()
        orderflowStore.ingestWsMessage(targetSymbol, generation, now)
        const previous = lastUiUpdateRef.current
        if (now - previous > 700) {
          lastUiUpdateRef.current = now
          setLastMessageAt(now)
        }

        if (eventType === 'kline' && message.k && typeof message.k === 'object') {
          const candle = toCandle(message.k as Record<string, unknown>)
          setLiveCandle(candle)
          const last = candlesRef.current.at(-1)
          if (last && candle.time > last.time) {
            setCandles((current) => [...current.slice(-999), candle])
          }
          setQuote((current) => ({ ...current, lastPrice: candle.close, updatedAt: now }))
          return
        }

        if (eventType === 'aggTrade') {
          const price = Number(message.p)
          const quantity = Number(message.q)
          if (price > 0 && quantity > 0) {
            const side = message.m ? 'sell' : 'buy'
            const notional = price * quantity
            const exchangeTimestamp = Number(message.T ?? now)
            const timestamp = Number.isFinite(exchangeTimestamp) && exchangeTimestamp > 0 ? exchangeTimestamp : now
            orderflowStore.ingestTrade(targetSymbol, generation, { ts: timestamp, price, notional, side })
            tradesRef.current.push({ timestamp, notional, side, price })
            tradesRef.current = tradesRef.current.filter((trade) => now - trade.timestamp <= 65_000).slice(-3000)
            const largeThreshold = 100_000
            if (notional >= largeThreshold) {
              const item: FlowEvent = {
                id: `${timestamp}-${price}-${quantity}`,
                kind: side,
                symbol: targetSymbol,
                price,
                notional,
                timestamp,
                label: side === 'buy' ? 'Büyük alıcı işlemi' : 'Büyük satıcı işlemi',
              }
              flowEventsRef.current = [item, ...flowEventsRef.current].slice(0, 12)
            }
            if (now - lastTradeQuoteAtRef.current >= 500) {
              lastTradeQuoteAtRef.current = now
              setQuote((current) => ({ ...current, lastPrice: price, updatedAt: now }))
            }
          }
          return
        }

        if (eventType === 'markPriceUpdate') {
          const markPrice = Number(message.p)
          const fundingRate = Number(message.r)
          orderflowStore.ingestMark(
            targetSymbol,
            generation,
            Number.isFinite(markPrice) ? markPrice : null,
            Number.isFinite(fundingRate) ? fundingRate : null,
            now,
          )
          setQuote((current) => ({
            ...current,
            markPrice,
            fundingRate,
            updatedAt: now,
          }))
          return
        }

        if (eventType === 'forceOrder') {
          const order = message.o as Record<string, unknown> | undefined
          const price = Number(order?.ap ?? order?.p ?? 0)
          const quantity = Number(order?.q ?? 0)
          if (price > 0 && quantity > 0) {
            const exchangeTimestamp = Number(order?.T ?? now)
            const timestamp = Number.isFinite(exchangeTimestamp) && exchangeTimestamp > 0 ? exchangeTimestamp : now
            const notional = price * quantity
            const liquidationSide = String(order?.S ?? '').toUpperCase() === 'BUY' ? 'short' : 'long'
            orderflowStore.ingestLiquidation(targetSymbol, generation, {
              ts: timestamp,
              price,
              notional,
              side: liquidationSide,
            })
            liquidationsRef.current.push({ timestamp, notional })
            liquidationsRef.current = liquidationsRef.current.filter((item) => now - item.timestamp <= 65_000).slice(-400)
            const item: FlowEvent = {
              id: `liq-${timestamp}-${price}`,
              kind: 'liquidation',
              symbol: targetSymbol,
              price,
              notional,
              timestamp,
              label: `${String(order?.S ?? '').toUpperCase() === 'BUY' ? 'Short' : 'Long'} tasfiye`,
            }
            flowEventsRef.current = [item, ...flowEventsRef.current].slice(0, 12)
          }
          return
        }

        if (eventType === '24hrTicker' || eventType === '24hrMiniTicker') {
          const lastPrice = Number(message.c)
          const open = Number(message.o)
          const change = open > 0 ? ((lastPrice / open) - 1) * 100 : null
          setQuote((current) => ({
            ...current,
            lastPrice: lastPrice || current.lastPrice,
            change24h: Number.isFinite(change) ? change : current.change24h,
            high24h: Number(message.h) || current.high24h,
            low24h: Number(message.l) || current.low24h,
            quoteVolume24h: Number(message.q) || current.quoteVolume24h,
            updatedAt: now,
          }))
        }
      }
      socket.onerror = () => {
        if (active && isCurrent()) setConnection('reconnecting')
      }
      socket.onclose = () => {
        if (active && isCurrent()) scheduleReconnect()
      }
    }

    const scheduleReconnect = () => {
      if (!active || !isCurrent()) return
      retry += 1
      setConnection('reconnecting')
      if (targetMode === 'futures' && retry >= 3 && !fallbackStarted) {
        fallbackStarted = true
        discoverSpotProvider().then((fallback) => {
          if (!active || !isCurrent()) return
          modeRef.current = fallback.mode
          setMode(fallback.mode)
          setModeReason(`Futures WebSocket bağlantısı kurulamadı. ${fallback.reason}`)
          setSymbols(fallback.symbols)
          setConnection('connecting')
        }).catch(() => {
          if (active) setError('Futures akışı bağlanamadı ve spot yedeği de kullanılamıyor. Yeniden bağlanmayı deneyin.')
        })
        return
      }
      const delay = Math.min(30_000, 750 * (2 ** Math.min(retry - 1, 5)))
      reconnectTimer = window.setTimeout(connect, delay)
    }

    connect()
    return () => {
      active = false
      window.clearTimeout(reconnectTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'symbol or timeframe changed')
    }
  }, [mode, symbol, timeframe, symbols])

  // Low-rate REST snapshots fill funding, open interest and the 24-hour summary.
  // No private account or order endpoints are used.
  useEffect(() => {
    if (mode === 'offline' || !symbols.some((item) => item.symbol === symbol)) return
    let active = true
    const controller = new AbortController()
    const generation = orderflowGenerationRef.current
    const update = async () => {
      const quotePromise = fetchTicker24h(symbol, mode, controller.signal)
      const fundingPromise = mode === 'futures' ? fetchFunding(symbol, controller.signal) : Promise.resolve(null)
      const oiPromise = mode === 'futures' ? fetchOpenInterest(symbol, controller.signal) : Promise.resolve(null)
      const [tickerResult, fundingResult, oiResult] = await Promise.allSettled([
        quotePromise, fundingPromise, oiPromise,
      ])
      if (!active || !orderflowStore.isCurrentMarket(symbol, mode, generation)) return
      const updatedAt = Date.now()
      if (tickerResult.status === 'fulfilled') setQuote((current) => ({ ...current, ...tickerResult.value }))
      if (fundingResult.status === 'fulfilled' && fundingResult.value) {
        orderflowStore.ingestMark(
          symbol,
          generation,
          fundingResult.value.markPrice,
          fundingResult.value.fundingRate,
          updatedAt,
        )
        setQuote((current) => ({ ...current, ...fundingResult.value }))
      }
      if (oiResult.status === 'fulfilled' && oiResult.value != null) {
        const currentOi = oiResult.value
        const previous = previousOiRef.current
        const change = previous && previous > 0 ? ((currentOi / previous) - 1) * 100 : null
        previousOiRef.current = currentOi
        orderflowStore.ingestOpenInterest(symbol, generation, currentOi, change, updatedAt)
        setQuote((current) => ({ ...current, openInterest: currentOi, openInterestChange: change }))
      }
    }
    void update()
    const timer = window.setInterval(() => { void update() }, 20_000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
  }, [mode, symbol, symbols, timeframe, discoveryNonce])

  // The dedicated hook owns REST snapshot seeding, diff sequencing and reconnects.
  useEffect(() => {
    setFlow((current) => ({ ...current, ...depthBook }))
  }, [depthBook])

  // Reduce incoming trade buffers to one accessible snapshot each second instead
  // of re-rendering the complete React tree for every exchange message.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const recentTrades = tradesRef.current.filter((trade) => now - trade.timestamp <= 60_000)
      const buy = recentTrades.reduce((sum, trade) => sum + (trade.side === 'buy' ? trade.notional : 0), 0)
      const sell = recentTrades.reduce((sum, trade) => sum + (trade.side === 'sell' ? trade.notional : 0), 0)
      const recentLiquidations = liquidationsRef.current.filter((item) => now - item.timestamp <= 60_000)
      const liquidationTotal = recentLiquidations.reduce((sum, item) => sum + item.notional, 0)
      setFlow((current) => ({
        ...current,
        cvd60: buy - sell,
        buyNotional60: buy,
        sellNotional60: sell,
        liquidationNotional60: modeRef.current === 'futures' ? liquidationTotal : null,
        events: flowEventsRef.current,
        lastTradeAt: recentTrades.at(-1)?.timestamp ?? current.lastTradeAt,
      }))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const value = useMemo<MarketContextValue>(() => ({
    symbols,
    symbol,
    timeframe,
    mode,
    modeReason,
    connection,
    candles,
    liveCandle,
    quote,
    flow,
    loadingSymbols,
    loadingCandles,
    error,
    lastMessageAt,
    setSymbol,
    setTimeframe,
    refresh,
    reconnect,
    loadKlines,
    loadTickers,
  }), [symbols, symbol, timeframe, mode, modeReason, connection, candles, liveCandle, quote, flow, loadingSymbols, loadingCandles, error, lastMessageAt, setSymbol, setTimeframe, refresh, reconnect, loadKlines, loadTickers])

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export function useMarket() {
  const context = useContext(MarketContext)
  if (!context) throw new Error('useMarket must be used inside MarketProvider')
  return context
}
