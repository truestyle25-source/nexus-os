/**
 * NEXUS CLUB — F-Foto: foto do produto no armazenamento privado.
 *
 * Regras puras (sempre rodam) e, com o Postgres de teste, a API real (Fastify + Prisma)
 * contra um armazenamento Supabase FALSO em memória (o `fetch` é trocado só para o host
 * fictício do storage — nada sai da máquina):
 *  - SVG e HTML renomeados para .jpg são recusados; arquivo de 6 MB é recusado;
 *  - JPG com EXIF vira 3 WEBP (160/400/1000) sem metadados, na pasta da empresa;
 *  - empresa B não envia, não remove, não vê e não assina a foto de produto da empresa A;
 *  - trocar e remover apagam os arquivos antigos; sem storage → 503 claro;
 *  - o PDV recebe a foto (link assinado) e, sem foto, continua com o link antigo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { produtoFotoRoutes } from '../src/modules/produtos/produto-foto.routes.js';
import { produtoFichaRoutes } from '../src/modules/produtos/produto-ficha.routes.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { chavesDaFoto, formatoPeloConteudo, inicioJanelaFotos, validarArquivoFoto } from '../src/modules/produtos/produto-foto.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-produto-foto-0123456789abcdef';
const HOST_STORAGE = 'http://storage-falso.teste.local';
const BUCKET = 'fotos-teste';

const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');

async function jpegComExif(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 180, g: 110, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'CameraTeste', Copyright: 'dono-da-foto' } })
    .toBuffer();
}
async function png(): Promise<Buffer> {
  return sharp({ create: { width: 700, height: 700, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer();
}

// ---------------------------------------------------------------- regras puras
test('foto do produto — tipo pelo conteúdo, não pelo nome', async () => {
  assert.equal(formatoPeloConteudo(await jpegComExif()), 'jpeg');
  assert.equal(formatoPeloConteudo(await png()), 'png');
  assert.equal(formatoPeloConteudo(SVG), null);
  assert.throws(() => validarArquivoFoto('foto.jpg', SVG), (e: any) => e instanceof ErroDeNegocio && e.status === 400);
  assert.throws(() => validarArquivoFoto('foto.jpg', HTML), (e: any) => e instanceof ErroDeNegocio && e.status === 400);
  assert.throws(() => validarArquivoFoto('foto.svg', SVG), (e: any) => e.status === 400);
  assert.throws(() => validarArquivoFoto('foto.gif', Buffer.from('GIF89a')), (e: any) => e.status === 400);
  const seisMb = Buffer.alloc(6 * 1024 * 1024); seisMb[0] = 0xff; seisMb[1] = 0xd8; seisMb[2] = 0xff;
  assert.throws(() => validarArquivoFoto('grande.jpg', seisMb), (e: any) => e.status === 413);
  assert.deepEqual(chavesDaFoto('e1/produtos/2026-11-27/abc.webp'), {
    miniatura: 'e1/produtos/2026-11-27/abc-160.webp', lista: 'e1/produtos/2026-11-27/abc-400.webp', detalhe: 'e1/produtos/2026-11-27/abc-1000.webp',
  });
  assert.ok(inicioJanelaFotos().getTime() <= Date.now());
});

// ---------------------------------------------------------------- armazenamento falso
function instalarStorageFalso() {
  const objetos = new Map<string, { corpo: Buffer; tipo: string }>();
  const original = globalThis.fetch;
  const falso: typeof fetch = async (entrada, init) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (!url.startsWith(HOST_STORAGE)) return original(entrada as any, init);
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const assinar = `${HOST_STORAGE}/storage/v1/object/sign/${BUCKET}`;
    if (url === assinar && metodo === 'POST') {
      const { paths, expiresIn } = JSON.parse(String(init?.body));
      assert.ok(expiresIn > 0);
      return new Response(JSON.stringify(paths.map((p: string) => (objetos.has(p)
        ? { path: p, signedURL: `/object/sign/${BUCKET}/${p}?token=tk`, error: null }
        : { path: p, signedURL: null, error: 'Object not found' }))), { status: 200 });
    }
    const prefixo = `${HOST_STORAGE}/storage/v1/object/${BUCKET}/`;
    assert.ok(url.startsWith(prefixo), `rota de storage inesperada: ${url}`);
    const chave = decodeURIComponent(url.slice(prefixo.length));
    if (metodo === 'POST') {
      const h = init?.headers as Record<string, string>;
      objetos.set(chave, { corpo: Buffer.from(init?.body as Uint8Array), tipo: h['Content-Type'] });
      return new Response('{}', { status: 200 });
    }
    if (metodo === 'DELETE') return new Response('{}', { status: objetos.delete(chave) ? 200 : 404 });
    const o = objetos.get(chave);
    return o ? new Response(new Uint8Array(o.corpo), { status: 200, headers: { 'content-type': o.tipo } }) : new Response('', { status: 404 });
  };
  globalThis.fetch = falso;
  return { objetos, restaurar: () => { globalThis.fetch = original; } };
}

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  for (const r of [produtoFotoRoutes, produtoFichaRoutes, pdvRoutes]) await app.register(r);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const mk = async (rotulo: string, negadas: string[]) => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return u;
  };
  const produto = await prisma.produto.create({ data: { empresaId: empresa.id, nome: `Café ${nome} ${SUF}`, sku: `FOTO-${nome}-${SUF}`, custo: 5, precoVenda: 20, unidade: 'UN', status: 'ATIVO', imagem: 'https://exemplo.teste/cafe.jpg' } });
  return { empresa, filial, produto, admin: await mk('admin', []), leitor: await mk('leitor', ['produtos.editar']) };
}

test('foto do produto — API real com storage falso', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const envOriginal = { p: process.env.STORAGE_PROVIDER, b: process.env.STORAGE_BUCKET, u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  Object.assign(process.env, { STORAGE_PROVIDER: 'supabase', STORAGE_BUCKET: BUCKET, SUPABASE_URL: HOST_STORAGE, SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste' });
  const storage = instalarStorageFalso();
  const app = await montarApp();
  const A = await criarEmpresa('FotoA');
  const B = await criarEmpresa('FotoB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const HA = tok(A.admin); const HL = tok(A.leitor); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body };
  };
  const enviar = (h: any, produtoId: string, nome: string, corpo: Buffer) => call('POST', `/produtos/${produtoId}/imagem`, h, { arquivo: { nome, base64: corpo.toString('base64') } });
  const urlA = `/produtos/${A.produto.id}/imagem`;
  const chaveAtual = async (id: string) => (await prisma.produto.findUnique({ where: { id }, select: { imagemChave: true } }))!.imagemChave;

  try {
    await t.test('SVG/HTML renomeados para .jpg e arquivo de 6 MB são recusados, nada é gravado', async () => {
      const svg = await enviar(HA, A.produto.id, 'cafe.jpg', SVG);
      assert.equal(svg.s, 400, JSON.stringify(svg.b));
      assert.match(svg.b.error, /não é uma foto/);
      assert.equal((await enviar(HA, A.produto.id, 'cafe.jpg', HTML)).s, 400);
      const seisMb = Buffer.concat([await jpegComExif(), Buffer.alloc(6 * 1024 * 1024)]);
      const grande = await enviar(HA, A.produto.id, 'cafe.jpg', seisMb);
      assert.equal(grande.s, 413, JSON.stringify(grande.b));
      assert.match(grande.b.error, /5 MB/);
      assert.equal(storage.objetos.size, 0);
      assert.equal(await chaveAtual(A.produto.id), null);
    });

    await t.test('sem permissão produtos.editar → 403', async () => {
      assert.equal((await enviar(HL, A.produto.id, 'cafe.jpg', await jpegComExif())).s, 403);
      assert.equal((await call('DELETE', urlA, HL)).s, 403);
    });

    let primeira = '';
    await t.test('JPG com EXIF vira 3 WEBP sem metadados, na pasta da empresa', async () => {
      const original = await jpegComExif();
      assert.ok((await sharp(original).metadata()).exif, 'a foto de teste precisa ter EXIF');
      const r = await enviar(HA, A.produto.id, 'cafe.jpg', original);
      assert.equal(r.s, 201, JSON.stringify(r.b));
      primeira = (await chaveAtual(A.produto.id))!;
      assert.ok(primeira.startsWith(`${A.empresa.id}/produtos/`));
      const chaves = chavesDaFoto(primeira);
      for (const [nome, px] of [['miniatura', 160], ['lista', 400], ['detalhe', 1000]] as const) {
        const o = storage.objetos.get(chaves[nome]);
        assert.ok(o, `tamanho ${nome} gravado`);
        assert.equal(o.tipo, 'image/webp');
        const m = await sharp(o.corpo).metadata();
        assert.equal(m.format, 'webp'); assert.equal(m.width, px); assert.equal(m.height, px);
        assert.equal(m.exif, undefined, 'EXIF removido'); assert.equal(m.xmp, undefined); assert.equal(m.icc, undefined);
        assert.match(r.b.foto[nome], new RegExp(`/storage/v1/object/sign/${BUCKET}/`));
      }
      // o link digitado antes não é tocado
      assert.equal((await prisma.produto.findUnique({ where: { id: A.produto.id } }))!.imagem, 'https://exemplo.teste/cafe.jpg');
      const aud = await prisma.auditoria.findFirst({ where: { empresaId: A.empresa.id, entidade: 'Produto', entidadeId: A.produto.id, contexto: { contains: 'foto' } } });
      assert.ok(aud, 'envio registrado na auditoria');
    });

    await t.test('ficha devolve a foto por link temporário', async () => {
      const f = await call('GET', `/produtos/${A.produto.id}/ficha`, HA);
      assert.equal(f.s, 200);
      assert.equal(f.b.temFotoEnviada, true);
      assert.match(f.b.foto.lista, /token=/);
      assert.equal(f.b.produto.imagem, 'https://exemplo.teste/cafe.jpg');
    });

    await t.test('empresa B não envia, não remove e não vê a foto do produto da empresa A', async () => {
      assert.equal((await enviar(HB, A.produto.id, 'cafe.jpg', await jpegComExif())).s, 404);
      assert.equal((await call('DELETE', urlA, HB)).s, 404);
      assert.equal((await call('GET', `/produtos/${A.produto.id}/ficha`, HB)).s, 404);
      const cat = await call('GET', `/pdv/catalogo?filialId=${B.filial.id}&take=500`, HB);
      assert.equal(cat.s, 200);
      assert.equal(cat.b.produtos.some((p: any) => p.id === A.produto.id), false);
      assert.equal(cat.b.produtos.some((p: any) => typeof p.imagem === 'string' && p.imagem.includes(A.empresa.id)), false);
      // Mesmo com a chave da empresa A gravada à força num produto de B, o servidor não assina.
      await prisma.produto.update({ where: { id: B.produto.id }, data: { imagemChave: primeira } });
      const fb = await call('GET', `/produtos/${B.produto.id}/ficha`, HB);
      assert.equal(fb.b.foto, null);
      const catB = await call('GET', `/pdv/catalogo?filialId=${B.filial.id}&take=500`, HB);
      assert.equal(catB.b.produtos.find((p: any) => p.id === B.produto.id).imagem, 'https://exemplo.teste/cafe.jpg');
      await prisma.produto.update({ where: { id: B.produto.id }, data: { imagemChave: null } });
      assert.equal(await chaveAtual(A.produto.id), primeira, 'foto de A intacta');
      assert.equal(storage.objetos.size, 3);
    });

    await t.test('PDV recebe a foto enviada; incremental renova links quando a janela vira', async () => {
      const cat = await call('GET', `/pdv/catalogo?filialId=${A.filial.id}&take=500`, HA);
      assert.equal(cat.s, 200);
      const p = cat.b.produtos.find((x: any) => x.id === A.produto.id);
      assert.equal(p.imagem, `${HOST_STORAGE}/storage/v1/object/sign/${BUCKET}/${chavesDaFoto(primeira).lista}?token=tk`);
      assert.equal('imagemChave' in p, false);
      const antigo = new Date(inicioJanelaFotos().getTime() - 60_000).toISOString();
      await prisma.produto.update({ where: { id: A.produto.id }, data: { updatedAt: new Date(Date.parse(antigo) - 86_400_000) } });
      const inc = await call('GET', `/pdv/catalogo?filialId=${A.filial.id}&take=500&desde=${encodeURIComponent(antigo)}`, HA);
      assert.ok(inc.b.produtos.some((x: any) => x.id === A.produto.id), 'produto com foto reenviado para renovar o link');
      const recente = new Date().toISOString();
      const inc2 = await call('GET', `/pdv/catalogo?filialId=${A.filial.id}&take=500&desde=${encodeURIComponent(recente)}`, HA);
      assert.equal(inc2.b.produtos.some((x: any) => x.id === A.produto.id), false, 'dentro da mesma janela não reenvia');
    });

    await t.test('trocar a foto apaga os arquivos antigos', async () => {
      const r = await enviar(HA, A.produto.id, 'nova.png', await png());
      assert.equal(r.s, 201, JSON.stringify(r.b));
      const nova = (await chaveAtual(A.produto.id))!;
      assert.notEqual(nova, primeira);
      for (const c of Object.values(chavesDaFoto(primeira))) assert.equal(storage.objetos.has(c), false, `antigo apagado: ${c}`);
      for (const c of Object.values(chavesDaFoto(nova))) assert.equal(storage.objetos.has(c), true);
      assert.equal(storage.objetos.size, 3);
    });

    await t.test('remover apaga os arquivos e o PDV volta ao link antigo', async () => {
      const nova = (await chaveAtual(A.produto.id))!;
      const r = await call('DELETE', urlA, HA);
      assert.equal(r.s, 200); assert.equal(r.b.removida, true);
      assert.equal(await chaveAtual(A.produto.id), null);
      for (const c of Object.values(chavesDaFoto(nova))) assert.equal(storage.objetos.has(c), false);
      assert.equal(storage.objetos.size, 0);
      assert.equal((await call('DELETE', urlA, HA)).b.removida, false, 'remover de novo não quebra');
      const cat = await call('GET', `/pdv/catalogo?filialId=${A.filial.id}&take=500`, HA);
      assert.equal(cat.b.produtos.find((x: any) => x.id === A.produto.id).imagem, 'https://exemplo.teste/cafe.jpg');
    });

    await t.test('sem armazenamento configurado → 503 claro', async () => {
      delete process.env.STORAGE_BUCKET;
      const r = await enviar(HA, A.produto.id, 'cafe.jpg', await jpegComExif());
      assert.equal(r.s, 503);
      assert.match(r.b.error, /Armazenamento/);
      process.env.STORAGE_BUCKET = BUCKET;
    });
  } finally {
    storage.restaurar();
    for (const [k, v] of Object.entries({ STORAGE_PROVIDER: envOriginal.p, STORAGE_BUCKET: envOriginal.b, SUPABASE_URL: envOriginal.u, SUPABASE_SERVICE_ROLE_KEY: envOriginal.k })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await app.close();
  }
});

test('link temporário S3 confere com o exemplo oficial da AWS (Signature V4 por query)', async (t) => {
  const chaves = ['STORAGE_PROVIDER', 'STORAGE_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_ENDPOINT'] as const;
  const antes = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    STORAGE_PROVIDER: 's3', STORAGE_BUCKET: 'examplebucket', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', AWS_S3_ENDPOINT: 'examplebucket.s3.amazonaws.com',
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2013, 4, 24) });
  try {
    const { urlAssinada } = await import('../src/lib/storage.js');
    const url = await urlAssinada('test.txt', 86400);
    assert.match(url, /^https:\/\/examplebucket\.s3\.amazonaws\.com\/test\.txt\?/);
    assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  } finally {
    t.mock.timers.reset();
    for (const k of chaves) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
});
