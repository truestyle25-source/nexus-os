const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="seu@email.com"]').fill('admin@nexus.com');
    await page.locator('input[placeholder="••••••••"]').fill('12345678');
    await page.getByRole('button', { name: 'Entrar no NEXUS OS' }).click();
    await page.waitForURL('**/', { timeout: 30000 });
    console.log('Login successful. URL:', page.url());
    await page.screenshot({ path: 'C:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/frontend/test-results/login-success.png', fullPage: true });
    const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
    const user = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus_user') || 'null'));
    console.log('Has token:', Boolean(token));
    console.log('User email:', user?.email);
    console.log('Company ID:', user?.empresaId);
  } catch (error) {
    console.error('ERROR during login:', error);
    await page.screenshot({ path: 'C:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/frontend/test-results/login-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
})();
