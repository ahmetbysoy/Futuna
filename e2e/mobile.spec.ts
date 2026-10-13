import { expect, test } from '@playwright/test'
import { mockMarketApi } from './market-fixtures'

test.beforeEach(async ({ page }) => {
  await mockMarketApi(page)
})

test('mobile navigation, additional screens, and backtest work', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Canlı terminal' })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Alt gezinme' })
  await expect(navigation).toBeVisible()
  await navigation.getByRole('button', { name: 'Sinyaller', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sinyal merkezi' })).toBeVisible()

  await navigation.getByRole('button', { name: 'Diğer ekranlar' }).click()
  const sheet = page.getByRole('dialog', { name: 'Diğer ekranlar' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Backtest', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Walk-forward backtest' })).toBeVisible()
  await page.getByRole('button', { name: 'Backtest çalıştır' }).click()
  await expect(page.getByRole('heading', { name: 'Equity sırası' })).toBeVisible()
})

test('mobile scanner and pattern JSON import flows work', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Alt gezinme' })
  await navigation.getByRole('button', { name: 'Tarayıcı', exact: true }).click()
  await page.getByRole('button', { name: 'Taramayı başlat' }).click()
  await expect(page.getByRole('row', { name: /BTCUSDT/ })).toBeVisible()

  await navigation.getByRole('button', { name: 'Desen havuzu', exact: true }).click()
  const payload = {
    version: 1,
    symbol: 'ETHUSDT',
    timeframe: '5m',
    patterns: [{
      id: 'mobile-fixture-pattern',
      name: 'Mobile fixture',
      samples: 5,
      wilson: 0.28,
      avgReturn: 0.31,
      avgMfe: 1.1,
      avgMae: -0.4,
      grade: 'İzle',
    }],
  }
  await page.getByLabel('JSON analiz raporu içe aktar').setInputFiles({
    name: 'mobile-reference.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  await expect(page.getByRole('row', { name: /Mobile fixture/ })).toBeVisible()
})

test('mobile settings can enable alerts and manage a local session', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Alt gezinme' })
  await navigation.getByRole('button', { name: 'Diğer ekranlar' }).click()
  const sheet = page.getByRole('dialog', { name: 'Diğer ekranlar' })
  await sheet.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible()

  const orderflowSection = page.locator('.settings-section').filter({ hasText: 'Emir akışı ve mikro yapı' })
  await orderflowSection.locator('summary').click()
  const minimalPreset = page.getByRole('button', { name: 'Sade', exact: true })
  await minimalPreset.click()
  await expect(minimalPreset).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  const startButton = page.getByRole('button', { name: 'Kaydı başlat' })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await expect(page.getByText('Kaydediliyor', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Kaydı durdur' }).click()
  await expect(page.getByText('Son kayıt', { exact: true })).toBeVisible()

  await page.locator('summary').filter({ hasText: 'Ses ve bildirimler' }).click()
  const alertsEnabled = page.getByLabel('Sesli uyarılar')
  await alertsEnabled.check()
  await expect(alertsEnabled).toBeChecked()
})
