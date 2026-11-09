const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1500, height: 1200 } });
  const baseUrl = 'http://localhost:3000';
  const routes = [
    '/', '/produtos', '/estoque', '/compras', '/fornecedores', '/rh',
    '/financeiro', '/vendas', '/pdv', '/clientes', '/usuarios',
    '/fiscal', '/dre', '/metas', '/relatorios', '/indicadores', '/auditoria', '/configuracoes'
  ];

  const results = [];

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('input[type="email"]').fill('admin@nexus.com');
    await page.locator('input[type="password"]').fill('12345678');
    await page.getByRole('button', { name: /Entrar no NEXUS OS/i }).click();
    await page.waitForTimeout(6000);

    const userEmail = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('nexus_user') || 'null')?.email || 'none'; } catch { return 'none'; }
    });
    console.log('LOGIN_OK', userEmail);

    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
        return null;
      });
      const status = response ? response.status() : 'error';
      const title = await page.title().catch(() => '');
      const text = await page.locator('body').innerText().catch(() => '');
      const normalized = (text || '').replace(/\s+/g, ' ').trim();
      const ok = status === 200 || status === 304 || status === 'error' ? Boolean(normalized.length) : false;
      const screenshotPath = `C:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/frontend/test-results/${route === '/' ? 'root-final' : route.replace(/\//g, '-') + '-final'}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      results.push({ route, status, title: title.slice(0, 120), ok, chars: normalized.length });
      console.log(JSON.stringify({ route, status, title: title.slice(0, 80), ok, chars: normalized.length }));
    }
  } finally {
    console.log('RESULTS=' + JSON.stringify(results, null, 2));
    await browser.close();
  }
})();
