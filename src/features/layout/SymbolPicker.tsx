import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MagnifyingGlass, Star } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { useMarket } from '@/features/market/MarketContext'

export function SymbolPicker() {
  const { symbols, symbol, setSymbol, loadingSymbols } = useMarket()
  const { favorites, recentSymbols, addRecent, setActiveView } = useApp()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = 'market-symbol-search'
  const listId = 'market-symbol-options'

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const items = useMemo(() => {
    const needle = query.trim().toUpperCase()
    const matches = symbols.filter((item) => !needle || item.symbol.includes(needle) || item.baseAsset.includes(needle))
    if (!needle) {
      const prioritized = [...favorites, ...recentSymbols]
      const priorityMap = new Map(prioritized.map((value, index) => [value, index]))
      return matches.sort((a, b) => (priorityMap.get(a.symbol) ?? 999) - (priorityMap.get(b.symbol) ?? 999) || a.baseAsset.localeCompare(b.baseAsset)).slice(0, 10)
    }
    return matches.slice(0, 10)
  }, [symbols, query, favorites, recentSymbols])

  const pick = (next: string) => {
    setSymbol(next)
    addRecent(next)
    setQuery('')
    setOpen(false)
    setActiveIndex(0)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, Math.max(items.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      pick(items[activeIndex].symbol)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const closeIfOutside = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !rootRef.current?.contains(nextTarget)) setOpen(false)
  }

  return (
    <div className="symbol-picker" ref={rootRef} onBlur={closeIfOutside}>
      <MagnifyingGlass size={16} aria-hidden="true" className="symbol-picker__icon" />
      <label className="sr-only" htmlFor={inputId}>Sembol ara</label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && items[activeIndex] ? `symbol-option-${items[activeIndex].symbol}` : undefined}
        autoComplete="off"
        placeholder={loadingSymbols ? 'Piyasa yükleniyor…' : symbol}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      <kbd className="symbol-picker__shortcut" aria-hidden="true">/</kbd>
      {open && (
        <div className="symbol-picker__menu" id={listId} role="listbox" aria-label="Piyasa sembolleri">
          <div className="symbol-picker__menu-label">{query ? 'EŞLEŞEN SEMBOLLER' : 'FAVORİLER VE SON KULLANILANLAR'}</div>
          {items.length ? items.map((item, index) => (
            <div
              key={item.symbol}
              id={`symbol-option-${item.symbol}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`symbol-option${index === activeIndex ? ' is-active' : ''}${item.symbol === symbol ? ' is-current' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(item.symbol)}
            >
              <span className="symbol-option__ticker">{item.baseAsset}<small>/USDT</small></span>
              <span className="symbol-option__meta">{item.symbol === symbol ? 'Seçili' : favorites.includes(item.symbol) ? <Star size={13} weight="fill" aria-label="Favori" /> : item.quoteAsset}</span>
            </div>
          )) : <div className="symbol-picker__empty">Sonuç bulunamadı. BTC, ETH veya SOL deneyin.</div>}
          {!query && <button type="button" className="symbol-picker__all" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); setActiveView('favorites') }}>Tüm favorileri aç</button>}
        </div>
      )}
    </div>
  )
}
