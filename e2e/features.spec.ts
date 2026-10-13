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
