const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const baseUrl = 'http://localhost:3000';

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('input[placeholder="seu@email.com"]').fill('admin@nexus.com');
    await page.locator('input[placeholder="••••••••"]').fill('12345678');
    await page.getByRole('button', { name: 'Entrar no NEXUS OS' }).click();
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
    const user = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus_user') || 'null'));
    console.log('CURRENT_URL', currentUrl);
    console.log('TOKEN_PRESENT', Boolean(token));
    console.log('USER_EMAIL', user?.email || 'none');

    const routes = ['/', '/produtos', '/estoque', '/compras', '/fornecedores', '/rh', '/financeiro', '/vendas', '/pdv', '/clientes', '/usuarios', '/fiscal', '/dre', '/metas', '/relatorios', '/indicadores', '/auditoria', '/configuracoes'];
    const results = [];

    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      let status = 'unknown';
      let title = '';
      let bodyText = '';
      let ok = false;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        status = response ? String(response.status()) : 'no-response';
        title = await page.title();
        bodyText = await page.locator('body').innerText();
        const normalized = (bodyText || '').replace(/\s+/g, ' ').trim();
        ok = status.startsWith('2') || status.startsWith('3') || !!normalized;
      } catch (error) {
        status = 'error';
        title = 'error';
        bodyText = String(error.message || error);
      }
      results.push({ route, status, ok, title: title.slice(0, 120), chars: (bodyText || '').length });
      console.log(JSON.stringify({ route, status, ok, title: title.slice(0, 80) }));
      await page.screenshot({ path: `C:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/frontend/test-results/${route === '/' ? 'root' : route.replace(/\//g, '-')}.png`, fullPage: true }).catch(() => {});
    }

    console.log('RESULTS_JSON');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})();
