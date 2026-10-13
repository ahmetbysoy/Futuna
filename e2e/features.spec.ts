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

test('orderflow presets and symbol thresholds persist locally', async ({ page }) => {
  await openSettings(page)
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
})

test('session recorder starts, stops, and exports JSON', async ({ page }) => {
  await openSettings(page)
  await page.getByLabel('İndirme biçimi').selectOption('json')
  const startButton = page.getByRole('button', { name: 'Kaydı başlat' })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await expect(page.getByText('Kaydediliyor', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Kaydı durdur' }).click()
  await expect(page.getByText('Son kayıt', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'İndir', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)
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
