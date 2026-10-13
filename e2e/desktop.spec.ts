import { expect, test } from '@playwright/test'
import { mockMarketApi } from './market-fixtures'

test.beforeEach(async ({ page }) => {
  await mockMarketApi(page)
})

test('desktop terminal renders and navigates between feature modules', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Canlı terminal' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Derinlik defteri' })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Ana gezinme' })
  await navigation.getByRole('button', { name: 'Sinyaller', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sinyal merkezi' })).toBeVisible()

  expect(pageErrors).toEqual([])
})
