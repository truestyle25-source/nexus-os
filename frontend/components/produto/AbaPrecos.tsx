'use client';
import { useMemo, useState } from 'react';
import { Aviso, Botao, CampoSelecao, CampoTexto, Celula, Grade, Metrica, Secao, estilos } from './ui';
import type { FormProduto } from './formulario';
import { calcularPrecificacao, fmtNum, fmtPct, lerNumero, precoPorMargemLiquida, precoPorMarkup, type Catalogos, type Ficha } from '@/lib/produto-ficha';

type Props = {
  form: FormProduto; set: <K extends keyof FormProduto>(k: K, v: FormProduto[K]) => void; catalogos: Catalogos; ficha: Ficha;
  podeEditar: boolean; precisaJustificativa: boolean; justificativa: string; setJustificativa: (v: string) => void;
};

const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `R$ ${fmtNum(v)}`);
const textoNumero = (n: number) => String(n).replace('.', ',');

export default function AbaPrecos({ form, set, catalogos, ficha, podeEditar, precisaJustificativa, justificativa, setJustificativa }: Props) {
  const ed = podeEditar ? set : undefined;
  const podeVerCusto = ficha.podeVerCusto;
  const impostos = ficha.impostosSobreVendaPercentual;
  const r = useMemo(() => calcularPrecificacao({
    custo: lerNumero(form.custo) ?? 0, precoVenda: lerNumero(form.precoVenda) ?? 0, impostosPercentual: impostos,
    comissaoPercentual: lerNumero(form.comissaoPercentual) ?? 0, despesasPercentual: lerNumero(form.despesasPercentual) ?? 0,
    descontoMaximoPercentual: lerNumero(form.descontoMaximoPercentual),
  }), [form.custo, form.precoVenda, form.comissaoPercentual, form.despesasPercentual, form.descontoMaximoPercentual, impostos]);
  const [markupAlvo, setMarkupAlvo] = useState('');
  const [margemAlvo, setMargemAlvo] = useState('');
  const custo = lerNumero(form.custo) ?? 0;
  const precoMarkup = lerNumero(markupAlvo) != null ? precoPorMarkup(custo, lerNumero(markupAlvo)!) : null;
  const precoMargem = lerNumero(margemAlvo) != null ? precoPorMargemLiquida(custo, lerNumero(margemAlvo)!, r.deducoesPercentual) : null;
  const ultimo = ficha.produto.ultimoCustoAquisicao;

  return (
    <>
      {podeVerCusto && (
        <Secao titulo="Custos" descricao="O custo é mantido pela política escolhida a cada recebimento de compra.">
          <Grade>
            <CampoTexto l={3} rotulo="Preço de compra" valor={form.precoCompra} onChange={ed && ((v) => ed('precoCompra', v))} numero ajuda="Último valor pago, na unidade de compra" />
            <CampoTexto l={3} rotulo="Preço de custo (custo médio)" valor={form.custo} onChange={ed && ((v) => ed('custo', v))} numero ajuda="Base de markup, margem e CMV" />
            <CampoTexto l={3} rotulo="Último custo de aquisição" valor={ultimo == null ? '' : textoNumero(Number(ultimo))} numero somenteLeitura ajuda="Preenchido no recebimento da compra" />
            <CampoSelecao l={3} rotulo="Política de custo" valor={form.politicaCusto} onChange={ed && ((v) => ed('politicaCusto', v))}
              opcoes={[{ valor: 'MEDIO_PONDERADO', texto: 'Custo médio ponderado' }, { valor: 'ULTIMO_CUSTO', texto: 'Último custo' }, { valor: 'PADRAO', texto: 'Custo padrão (fixo)' }]} />
          </Grade>
        </Secao>
      )}

      <Secao titulo="Venda" descricao="Preço padrão da empresa. O preço de cada filial é configurado na aba Filial.">
        <Grade>
          <CampoTexto l={3} rotulo="Preço de venda" valor={form.precoVenda} onChange={ed && ((v) => ed('precoVenda', v))} numero />
          <CampoTexto l={3} rotulo="Tabela de preço A" valor={form.precoTabelaA} onChange={ed && ((v) => ed('precoTabelaA', v))} numero />
          <CampoTexto l={3} rotulo="Tabela de preço B" valor={form.precoTabelaB} onChange={ed && ((v) => ed('precoTabelaB', v))} numero />
          <CampoTexto l={3} rotulo="Tabela de preço C" valor={form.precoTabelaC} onChange={ed && ((v) => ed('precoTabelaC', v))} numero />
          <CampoTexto l={3} rotulo="Desconto máximo (%)" valor={form.descontoMaximoPercentual} onChange={ed && ((v) => ed('descontoMaximoPercentual', v))} numero />
          <CampoTexto l={3} rotulo="Comissão (%)" valor={form.comissaoPercentual} onChange={ed && ((v) => ed('comissaoPercentual', v))} numero />
          <CampoTexto l={3} rotulo="Despesas operacionais (%)" valor={form.despesasPercentual} onChange={ed && ((v) => ed('despesasPercentual', v))} numero ajuda="Rateio sobre o preço" />
          <CampoSelecao l={3} rotulo="Fornecedor principal" valor={form.fornecedorId} onChange={ed && ((v) => ed('fornecedorId', v))} vazio="—"
            opcoes={catalogos.fornecedores.map((f) => ({ valor: f.id, texto: f.nome }))} />
          {precisaJustificativa && (
            <CampoTexto l={12} rotulo="Justificativa da alteração de preço (obrigatória)" valor={justificativa} onChange={setJustificativa} maxLength={300}
              erro={justificativa.trim().length < 5 ? 'O preço cai mais de 10% ou fica abaixo do custo: informe o motivo (mín. 5 caracteres).' : undefined} />
          )}
        </Grade>
      </Secao>

      <Secao titulo="Promoção">
        <Grade>
          <CampoTexto l={3} rotulo="Preço promocional" valor={form.precoPromocional} onChange={ed && ((v) => ed('precoPromocional', v))} numero />
          <CampoTexto l={3} rotulo="Início" tipo="date" valor={form.promocaoInicio} onChange={ed && ((v) => ed('promocaoInicio', v))} />
          <CampoTexto l={3} rotulo="Fim" tipo="date" valor={form.promocaoFim} onChange={ed && ((v) => ed('promocaoFim', v))} />
          <CampoTexto l={3} rotulo="Limite de unidades" valor={form.promocaoLimite} onChange={ed && ((v) => ed('promocaoLimite', v))} numero inputMode="numeric" />
        </Grade>
      </Secao>

      {podeVerCusto ? (
        <Secao titulo="Resultado" descricao={`Markup é sobre o custo; margem é sobre o preço. Deduções sobre o preço: impostos ${fmtPct(impostos)} (aba Tributos) + comissão + despesas.`}>
          <MetricasPrecos r={r} />
          {r.abaixoDoCusto && <div className={estilos.espaco3}><Aviso tom="erro">O preço de venda está abaixo do custo.</Aviso></div>}
          <div className={estilos.espaco4}>
            <Grade>
              <CampoTexto l={3} rotulo="Simular markup (%)" valor={markupAlvo} onChange={setMarkupAlvo} numero ajuda={precoMarkup != null ? `Preço: ${brl(precoMarkup)}` : 'Preço = custo × (1 + markup)'} />
              {podeEditar && <Celula l={3} alinharCampo><Botao desabilitado={precoMarkup == null} onClick={() => precoMarkup != null && set('precoVenda', textoNumero(precoMarkup))}>Aplicar ao preço</Botao></Celula>}
              <CampoTexto l={3} rotulo="Simular margem líquida (%)" valor={margemAlvo} onChange={setMargemAlvo} numero ajuda={precoMargem != null ? `Preço: ${brl(precoMargem)}` : lerNumero(margemAlvo) != null ? 'Impossível: margem + deduções ≥ 100%' : 'Considera as deduções acima'} />
              {podeEditar && <Celula l={3} alinharCampo><Botao desabilitado={precoMargem == null} onClick={() => precoMargem != null && set('precoVenda', textoNumero(precoMargem))}>Aplicar ao preço</Botao></Celula>}
            </Grade>
          </div>
        </Secao>
      ) : (
        <Aviso>Margens e lucro dependem do custo, que exige a permissão custos.visualizar.</Aviso>
      )}
    </>
  );
}

function MetricasPrecos({ r }: { r: ReturnType<typeof calcularPrecificacao> }) {
  return (
    <div className={estilos.metricas}>
      <Metrica rotulo="Markup" valor={fmtPct(r.markupPercentual)} ajuda="(preço − custo) ÷ custo" />
      <Metrica rotulo="Margem bruta" valor={fmtPct(r.margemBrutaPercentual)} ajuda="(preço − custo) ÷ preço" />
      <Metrica rotulo="Lucro bruto" valor={brl(r.lucroBruto)} />
      <Metrica rotulo="Deduções" valor={brl(r.deducoesValor)} ajuda={fmtPct(r.deducoesPercentual)} />
      <Metrica rotulo="Lucro líquido" valor={brl(r.lucroLiquido)} />
      <Metrica rotulo="Margem líquida" valor={fmtPct(r.margemLiquidaPercentual)} />
      <Metrica rotulo="Preço mínimo" valor={brl(r.precoMinimoComDesconto)} ajuda={r.lucroLiquidoNoDescontoMaximo != null ? `Lucro no limite: ${brl(r.lucroLiquidoNoDescontoMaximo)}` : 'Sem desconto máximo'} />
    </div>
  );
}
