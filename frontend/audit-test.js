const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Use environment variables set in the system
const email = process.env.NEXUS_AUDIT_EMAIL || 'audit@nexus.test';
const password = process.env.NEXUS_AUDIT_PASSWORD || 'audittest123';

const routes = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'auditoria-rotas.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const base = 'http://localhost:3000';
  
  // Login
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /entrar/i }).first().click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 30000 });
  
  console.log('Login successful');
  
  const consoleErrors = [];
  const pageErrors = [];
  const networkIssues = [];
  const pageResults = [];
  
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) networkIssues.push({ status: r.status(), method: r.request().method(), url: r.url() }); });
  page.on('requestfailed', r => networkIssues.push({ status: 'REQUEST_FAILED', method: r.method(), url: r.url(), error: r.failure()?.errorText }));
  
  for (const route of routes) {
    const start = Date.now();
    let status = 'OK';
    let httpStatus = null;
    let error = '';
    
    try {
      const response = await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      httpStatus = response?.status() ?? null;
      await page.waitForTimeout(600);
      if (httpStatus && httpStatus >= 400) status = `HTTP_${httpStatus}`;
      else if (new URL(page.url()).pathname === '/login' && route.path !== '/login') status = 'REDIRECIONADO_LOGIN';
      
      const filename = (route.path.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70) || 'home') + '.png';
      await page.screenshot({ path: path.join(process.cwd(), 'screenshots', filename), fullPage: true });
    } catch (e) {
      status = 'ERRO_NAVEGACAO';
      error = e?.message || String(e);
    }
    
    pageResults.push({ path: route.path, source: route.source, status, httpStatus, durationMs: Date.now() - start, error });
    console.log(`[AUDIT] ${status} ${route.path}`);
  }
  
  const report = {
    generatedAt: new Date().toISOString(),
    pagesDiscovered: routes.length,
    pages: pageResults,
    consoleErrors,
    pageErrors,
    networkIssues
  };
  
  const outputDir = path.join(process.cwd(), 'relatorios-auditoria');
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, `auditoria-browser-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  
  console.log(`\nResumo: ${pageResults.length} paginas; ${pageResults.filter(x => x.status !== 'OK').length} com ressalvas; ${consoleErrors.length} erros de console; ${pageErrors.length} erros JS; ${networkIssues.length} falhas de rede/HTTP.`);
  
  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});