const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const email = 'admin@nexus.com';
  const password = '12345678';
  const resultsRoot = path.resolve(__dirname, '../../test-results/nexus-simulacao');
  fs.mkdirSync(resultsRoot, { recursive: true });

  const routesToCheck = [
    { url: '/', label: 'Dashboard', keyword: 'Dashboard' },
    { url: '/rh', label: 'RH', keyword: 'Recursos humanos' },
    { url: '/compras', label: 'Compras', keyword: 'Compras' },
    { url: '/estoque', label: 'Estoque', keyword: 'Estoque' },
    { url: '/vendas', label: 'Vendas', keyword: 'Vendas' },
    { url: '/financeiro', label: 'Financeiro', keyword: 'Financeiro' },
    { url: '/pdv', label: 'PDV', keyword: 'PDV' },
    { url: '/produtos', label: 'Produtos', keyword: 'Produtos' },
    { url: '/clientes', label: 'Clientes', keyword: 'Clientes' },
    { url: '/fornecedores', label: 'Fornecedores', keyword: 'Fornecedores' },
    { url: '/ponto', label: 'Ponto', keyword: 'Ponto' },
    { url: '/fiscal', label: 'Fiscal', keyword: 'Fiscal' }
  ];

  const audit = [];

  try {
    await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="seu@email.com"]').fill(email);
    await page.locator('input[placeholder="••••••••"]').fill(password);
    await page.getByRole('button', { name: 'Entrar no NEXUS OS' }).click();
    await page.waitForURL('**/', { timeout: 30000 });

    const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
    console.log('Login successful. Token present:', Boolean(token));
    await page.screenshot({ path: path.join(resultsRoot, '01-login-dashboard.png'), fullPage: true });

    for (const route of routesToCheck) {
      const response = await page.goto(`http://localhost:3000${route.url}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText();
      const status = response?.status?.() ?? 0;
      const ok = status >= 200 && status < 400 && text.trim().length > 80;
      audit.push({ route: route.url, label: route.label, status, ok });
      await page.screenshot({ path: path.join(resultsRoot, `02-${route.label.toLowerCase()}-${route.url.replace('/', '') || 'home'}.png`), fullPage: true });
      console.log(`${route.label}: status=${status} ok=${ok} url=${page.url()}`);
    }

    console.log('SUMMARY');
    console.log(JSON.stringify(audit, null, 2));
  } catch (error) {
    console.error('ERROR during browser simulation:', error);
    await page.screenshot({ path: path.join(resultsRoot, '99-failure.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
})();
