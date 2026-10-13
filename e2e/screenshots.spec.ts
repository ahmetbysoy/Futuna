import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { mockMarketApi } from './market-fixtures'

test('dashboard captures a stable headless visual snapshot', async ({ page }, testInfo) => {
  await mockMarketApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Canlı terminal' })).toBeVisible()
  await expect(page.locator('.depth-status--live')).toBeVisible()
  await expect(page.locator('.book-rows--ask')).toContainText('0,75')
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '.orderbook-updated, .topbar__last-update { visibility: hidden !important; }' })

  const screenshotName = `${testInfo.project.name}-dashboard.png`
  const screenshotFolder = join(process.cwd(), 'artifacts', 'screenshots')
  const screenshotPath = join(screenshotFolder, screenshotName)
  await mkdir(screenshotFolder, { recursive: true })
  const image = await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  })
  expect(image.byteLength).toBeGreaterThan(25_000)

  await expect(page).toHaveScreenshot(screenshotName, {
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
    maxDiffPixelRatio: 0.01,
  })
})
