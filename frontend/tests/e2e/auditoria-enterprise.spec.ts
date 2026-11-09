import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type RouteEntry = { path: string; source: string };
const routes = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "auditoria-rotas.json"), "utf8")) as RouteEntry[];
const base = process.env.NEXUS_FRONTEND_URL || "http://localhost:3000";
const email = process.env.NEXUS_AUDIT_EMAIL;
const password = process.env.NEXUS_AUDIT_PASSWORD;
const output = path.resolve(process.cwd(), "..", "relatorios-auditoria");

async function login(page: Page) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator('input[type="email"]').first().fill(email!);
  await page.locator('input[type="password"]').first().fill(password!);
  await page.getByRole("button", { name: /entrar/i }).first().click();
  await page.waitForURL(url => !url.pathname.endsWith("/login"), { timeout: 30000 });
}

test("Auditoria Enterprise: login, navegacao e captura de erros", async ({ page }, info) => {
  test.setTimeout(30 * 60 * 1000);
  if (!email || !password) throw new Error("Defina NEXUS_AUDIT_EMAIL e NEXUS_AUDIT_PASSWORD.");
  fs.mkdirSync(output, { recursive: true });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkIssues: any[] = [];
  const pageResults: any[] = [];

  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("response", r => {
    if (r.status() >= 400) networkIssues.push({ status: r.status(), method: r.request().method(), url: r.url() });
  });
  page.on("requestfailed", r => networkIssues.push({
    status: "REQUEST_FAILED", method: r.method(), url: r.url(), error: r.failure()?.errorText
  }));

  await login(page);

  for (const route of routes) {
    const start = Date.now();
    let status = "OK", httpStatus: number | null = null, error = "";
    try {
      const response = await page.goto(`${base}${route.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      httpStatus = response?.status() ?? null;
      await page.waitForTimeout(600);
      if (httpStatus && httpStatus >= 400) status = `HTTP_${httpStatus}`;
      else if (new URL(page.url()).pathname === "/login" && route.path !== "/login") status = "REDIRECIONADO_LOGIN";

      const filename = (route.path.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70) || "home") + ".png";
      await page.screenshot({ path: path.join(output, filename), fullPage: true });
    } catch (e: any) {
      status = "ERRO_NAVEGACAO";
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
  const file = path.join(output, `auditoria-browser-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  await info.attach("relatorio-auditoria", { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: "application/json" });

  console.log(`Resumo: ${pageResults.length} paginas; ${pageResults.filter(x => x.status !== "OK").length} com ressalvas; ` +
    `${consoleErrors.length} erros de console; ${pageErrors.length} erros JS; ${networkIssues.length} falhas de rede/HTTP.`);
  expect(pageResults.length).toBeGreaterThan(0);
});
