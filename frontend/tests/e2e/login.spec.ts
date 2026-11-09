import { test, expect } from '@playwright/test';

test.describe('Tela de login do NEXUS OS', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();

    await page.goto('/login');

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.reload();
  });

  test('deve exibir os elementos principais do login', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Bem-vindo ao NEXUS OS' })
    ).toBeVisible();

    await expect(
      page.getByPlaceholder('seu@email.com')
    ).toBeVisible();

    await expect(
      page.getByPlaceholder('••••••••')
    ).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Entrar no NEXUS OS' })
    ).toBeVisible();
  });
});
