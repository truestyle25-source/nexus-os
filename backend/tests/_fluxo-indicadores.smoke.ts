// Teste de fumaça do fluxo completo da aba Indicadores.
// REQUISITO: backend dev rodando em http://localhost:3333 (`npm run dev`).
// Execução: npx tsx tests/_fluxo-indicadores.smoke.ts
// (fora do glob `tests/*.test.ts` de propósito: os demais testes usam
//  app.inject e não dependem de servidor; este valida o caminho HTTP real.)
// Registra empresa -> loga -> bate nos 3 endpoints que a tela chama,
// com os MESMOS parâmetros que `indicadores/page.tsx` envia, e finaliza
// com POST /ia/perguntar (botão "Simular otimização").
const base = 'http://localhost:3333';
const suf = Date.now().toString(36);
const email = `indic-${suf}@teste.local`;

async function rota(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let json: any = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { json = { raw: texto }; }
  return { status: res.status, json };
}

function comFuso(data: string, hora: string): string {
  const offset = -new Date().getTimezoneOffset();
  const sinal = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${data}T${hora}:00${sinal}${hh}:${mm}`;
}

function diaLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) console.log(`  ok   ${nome}`);
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  const agora = new Date();
  const reg = await rota('POST', '/auth/register-company', {
    nomeEmpresa: 'Empresa Indic Teste',
    nome: 'Teste Indic',
    email,
    senha: 'senha12345',
  });
  ok('register-company -> 2xx', reg.status >= 200 && reg.status < 300, `status=${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);

  const login = await rota('POST', '/auth/login', { email, senha: 'senha12345' });
  ok('login -> 200', login.status === 200, `status=${login.status}`);
  const token = login.json.token || login.json.accessToken;
  ok('login devolve token', Boolean(token));

  // Mesmos parâmetros da tela: mês corrente com offset real.
  const inicio = diaLocal(new Date(agora.getFullYear(), agora.getMonth(), 1));
  const fim = diaLocal(agora);
  const params = `periodoInicio=${encodeURIComponent(comFuso(inicio, '00:00'))}&periodoFim=${encodeURIComponent(comFuso(fim, '23:59'))}`;

  const serie = await rota('GET', `/dashboard/serie?${params}`, undefined, token);
  ok('GET /dashboard/serie -> 200', serie.status === 200, `status=${serie.status}`);
  ok('serie tem totais', serie.json?.totais !== undefined);
  ok('serie tem ltv.ltvRealizado', serie.json?.ltv?.ltvRealizado !== undefined);
  ok('serie tem pontos[]', Array.isArray(serie.json?.pontos));

  const dre = await rota('GET', `/dre?${params}`, undefined, token);
  ok('GET /dre -> 200', dre.status === 200, `status=${dre.status}`);
  ok('dre tem detalhes', dre.json?.detalhes !== undefined);
  ok('dre NÃO persiste (sem id de registro)', dre.json?.dre?.id === undefined);

  const roi = await rota('GET', `/roi?${params}`, undefined, token);
  ok('GET /roi -> 200', roi.status === 200, `status=${roi.status}`);
  ok('roi devolve numero finito', Number.isFinite(roi.json?.roi), `roi=${roi.json?.roi}`);

  // 401 sem token (a tela trata via api.ts).
  const semTok = await rota('GET', '/dashboard/serie');
  ok('serie sem token -> 401', semTok.status === 401, `status=${semTok.status}`);

  // Botão "Simular otimização".
  const ia = await rota('POST', '/ia/perguntar', {
    pergunta: 'Simule uma otimização do indicador "Vendas" (COUNT(venda.status = FINALIZADA) no período). Sugira de 2 a 3 ações concretas em no máximo 6 linhas.',
  }, token);
  ok('POST /ia/perguntar -> 200/502 com corpo', (ia.status === 200 || ia.status === 502), `status=${ia.status}`);
  ok('ia devolve resposta/fallback', Boolean(ia.json?.resposta || ia.json?.fallback || ia.json?.error));

  console.log(`\nRESULTADO: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });
