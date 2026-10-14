import { useEffect, useState } from 'react'
import { fetchDepthSnapshot, summarizeDepth } from './marketApi'
import type { DepthSnapshot } from './marketApi'
import type { DepthLevel, DepthSyncStatus, MarketMode } from './types'

interface DepthUpdate {
  U: number
  u: number
  pu?: number
  b: [number, number][]
  a: [number, number][]
}

export type DepthBookEvent =
  | { type: 'status'; status: DepthSyncStatus; updatedAt: number | null; clearBook?: boolean }
  | {
      type: 'snapshot'
      bids: ReadonlyMap<number, number>
      asks: ReadonlyMap<number, number>
      lastUpdateId: number
      status: 'syncing' | 'live'
      updatedAt: number
    }
  | {
      type: 'diff'
      bids: readonly [number, number][]
      asks: readonly [number, number][]
      lastUpdateId: number
      updatedAt: number
    }

export interface DepthBookState {
  bids: DepthLevel[]
  asks: DepthLevel[]
  bidNotional: number | null
  askNotional: number | null
  obi: number | null
  spread: number | null
  depthUpdatedAt: number | null
  depthStatus: DepthSyncStatus
}

const EMPTY_DEPTH: DepthBookState = {
  bids: [],
  asks: [],
  bidNotional: null,
  askNotional: null,
  obi: null,
  spread: null,
  depthUpdatedAt: null,
  depthStatus: 'offline',
}

function depthWsUrl(mode: Exclude<MarketMode, 'offline'>, symbol: string) {
  const pair = symbol.toLowerCase()
  const base = mode === 'futures' ? 'wss://fstream.binance.com/public' : 'wss://data-stream.binance.vision'
  return `${base}/ws/${pair}@depth@100ms`
}

/** Maintain a Binance local order book using a REST seed and sequence-checked
 * diff-depth events. A REST-only view remains available while the stream syncs.
 * The optional callback receives full numeric-key depth without changing the
 * existing throttled top-20 React publication used by the Order Book panel. */
export function useDepthBook(
  symbol: string,
  mode: MarketMode,
  enabled: boolean,
  onBookEvent?: (event: DepthBookEvent) => void,
): DepthBookState {
  const [depth, setDepth] = useState<DepthBookState>(EMPTY_DEPTH)

  useEffect(() => {
    if (!enabled || mode === 'offline') {
      setDepth({ ...EMPTY_DEPTH, depthStatus: 'offline' })
      onBookEvent?.({ type: 'status', status: 'offline', updatedAt: null, clearBook: true })
      return
    }

    const isFutures = mode === 'futures'
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let fallbackTimer = 0
    let snapshotRetryTimer = 0
    let publishTimer = 0
    let retry = 0
    let snapshotLoading = false
    let synced = false
    let connectionGeneration = 0
    let snapshotRequestId = 0
    let fallbackRequestId = 0
    let snapshotBaseId: number | null = null
    let lastUpdateId = 0
    let pending: DepthUpdate[] = []
    let bids = new Map<number, number>()
    let asks = new Map<number, number>()
    const controller = new AbortController()
    const maxBufferedUpdates = 2_500

    const notifyStatus = (status: DepthSyncStatus, updatedAt: number | null = null, clearBook = false) => {
      if (active) onBookEvent?.({ type: 'status', status, updatedAt, clearBook })
    }

    const notifySnapshot = (status: 'syncing' | 'live', updatedAt: number) => {
      if (!active) return
      onBookEvent?.({
        type: 'snapshot',
        bids: new Map(bids),
        asks: new Map(asks),
        lastUpdateId,
        status,
        updatedAt,
      })
    }

    setDepth({ ...EMPTY_DEPTH, depthStatus: 'connecting' })
    notifyStatus('connecting', null, true)

    const levelsFor = (side: Map<number, number>, descending: boolean): DepthLevel[] =>
      Array.from(side, ([price, quantity]) => ({ price, quantity, notional: price * quantity }))
        .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.quantity > 0)
        .sort((left, right) => descending ? right.price - left.price : left.price - right.price)

    const commitDepth = (status: DepthSyncStatus) => {
      if (!active) return
      const snapshot: DepthSnapshot = {
        lastUpdateId,
        bids: levelsFor(bids, true),
        asks: levelsFor(asks, false),
        updatedAt: Date.now(),
      }
      const summary = summarizeDepth(snapshot)
      setDepth({
        bids: summary.bids,
        asks: summary.asks,
        bidNotional: summary.bidNotional,
        askNotional: summary.askNotional,
        obi: summary.obi,
        spread: summary.spread,
        depthUpdatedAt: snapshot.updatedAt,
        depthStatus: status,
      })
    }

    const scheduleDepthPublish = () => {
      if (!active || publishTimer) return
      publishTimer = window.setTimeout(() => {
        publishTimer = 0
        commitDepth(synced ? 'live' : 'syncing')
      }, 400)
    }

    const applySide = (book: Map<number, number>, updates: [number, number][]) => {
      for (const [price, quantity] of updates) {
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue
        if (quantity === 0) book.delete(price)
        else book.set(price, quantity)
      }
      if (book.size > 1_500) {
        const descending = book === bids
        const keep = levelsFor(book, descending).slice(0, 1_000)
        book.clear()
        for (const level of keep) book.set(level.price, level.quantity)
      }
    }

    const clearVisibleBook = (status: DepthSyncStatus = 'syncing') => {
      bids = new Map()
      asks = new Map()
      lastUpdateId = 0
      if (publishTimer) window.clearTimeout(publishTimer)
      publishTimer = 0
      setDepth({ ...EMPTY_DEPTH, depthStatus: status })
      notifyStatus(status, null, true)
    }

    const refreshRestFallback = async (expectedConnection = connectionGeneration) => {
      if (!active || synced || expectedConnection !== connectionGeneration) return
      const requestId = ++fallbackRequestId
      const expectedSnapshotRequest = snapshotRequestId
      try {
        const snapshot = await fetchDepthSnapshot(symbol, mode, controller.signal, 20)
        if (!active || synced || expectedConnection !== connectionGeneration
          || requestId !== fallbackRequestId || expectedSnapshotRequest !== snapshotRequestId) return
        const summary = summarizeDepth(snapshot)
        setDepth({
          bids: summary.bids,
          asks: summary.asks,
          bidNotional: summary.bidNotional,
          askNotional: summary.askNotional,
          obi: summary.obi,
          spread: summary.spread,
          depthUpdatedAt: snapshot.updatedAt,
          depthStatus: 'rest-fallback',
        })
        notifyStatus('rest-fallback', snapshot.updatedAt, true)
      } catch {
        if (active && !synced && expectedConnection === connectionGeneration
          && requestId === fallbackRequestId && expectedSnapshotRequest === snapshotRequestId) {
          setDepth((current) => ({ ...current, depthStatus: 'unavailable' }))
          notifyStatus('unavailable', Date.now(), true)
        }
      }
    }

    let loadSnapshot: (expectedConnection: number) => Promise<void>
    const requestResnapshot = () => {
      if (!active || snapshotLoading) return
      synced = false
      snapshotBaseId = null
      pending = []
      if (snapshotRetryTimer) window.clearTimeout(snapshotRetryTimer)
      snapshotRetryTimer = 0
      clearVisibleBook()
      void loadSnapshot(connectionGeneration)
    }

    const processPending = () => {
      if (!active || snapshotLoading || synced || snapshotBaseId == null || pending.length === 0) return
      const baseId = snapshotBaseId
      pending = pending.filter((update) => update.u >= baseId)
      const firstIndex = pending.findIndex((update) => isFutures
        ? update.U <= baseId && update.u >= baseId
        : update.U <= baseId + 1 && update.u >= baseId + 1)

      if (firstIndex < 0) {
        const threshold = isFutures ? baseId : baseId + 1
        if (pending.some((update) => update.U > threshold)) requestResnapshot()
        return
      }

      const buffered = pending.slice(firstIndex)
      pending = []
      let cursor = baseId
      let hasGap = false

      for (let index = 0; index < buffered.length; index += 1) {
        const update = buffered[index]
        if (update.u <= cursor) continue

        if (isFutures) {
          if (index > 0 && update.pu !== cursor) {
            hasGap = true
            break
          }
        } else if (update.U > cursor + 1 || update.u < cursor + 1) {
          hasGap = true
          break
        }

        applySide(bids, update.b)
        applySide(asks, update.a)
        cursor = update.u
      }

      if (hasGap) {
        requestResnapshot()
        return
      }

      lastUpdateId = cursor
      snapshotBaseId = null
      synced = true
      const updatedAt = Date.now()
      notifySnapshot('live', updatedAt)
      commitDepth('live')
    }

    loadSnapshot = async (expectedConnection) => {
      if (!active || snapshotLoading || expectedConnection !== connectionGeneration || socket?.readyState !== WebSocket.OPEN) return
      snapshotLoading = true
      const requestId = ++snapshotRequestId
      fallbackRequestId += 1
      synced = false
      snapshotBaseId = null
      setDepth((current) => ({ ...current, depthStatus: 'syncing' }))
      notifyStatus('syncing')
      try {
        const snapshot = await fetchDepthSnapshot(symbol, mode, controller.signal, 1_000)
        if (!active || expectedConnection !== connectionGeneration || requestId !== snapshotRequestId
          || socket?.readyState !== WebSocket.OPEN) return
        bids = new Map(snapshot.bids.filter((level) => level.quantity > 0).map((level) => [level.price, level.quantity]))
        asks = new Map(snapshot.asks.filter((level) => level.quantity > 0).map((level) => [level.price, level.quantity]))
        lastUpdateId = snapshot.lastUpdateId
        snapshotBaseId = snapshot.lastUpdateId
        notifySnapshot('syncing', snapshot.updatedAt)
        commitDepth('syncing')
      } catch {
        if (active && expectedConnection === connectionGeneration && requestId === snapshotRequestId) {
          void refreshRestFallback(expectedConnection)
          if (socket?.readyState === WebSocket.OPEN) {
            if (snapshotRetryTimer) window.clearTimeout(snapshotRetryTimer)
            snapshotRetryTimer = window.setTimeout(() => {
              snapshotRetryTimer = 0
              void loadSnapshot(expectedConnection)
            }, 5_000)
          }
        }
      } finally {
        if (requestId === snapshotRequestId) {
          snapshotLoading = false
          if (active && expectedConnection === connectionGeneration) processPending()
        }
      }
    }

    const parseDepthUpdate = (data: string): DepthUpdate | null => {
      try {
        const wire = JSON.parse(data) as Record<string, unknown>
        const U = Number(wire.U)
        const u = Number(wire.u)
        const pu = wire.pu == null ? undefined : Number(wire.pu)
        const toRows = (value: unknown): [number, number][] | null => {
          if (!Array.isArray(value)) return null
          const rows: [number, number][] = []
          for (const row of value) {
            if (!Array.isArray(row) || row.length < 2) return null
            rows.push([Number(row[0]), Number(row[1])])
          }
          return rows
        }
        const nextBids = toRows(wire.b)
        const nextAsks = toRows(wire.a)
        if (!Number.isFinite(U) || !Number.isFinite(u) || !nextBids || !nextAsks) return null
        return { U, u, pu, b: nextBids, a: nextAsks }
      } catch {
        return null
      }
    }

    const handleDepthUpdate = (update: DepthUpdate) => {
      if (!synced) {
        pending.push(update)
        if (pending.length > maxBufferedUpdates) pending.splice(0, pending.length - maxBufferedUpdates)
        processPending()
        return
      }

      if (update.u <= lastUpdateId) return
      const sequenceContinues = isFutures
        ? update.pu === lastUpdateId
        : update.U <= lastUpdateId + 1 && update.u >= lastUpdateId + 1
      if (!sequenceContinues) {
        requestResnapshot()
        return
      }

      applySide(bids, update.b)
      applySide(asks, update.a)
      lastUpdateId = update.u
      const updatedAt = Date.now()
      onBookEvent?.({
        type: 'diff',
        bids: update.b,
        asks: update.a,
        lastUpdateId,
        updatedAt,
      })
      scheduleDepthPublish()
    }

    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return
      retry += 1
      const delay = Math.min(30_000, 750 * (2 ** Math.min(retry - 1, 5)))
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connect()
      }, delay)
    }

    const connect = () => {
      if (!active) return
      const currentConnection = ++connectionGeneration
      snapshotRequestId += 1
      fallbackRequestId += 1
      snapshotLoading = false
      synced = false
      snapshotBaseId = null
      pending = []
      clearVisibleBook('connecting')

      let currentSocket: WebSocket
      try {
        currentSocket = new WebSocket(depthWsUrl(mode, symbol))
        socket = currentSocket
      } catch {
        socket = null
        void refreshRestFallback(currentConnection)
        scheduleReconnect()
        return
      }

      const isCurrentSocket = () => active && connectionGeneration === currentConnection && socket === currentSocket
      currentSocket.onopen = () => {
        if (!isCurrentSocket()) return
        retry = 0
        pending = []
        setDepth((current) => ({ ...current, depthStatus: 'syncing' }))
        notifyStatus('syncing')
        if (snapshotRetryTimer) window.clearTimeout(snapshotRetryTimer)
        snapshotRetryTimer = 0
        void loadSnapshot(currentConnection)
      }
      currentSocket.onmessage = (event) => {
        if (!isCurrentSocket() || typeof event.data !== 'string') return
        const update = parseDepthUpdate(event.data)
        if (update) handleDepthUpdate(update)
      }
      currentSocket.onerror = () => {
        if (isCurrentSocket()) currentSocket.close()
      }
      currentSocket.onclose = () => {
        if (!isCurrentSocket()) return
        connectionGeneration += 1
        snapshotRequestId += 1
        fallbackRequestId += 1
        snapshotLoading = false
        socket = null
        synced = false
        snapshotBaseId = null
        pending = []
        if (snapshotRetryTimer) window.clearTimeout(snapshotRetryTimer)
        snapshotRetryTimer = 0
        clearVisibleBook('connecting')
        void refreshRestFallback(connectionGeneration)
        scheduleReconnect()
      }
    }

    fallbackTimer = window.setInterval(() => {
      if (!synced) void refreshRestFallback()
    }, 20_000)

    connect()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(snapshotRetryTimer)
      window.clearTimeout(publishTimer)
      window.clearInterval(fallbackTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'symbol or market mode changed')
    }
  }, [enabled, mode, symbol, onBookEvent])

  return depth
}
