'use client';
import { useEffect, useState } from 'react';
import { Alternador, Aviso, CampoArea, CampoTexto, Grade, Secao, Selo, Tabela, estilos } from './ui';
import type { FormProduto } from './formulario';
import { fichaApi, fmtData, mensagemDeErro, type Catalogos, type Ficha } from '@/lib/produto-ficha';

type Base = { form: FormProduto; set: <K extends keyof FormProduto>(k: K, v: FormProduto[K]) => void; podeEditar: boolean };

/** Aba PDV: só o que o PDV atual usa de verdade (catálogo, posição, imagem, categoria, fracionado). */
export function AbaPdv({ form, set, podeEditar, catalogos }: Base & { catalogos: Catalogos }) {
  const ed = podeEditar ? set : undefined;
  const categoria = catalogos.categorias.find((c) => c.id === form.categoriaId)?.nome;
  const imagemValida = /^https?:\/\//i.test(form.imagem);
  return (
    <>
      <Secao titulo="Ponto de venda" descricao="Configurações aplicadas ao catálogo do PDV (inclusive no modo offline).">
        <Grade>
          <Alternador l={3} alinharCampo rotulo="Disponível no PDV" ligado={form.disponivelPdv} onChange={ed && ((v) => ed('disponivelPdv', v))} />
          <Alternador l={3} alinharCampo rotulo="Venda fracionada" ligado={form.vendaFracionada} onChange={ed && ((v) => ed('vendaFracionada', v))} />
          <CampoTexto l={3} rotulo="Posição de exibição" valor={form.posicaoPdv} onChange={ed && ((v) => ed('posicaoPdv', v))} numero inputMode="numeric" ajuda="Menor aparece primeiro" />
          <CampoTexto l={3} rotulo="Categoria de venda" valor={categoria ?? 'Sem categoria'} somenteLeitura ajuda="Definida na aba Dados (classificação)" />
          <CampoTexto l={8} rotulo="Imagem do produto (URL)" valor={form.imagem} onChange={ed && ((v) => ed('imagem', v))} placeholder="https://…" ajuda="Exibida no catálogo do PDV" />
          <div className={estilos.c4}>
            {imagemValida ? <img src={form.imagem} alt="Pré-visualização da imagem do produto" className={estilos.previa} /> : <span className={estilos.ajuda}>Sem pré-visualização</span>}
          </div>
        </Grade>
      </Secao>
      <Secao titulo="Recursos não disponíveis no PDV atual" descricao="Ficam registrados no cadastro, mas o PDV ainda não os executa.">
        <Grade>
          <Alternador l={3} rotulo="Envio para cozinha" ligado={form.enviaCozinha} onChange={ed && ((v) => ed('enviaCozinha', v))} ajuda="Sem impressão de produção" />
          <Alternador l={3} rotulo="Imprimir ficha de expedição" ligado={form.imprimeFichaExpedicao} onChange={ed && ((v) => ed('imprimeFichaExpedicao', v))} ajuda="Sem impressora de expedição" />
          <div className={estilos.c6}><Aviso>Adicionais, complementos e observações por item não existem no PDV do NEXUS OS. Não são exibidos para não prometer o que o PDV não faz.</Aviso></div>
        </Grade>
      </Secao>
    </>
  );
}

/** Aba Premiação: parâmetros e vigência. O cálculo/pagamento da premiação não existe ainda. */
export function AbaPremiacao({ form, set, podeEditar, podeAdministrar, ficha }: Base & { podeAdministrar: boolean; ficha: Ficha }) {
  const ed = podeEditar && podeAdministrar ? set : undefined;
  const [historico, setHistorico] = useState<any[]>([]);
  useEffect(() => {
    fichaApi.historicoCadastro(ficha.produto.id)
      .then((l) => setHistorico(l.filter((x) => x.campos.some((c: any) => ['comissaoPercentual', 'premiacaoPercentual', 'premiacaoInicio', 'premiacaoFim', 'premiacaoRegra'].includes(c.campo)))))
      .catch(() => setHistorico([]));
  }, [ficha.produto.id, ficha.produto.updatedAt]);
  return (
    <>
      <Secao titulo="Comissão e premiação" descricao={podeAdministrar ? 'Alterar exige a permissão produtos.administrar.' : 'Somente leitura: alterar exige a permissão produtos.administrar.'}>
        <Grade>
          <CampoTexto l={3} rotulo="Comissão (%)" valor={form.comissaoPercentual} onChange={ed && ((v) => ed('comissaoPercentual', v))} numero ajuda="Entra na margem líquida" />
          <CampoTexto l={3} rotulo="Premiação (%)" valor={form.premiacaoPercentual} onChange={ed && ((v) => ed('premiacaoPercentual', v))} numero />
          <CampoTexto l={3} rotulo="Vigência — início" tipo="date" valor={form.premiacaoInicio} onChange={ed && ((v) => ed('premiacaoInicio', v))} />
          <CampoTexto l={3} rotulo="Vigência — fim" tipo="date" valor={form.premiacaoFim} onChange={ed && ((v) => ed('premiacaoFim', v))} />
          <CampoArea rotulo="Regras de premiação" valor={form.premiacaoRegra} onChange={ed && ((v) => ed('premiacaoRegra', v))} maxLength={500} />
        </Grade>
        <div className={estilos.espaco3}><Aviso>O NEXUS OS registra os parâmetros e o histórico; o cálculo e o pagamento automático da premiação ainda não existem.</Aviso></div>
      </Secao>
      <Secao titulo="Histórico">
        <Tabela
          linhas={historico} chave={(l: any) => l.id} vazio="Sem alterações de comissão ou premiação."
          colunas={[
            { chave: 'data', titulo: 'Data', render: (l: any) => fmtData(l.data) },
            { chave: 'usuario', titulo: 'Usuário', render: (l: any) => l.usuario ?? '—' },
            { chave: 'mud', titulo: 'Alteração', render: (l: any) => l.campos.filter((c: any) => /comissao|premiacao/.test(c.campo)).map((c: any) => `${c.campo}: ${c.antes ?? '—'} → ${c.depois ?? '—'}`).join(' · ') },
          ]}
        />
      </Secao>
    </>
  );
}

const ESTADO: Record<string, { texto: string; tom?: 'ok' | 'alerta' | 'erro' }> = {
  ATIVO: { texto: 'Funcionando', tom: 'ok' }, PARCIAL: { texto: 'Parcial', tom: 'alerta' }, PENDENTE: { texto: 'Pendente', tom: 'alerta' },
  NAO_IMPLEMENTADO: { texto: 'Não implementado', tom: 'erro' }, NAO_CONFIGURADO: { texto: 'Não configurado' }, NAO_VINCULADO: { texto: 'Não vinculado' },
  NAO_APLICAVEL: { texto: 'Não se aplica' }, SEM_MOVIMENTO: { texto: 'Sem movimento' }, INATIVO: { texto: 'Inativo', tom: 'alerta' },
};

/** Aba Integrações: estado REAL de cada integração, calculado pelo servidor. */
export function AbaIntegracoes({ ficha }: { ficha: Ficha }) {
  const [itens, setItens] = useState<Array<{ chave: string; nome: string; estado: string; detalhe: string }>>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    setCarregando(true);
    fichaApi.integracoes(ficha.produto.id).then(setItens).catch((e) => setErro(mensagemDeErro(e))).finally(() => setCarregando(false));
  }, [ficha.produto.id, ficha.produto.updatedAt]);
  return (
    <Secao titulo="Integrações" descricao="Estado verificado no servidor. Nada aparece como funcionando se estiver só planejado.">
      {erro && <div className={estilos.espacoAbaixo}><Aviso tom="erro">{erro}</Aviso></div>}
      <Tabela
        linhas={itens} carregando={carregando} chave={(l) => l.chave}
        colunas={[
          { chave: 'nome', titulo: 'Integração', render: (l) => <strong>{l.nome}</strong> },
          { chave: 'estado', titulo: 'Estado', render: (l) => <Selo tom={ESTADO[l.estado]?.tom}>{ESTADO[l.estado]?.texto ?? l.estado}</Selo> },
          { chave: 'detalhe', titulo: 'Detalhe', render: (l) => l.detalhe },
        ]}
      />
    </Secao>
  );
}
