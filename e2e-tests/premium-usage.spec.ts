import { expect, test } from '@playwright/test'

test.describe('Premium Usage tab', () => {
  test('loads mocked organization premium and token usage views', async ({ page }) => {
    await page.goto('/orgs/mocked-org?mock=true&tab=premium%20usage')

    await expect(page.getByText('Premium Usage').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Premium Request Usage by User')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('octocat')).toBeVisible()

    await page.getByRole('button', { name: /Token Usage/ }).click()

    await expect(page.getByText('Token Usage by User')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Total Tokens')).toBeVisible()
    await expect(page.getByText('mona')).toBeVisible()
  })

  test('loads mocked enterprise premium usage view', async ({ page }) => {
    await page.goto('/enterprises/mocked-ent?mock=true&tab=premium%20usage')

    await expect(page.getByText('Premium Usage').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Premium Request Usage by User')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('enterprise-admin')).toBeVisible()
  })
})