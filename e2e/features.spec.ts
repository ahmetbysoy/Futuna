import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockMarketApi } from './market-fixtures'

async function openSettings(page: Page) {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Ana gezinme' })
  await navigation.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await mockMarketApi(page)
})

test('connection state is labeled and alert preferences are interactive', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Canlı terminal' })).toBeVisible()
  await expect(page.locator('.topbar__status .connection-badge')).toHaveText('Canlı')

  await openSettings(page)
  await page.locator('summary').filter({ hasText: 'Ses ve bildirimler' }).click()
  const alertsEnabled = page.getByLabel('Sesli uyarılar')
  await expect(alertsEnabled).not.toBeChecked()
  await alertsEnabled.check()
  await expect(alertsEnabled).toBeChecked()
})

test('orderflow high-flow events use local alert preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fs.settings.v2', JSON.stringify({
      alertsEnabled: true,
      alertOnHighFlow: true,
      alertVolume: 0,
      notificationsEnabled: true,
      vibrationEnabled: false,
    }))
    const target = window as Window & { __alertNotifications?: string[] }
    target.__alertNotifications = []
    class NotificationStub {
      static permission = 'granted'
      onclick: ((event: Event) => void) | null = null
      constructor(title: string, options?: NotificationOptions) {
        target.__alertNotifications?.push(`${title} · ${options?.body ?? ''}`)
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: NotificationStub })
  })
  await page.goto('/')
  await expect(page.locator('.topbar__status .connection-badge')).toHaveText('Canlı')
  await expect(page.locator('.depth-status--live')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('mock-orderflow-liquidation')))
  await expect(page.locator('.flow-mini-event').filter({ hasText: 'Tasfiye' }).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __alertNotifications?: string[] }
    return target.__alertNotifications?.some((message) => message.includes('Tasfiye')) ?? false
  })).toBe(true)
})

test('depth reconnect ignores a REST snapshot left over from the previous socket', async ({ page }) => {
  let releaseSnapshot = () => {}
  const firstSnapshot = new Promise<void>((resolve) => { releaseSnapshot = resolve })
  let snapshotRequests = 0
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/depth(?:\?.*)?$/, async (route) => {
    snapshotRequests += 1
    if (snapshotRequests === 1) await firstSnapshot
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lastUpdateId: 800_000,
        bids: [['66900', '1.2'], ['66899', '0.8'], ['66898', '1.6']],
        asks: [['66901', '1.1'], ['66902', '0.7'], ['66903', '1.4']],
      }),
    })
  })

  await page.goto('/')
  await expect(page.locator('.topbar__status .connection-badge')).toHaveText('Canlı')
  const depthStatus = page.locator('.orderbook-updated')
  await expect(depthStatus).toHaveClass(/depth-status--syncing/)
  await page.evaluate(() => window.dispatchEvent(new Event('mock-orderflow-depth-disconnect')))
  await expect(depthStatus).toHaveClass(/depth-status--rest-fallback/)
  releaseSnapshot()
  await page.waitForTimeout(150)
  await expect(depthStatus).toHaveClass(/depth-status--rest-fallback/)
  await expect(depthStatus).toHaveClass(/depth-status--live/)
})

test('depth sequence gaps trigger a new REST seed before the book is live again', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.depth-status--live')).toBeVisible()
  const snapshotRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/fapi/v1/depth'))
  await page.evaluate(() => window.dispatchEvent(new Event('mock-orderflow-depth-gap')))
  await snapshotRequest
  await expect(page.locator('.orderbook-updated.depth-status--live')).toBeVisible()
})

test('spot fallback stays labeled and never fabricates liquidation flow', async ({ page }) => {
  await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo', async (route) => {
    await route.fulfill({ status: 451, contentType: 'application/json', body: '{}' })
  })
  await page.route('https://data-api.binance.vision/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('/api/v3/exchangeInfo')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ symbols: [{
          symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true,
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }],
        }] }),
      })
      return
    }
    if (pathname.endsWith('/api/v3/klines')) {
      const time = Date.UTC(2026, 0, 1)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([[time, '66900', '66920', '66880', '66910', '12', time + 59_999, '802920']]),
      })
      return
    }
    if (pathname.endsWith('/api/v3/ticker/24hr')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ symbol: 'BTCUSDT', lastPrice: '66900.25', priceChangePercent: '1.35', highPrice: '67200', lowPrice: '65100', quoteVolume: '1200000000' }),
      })
      return
    }
    if (pathname.endsWith('/api/v3/depth')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lastUpdateId: 800_000,
          bids: [['66900', '1.2'], ['66899', '0.8'], ['66898', '1.6']],
          asks: [['66901', '1.1'], ['66902', '0.7'], ['66903', '1.4']],
        }),
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/')
  await expect(page.locator('.topbar__status').getByText('Spot yedeği', { exact: true })).toBeVisible()
  await expect(page.locator('.depth-status--live')).toBeVisible()
  await expect(page.getByText(/Spot akışında yalnızca spot trade ve derinlik olayları gösterilir/)).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('mock-orderflow-liquidation')))
  await expect(page.locator('.flow-mini-event').filter({ hasText: 'Tasfiye' })).toHaveCount(0)
})

test('offline state is explicit when neither public market source is available', async ({ page }) => {
  await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })
  await page.route('https://data-api.binance.vision/**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/')
  await expect(page.locator('.topbar__status .connection-badge')).toHaveText('Çevrimdışı')
  await expect(page.locator('.orderbook-updated.depth-status--offline')).toBeVisible()
  await expect(page.locator('.flow-mini-card').getByText('Çevrimdışı', { exact: true })).toBeVisible()
})

test('orderflow presets and symbol thresholds persist locally', async ({ page }) => {
  await openSettings(page)
  const settingsSearch = page.getByLabel('Ayar ara')
  await settingsSearch.fill('emir akışı')
  await expect(page.locator('.settings-section')).toHaveCount(1)
  await expect(page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' })).toBeVisible()
  await settingsSearch.fill('')
  await page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' }).locator('summary').click()
  const scalpingPreset = page.getByRole('button', { name: 'Scalping', exact: true })
  await scalpingPreset.click()
  await expect(scalpingPreset).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('DOM konumu')).toHaveValue('both')
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fs.settings.v2') ?? '{}')
    return settings.orderflow?.presetId
  })).toBe('scalping')

  await page.reload()
  await openSettings(page)
  await page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' }).locator('summary').click()
  await expect(page.getByRole('button', { name: 'Scalping', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('DOM konumu')).toHaveValue('both')

  const symbolThreshold = page.getByLabel('BTCUSDT taban eşiği')
  await symbolThreshold.fill('500000')
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fs.settings.v2') ?? '{}')
    return settings.orderflow?.whaleMinBySymbol?.BTCUSDT
  })).toBe(500_000)
  await page.reload()
  await openSettings(page)
  await page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' }).locator('summary').click()
  await expect(page.getByLabel('BTCUSDT taban eşiği')).toHaveValue('500000')
  await page.getByRole('button', { name: 'Sembol eşiğini kaldır' }).click()
  await expect(page.getByLabel('BTCUSDT taban eşiği')).toHaveValue('300000')
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fs.settings.v2') ?? '{}')
    return settings.orderflow?.whaleMinBySymbol?.BTCUSDT
  })).toBeUndefined()
  await page.reload()
  await openSettings(page)
  await page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' }).locator('summary').click()
  await expect(page.getByLabel('BTCUSDT taban eşiği')).toHaveValue('300000')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Varsayılanlara dön' }).click()
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fs.settings.v2') ?? '{}')
    return settings.orderflow?.presetId
  })).toBe('balanced')
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fs.settings.v2') ?? '{}')
    return settings.orderflow?.whaleMinBySymbol?.BTCUSDT
  })).toBeUndefined()
})

test('session recorder starts, stops, and exports JSON', async ({ page }) => {
  await page.clock.install()
  await openSettings(page)
  await page.getByLabel('İndirme biçimi').selectOption('json')
  const startButton = page.getByRole('button', { name: 'Kaydı başlat' })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await expect(page.getByText('Kaydediliyor', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('mock-orderflow-liquidation')))
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fs.session-recorder.v1') ?? '{}')
    return saved.active?.events?.some((event: { type: string }) => event.type === 'ORDERFLOW_LIQUIDATION') ?? false
  })).toBe(true)
  await page.reload()
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible()
  await expect(page.getByText('Kaydediliyor', { exact: true })).toBeVisible()
  await page.getByLabel('İndirme biçimi').selectOption('json')
  await page.clock.fastForward(10_000)
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fs.session-recorder.v1') ?? '{}')
    return saved.active?.events?.filter((event: { type: string }) => event.type === 'ORDERFLOW_OUTCOME')
      .map((event: { data?: { windowSeconds?: number } }) => event.data?.windowSeconds) ?? []
  })).toContain(10)

  await page.getByRole('button', { name: 'Kaydı durdur' }).click()
  await expect(page.getByText('Son kayıt', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'İndir', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const report = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
    session: { events: Array<{ type: string; data?: { windowSeconds?: number; status?: string } }> }
  }
  expect(report.session.events.map((event) => event.type)).toContain('ORDERFLOW_LIQUIDATION')
  const outcomes = report.session.events.filter((event) => event.type === 'ORDERFLOW_OUTCOME')
  expect(outcomes.map((event) => event.data?.windowSeconds)).toEqual([10, 30, 60])
  expect(outcomes.map((event) => event.data?.status)).toEqual(['complete', 'session-ended', 'session-ended'])
})

test('order-flow chart layers survive theme changes and narrow resizes', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  await expect(page.locator('.orderflow-decision-strip')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scalping pusulası' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'FlowMini' })).toBeVisible()
  await expect(page.locator('.flow-mini-event').first()).toContainText('Büyük işlem')
  const chart = page.locator('.chart-visual')
  await expect(chart).toBeVisible()
  await expect(page.locator('.depth-status--live')).toBeVisible()
  await expect.poll(() => chart.locator('canvas').count()).toBeGreaterThan(0)
  const chartBounds = await chart.boundingBox()
  expect(chartBounds).not.toBeNull()
  if (chartBounds) {
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.7, chartBounds.y + chartBounds.height * 0.55)
    await page.mouse.down()
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.4, chartBounds.y + chartBounds.height * 0.55, { steps: 5 })
    await page.mouse.up()
    await page.mouse.wheel(0, -240)
    await expect.poll(() => chart.locator('canvas').count()).toBeGreaterThan(0)
  }
  const themeSwitch = page.getByRole('button', { name: /temaya geç/ })
  await expect(themeSwitch).toBeVisible()
  const nextThemeLabel = await themeSwitch.getAttribute('aria-label') === 'Açık temaya geç'
    ? 'Koyu temaya geç'
    : 'Açık temaya geç'
  await themeSwitch.click()
  await expect(page.getByRole('button', { name: nextThemeLabel })).toBeVisible()

  await page.setViewportSize({ width: 375, height: 812 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await expect(chart.locator('canvas').first()).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('scanner processes the mocked USDT market universe', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Tarayıcı', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Piyasa tarayıcı' })).toBeVisible()
  await page.getByRole('button', { name: 'Taramayı başlat' }).click()
  await expect(page.getByRole('row', { name: /BTCUSDT/ })).toBeVisible()
  await expect(page.getByText('1 / 1 sonuç')).toBeVisible()
})

test('pattern JSON import is shown in a separate reference table', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Desen havuzu', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Desen havuzu' })).toBeVisible()

  const payload = {
    version: 1,
    symbol: 'ETHUSDT',
    timeframe: '5m',
    patterns: [{
      id: 'fixture-pattern',
      name: 'Imported fixture',
      samples: 6,
      wilson: 0.31,
      avgReturn: 0.42,
      avgMfe: 1.25,
      avgMae: -0.45,
      grade: 'İzle',
    }],
  }
  await page.getByLabel('JSON analiz raporu içe aktar').setInputFiles({
    name: 'reference.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  await expect(page.getByRole('heading', { name: 'İçe aktarılan desen özeti' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Imported fixture/ })).toBeVisible()
})

test('walk-forward backtest runs against mocked candle history', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Backtest', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Walk-forward backtest' })).toBeVisible()
  await page.getByRole('button', { name: 'Backtest çalıştır' }).click()
  await expect(page.getByRole('heading', { name: 'Equity sırası' })).toBeVisible()
})
