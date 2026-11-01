'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { Panel, SectionTitle, EmptyState, Badge } from '@/components/ui';

/**
 * Plataforma (Administração NEXUS) — visão multi-empresa do SaaS.
 *
 * POR QUE ESTA TELA NÃO BUSCA NADA DO SERVIDOR
 * --------------------------------------------
 * Todo endpoint do NEXUS OS é multi-tenant no sentido de ISOLAMENTO: o
 * `empresaId` sai do JWT e nunca do corpo da requisição. Não existe — e não
 * deve existir — uma rota autenticada de usuário comum que devolva empresas de
 * OUTRAS empresas: `GET /usuarios` devolve só a própria empresa, e trocar isso
 * por um "painel da plataforma" seria exatamente a brecha que o isolamento
 * multi-tenant existe para impedir.
 *
 * A versão anterior mostrava cinco KPIs e quatro linhas com "—", como se houvesse
 * uma consulta que falhou. Não havia consulta nenhuma: era um esqueleto
 * decorativo. Agora a tela diz a verdade — os números multi-empresa exigem um
 * endpoint administrativo de superusuário que o NEXUS OS ainda não expõe.
 *
 * Nenhum dado de outra empresa é exibido, estimado ou inventado aqui.
 */
const KPIs = [
  { l: 'Empresas' },
  { l: 'Ativas' },
  { l: 'Bloqueadas' },
  { l: 'Trial' },
  { l: 'MRR' },
];

const LINHAS_EMPRESAS = [
  'Empresas cadastradas',
  'Usuários',
  'Planos • Criar/Editar/Ativar/Desativar',
  'Assinaturas ativas / trial / inadimplentes / canceladas',
];

export default function PlataformaPage() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setCarregando(false);
  }, [router]);

  if (carregando) {
    return (
      <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
        <ModuleHeader kicker="Sistema" title="Administração NEXUS" />
        <div className="h-32 bg-[#1A1A2E] border border-white/[0.06] rounded-[16px] animate-pulse" />
      </main>
    );
  }

  return (
    <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
      <ModuleHeader
        kicker="Sistema"
        title="Administração NEXUS"
        subtitle="Painel administrativo da plataforma: empresas, usuários, planos, assinaturas e financeiro SaaS (MRR)."
        action={<Badge tone="neutral">Sem endpoint administrativo</Badge>}
      />

      {/* Explica o motivo ANTES dos indicadores: sem isto, o gestor via cinco
          "—" e não saberia se era falha de rede, permissão ou falta de dado. */}
      <div className="rounded-[16px] border border-amber-500/20 bg-amber-500/[0.06] px-5 py-4">
        <p className="text-[13px] text-amber-200/90 leading-relaxed">
          Estes indicadores não são carregados por decisão de arquitetura, não por
          falha. Todo endpoint do NEXUS OS filtra pela empresa do token:{' '}
          <code className="text-amber-200/70">GET /usuarios</code> devolve somente
          os usuários da sua empresa, e nenhuma rota autenticada de usuário comum
          expõe dados de outras empresas. Um painel multi-empresa exige um
          endpoint de superusuário com auditoria própria, que ainda não existe.
        </p>
        <p className="mt-2 text-[12px] text-amber-200/60 leading-relaxed">
          Até que ele exista, os valores abaixo ficam vazios de propósito: exibir
          um número aqui exigiria inventar a resposta.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KPIs.map((k) => (
          <div
            key={k.l}
            className="bg-[#1A1A2E] rounded-[14px] border border-white/[0.06] p-4"
          >
            <div className="text-[11px] uppercase text-white/40">{k.l}</div>
            <div className="text-[13px] font-bold mt-1 text-white/25" title="Sem fonte de dados no servidor">
              indisponível
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <SectionTitle>
            Empresas • Usuários • Planos • Assinaturas
          </SectionTitle>
          <div className="space-y-2 mt-4">
            {LINHAS_EMPRESAS.map((k) => (
              <div
                key={k}
                className="flex justify-between rounded-[10px] bg-[#121221] border border-white/[0.05] px-3 py-2.5 text-[13px]"
              >
                <span className="text-white/60">{k}</span>
                <span className="text-white/30">—</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>
            Financeiro SaaS • MRR • Receita • Inadimplência • Crescimento
          </SectionTitle>
          <div className="mt-4">
            <EmptyState
              title="Consolidação multi-empresa não disponível"
              description="MRR, receita recorrente e inadimplência consolidadas dependem do mesmo endpoint administrativo citado acima. Enquanto ele não existir, estes números não são calculáveis — e não são estimados."
            />
          </div>
          <div className="mt-3 text-[11px] text-white/25">
            Auditoria geral • visualização administrativa das atividades da
            plataforma
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionTitle>O que já funciona hoje, dentro da sua empresa</SectionTitle>
        <div className="mt-3 space-y-2 text-[12.5px] text-white/50 leading-relaxed">
          <p>
            <strong className="text-white/70">Configurações</strong> — usuários e
            permissões, cadastro da empresa, filiais, chaves de API pública e chave
            PIX. Todos gravados no PostgreSQL através dos endpoints do backend.
          </p>
          {/* A exceção é dita explicitamente porque a frase acima é uma promessa
              de persistência, e a promessa precisa ser exata: o que NÃO vale
              para ela são as preferências do PDV. Elas ficam em `localStorage`
              (chave `nexus_pdv`, em configuracoes/page.tsx) — ou seja, são do
              NAVEGADOR, não do servidor. Um switch virado no notebook do gestor
              não chega no terminal do caixa, e trocar de máquina perde a
              preferência. Dizer "todos no PostgreSQL" aqui seria exatamente a
              garantia falsa que esta tela existe para não contar. */}
          <p>
            <strong className="text-white/70">Preferências do PDV</strong> — os
            switches são gravados no <code className="text-white/40">localStorage</code>{' '}
            deste navegador (chave <code className="text-white/40">nexus_pdv</code>),{' '}
            <strong className="text-white/70">não</strong> no PostgreSQL: valem
            só para esta máquina e não seguem o usuário entre dispositivos.
          </p>
          <p>
            <strong className="text-white/70">Assinatura</strong> — status real do
            plano, trial, valor mensal e próximo vencimento, lidos de
            <code className="text-white/40"> GET /assinatura</code>.
          </p>
        </div>
      </Panel>

      <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3 text-[11px] text-white/25">
        {/* Rodapé de segurança. Antes ele afirmava "assinatura de webhooks
            HMAC SHA256 • rate limit por API key" — as DUAS coisas são falsas:
              • não existe assinatura HMAC de webhook em lugar nenhum do
                backend. `POST /api/v1/webhooks/pix/:tenantId` devolve 503
                com "nenhum provider com validação de assinatura está
                configurado", e não há webhook de saída;
              • o rate limit existe, mas a chave do bucket é `req.ip`
                (`middlewares/rateLimiter.ts`), não a chave de API — várias
                chaves atrás do mesmo IP compartilham o mesmo balde.
            Um rodapé que lista proteção inexistente é o pior lugar possível
            para mentir: é lido como atestado de segurança. O que é verdade
            está escrito; o que não existe foi retirado, não suavizado. */}
        <span>
          Segurança: JWT assinado (HS256) • senhas e chaves de API gravadas
          apenas como hash • TLS depende do proxy de hospedagem
        </span>
        <span>pt-BR • BRL • America/Sao_Paulo</span>
      </div>
    </main>
  );
}
