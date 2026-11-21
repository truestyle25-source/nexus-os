'use client';
import { useEffect, useState } from 'react';
import { Aviso, Botao, CampoArea, CampoSelecao, CampoTexto, Grade, Secao, Selo, estilos } from './ui';
import { CSOSN, CST_ICMS, CST_IPI, CST_PIS_COFINS, ORIGENS_MERCADORIA } from './formulario';
import { errosDeCampo, fichaApi, lerNumero, mensagemDeErro, type Ficha } from '@/lib/produto-ficha';

const TEXTO = ['ncm', 'cest', 'cfopEntrada', 'cfopSaida', 'cstIcms', 'csosn', 'cstPis', 'cstCofins', 'cstIpi', 'codigoEnquadramentoIpi', 'cstIbsCbs', 'classificacaoTributaria', 'naturezaOperacao', 'informacoesAdicionais'] as const;
const NUM = ['aliquotaIcms', 'reducaoBaseIcms', 'aliquotaPis', 'aliquotaCofins', 'aliquotaIpi', 'aliquotaIbs', 'aliquotaCbs'] as const;
type Form = Record<(typeof TEXTO)[number] | (typeof NUM)[number] | 'origemMercadoria', string>;

const REGIME: Record<string, string> = { SIMPLES_NACIONAL: 'Simples Nacional', SIMPLES_EXCESSO_SUBLIMITE: 'Simples — excesso de sublimite', REGIME_NORMAL: 'Regime normal (Lucro Presumido/Real)' };
const mascaraNcm = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length <= 4 ? d : d.length <= 6 ? `${d.slice(0, 4)}.${d.slice(4)}` : `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`; };
const opc = (lista: string[]) => lista.map((v) => ({ valor: v, texto: v }));

function inicial(f: Ficha): Form {
  const fi = f.produto.fiscal ?? {};
  const form = {} as Form;
  for (const c of TEXTO) form[c] = c === 'ncm' ? mascaraNcm(String(f.produto.ncm ?? '')) : String(fi[c] ?? '');
  for (const c of NUM) form[c] = fi[c] == null ? '' : String(Number(fi[c])).replace('.', ',');
  form.origemMercadoria = fi.origemMercadoria == null ? '' : String(fi.origemMercadoria);
  return form;
}

export default function AbaTributos({ ficha, podeEditar, aoSalvar, avisar, aoAlterar }: { ficha: Ficha; podeEditar: boolean; aoSalvar: () => Promise<void>; avisar: (m: string, erro?: boolean) => void; aoAlterar: (sujo: boolean) => void }) {
  const [form, setForm] = useState<Form>(() => inicial(ficha));
  const [original, setOriginal] = useState<Form>(() => inicial(ficha));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [avisos, setAvisos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const regime = ficha.regimeTributario;
  const simples = regime === 'SIMPLES_NACIONAL';
  const sujo = JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => { aoAlterar(sujo); }, [sujo, aoAlterar]);

  const set = (k: keyof Form) => (podeEditar ? (v: string) => { setForm((f) => ({ ...f, [k]: v })); setErros((e) => ({ ...e, [k]: '' })); } : undefined);

  async function salvar() {
    setSalvando(true); setErros({});
    const corpo: Record<string, unknown> = {};
    for (const c of TEXTO) corpo[c] = form[c].trim() || null;
    for (const c of NUM) corpo[c] = lerNumero(form[c]);
    corpo.origemMercadoria = form.origemMercadoria === '' ? null : Number(form.origemMercadoria);
    // Só envia o campo de ICMS que o regime usa.
    if (simples) corpo.cstIcms = null; else if (regime) corpo.csosn = null;
    try {
      const r = await fichaApi.fiscal(ficha.produto.id, corpo);
      setAvisos((r.avisos ?? []).map((a) => a.mensagem));
      setOriginal(form);
      await aoSalvar();
      avisar('Tributos salvos.');
    } catch (e) {
      const porCampo = errosDeCampo(e);
      setErros(porCampo);
      avisar(Object.keys(porCampo).length ? `${Object.keys(porCampo).length} campo(s) fiscal(is) inválido(s).` : mensagemDeErro(e), true);
    } finally { setSalvando(false); }
  }

  return (
    <>
      <Secao titulo="Enquadramento" descricao="O NEXUS OS valida o formato e a coerência com o regime; a escolha do CST e das alíquotas é da contabilidade."
        acoes={<>
          <Selo tom={regime ? 'ok' : 'alerta'}>{regime ? REGIME[regime] : 'Regime da empresa não informado'}</Selo>
          {podeEditar && <Botao primario desabilitado={!sujo || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar tributos'}</Botao>}
        </>}>
        {!regime && <div className={estilos.espacoAbaixo}><Aviso>Informe o regime tributário em Configurações → Empresa para o NEXUS OS conferir CST × CSOSN.</Aviso></div>}
        <Grade>
          <CampoTexto l={3} rotulo="NCM" valor={form.ncm} onChange={set('ncm') && ((v) => set('ncm')!(mascaraNcm(v)))} erro={erros.ncm} placeholder="0000.00.00" />
          <CampoTexto l={3} rotulo="CEST" valor={form.cest} onChange={set('cest')} erro={erros.cest} maxLength={9} />
          <CampoSelecao l={3} rotulo="Origem da mercadoria" valor={form.origemMercadoria} onChange={set('origemMercadoria')} vazio="—" erro={erros.origemMercadoria}
            opcoes={ORIGENS_MERCADORIA.map(([v, t]) => ({ valor: v, texto: t }))} />
          <CampoTexto l={3} rotulo="Natureza da operação" valor={form.naturezaOperacao} onChange={set('naturezaOperacao')} maxLength={120} />
          <CampoTexto l={3} rotulo="CFOP de entrada" valor={form.cfopEntrada} onChange={set('cfopEntrada')} erro={erros.cfopEntrada} maxLength={5} ajuda="Começa com 1, 2 ou 3" />
          <CampoTexto l={3} rotulo="CFOP de saída" valor={form.cfopSaida} onChange={set('cfopSaida')} erro={erros.cfopSaida} maxLength={5} ajuda="Começa com 5, 6 ou 7" />
        </Grade>
      </Secao>

      <Secao titulo="ICMS">
        <Grade>
          {simples || !regime ? (
            <CampoSelecao l={3} rotulo="CSOSN" valor={form.csosn} onChange={set('csosn')} vazio="—" opcoes={opc(CSOSN)} erro={erros.csosn} ajuda="Simples Nacional" />
          ) : null}
          {!simples ? (
            <CampoSelecao l={3} rotulo="CST ICMS" valor={form.cstIcms} onChange={set('cstIcms')} vazio="—" opcoes={opc(CST_ICMS)} erro={erros.cstIcms} ajuda="Regime normal" />
          ) : null}
          <CampoTexto l={3} rotulo="Alíquota ICMS (%)" valor={form.aliquotaIcms} onChange={set('aliquotaIcms')} numero erro={erros.aliquotaIcms} />
          <CampoTexto l={3} rotulo="Redução da base (%)" valor={form.reducaoBaseIcms} onChange={set('reducaoBaseIcms')} numero erro={erros.reducaoBaseIcms} />
        </Grade>
      </Secao>

      <Secao titulo="PIS e COFINS">
        <Grade>
          <CampoSelecao l={3} rotulo="CST PIS" valor={form.cstPis} onChange={set('cstPis')} vazio="—" opcoes={opc(CST_PIS_COFINS)} erro={erros.cstPis} />
          <CampoTexto l={3} rotulo="Alíquota PIS (%)" valor={form.aliquotaPis} onChange={set('aliquotaPis')} numero erro={erros.aliquotaPis} />
          <CampoSelecao l={3} rotulo="CST COFINS" valor={form.cstCofins} onChange={set('cstCofins')} vazio="—" opcoes={opc(CST_PIS_COFINS)} erro={erros.cstCofins} />
          <CampoTexto l={3} rotulo="Alíquota COFINS (%)" valor={form.aliquotaCofins} onChange={set('aliquotaCofins')} numero erro={erros.aliquotaCofins} />
        </Grade>
      </Secao>

      <Secao titulo="IPI">
        <Grade>
          <CampoSelecao l={3} rotulo="CST IPI" valor={form.cstIpi} onChange={set('cstIpi')} vazio="—" opcoes={opc(CST_IPI)} erro={erros.cstIpi} />
          <CampoTexto l={3} rotulo="Alíquota IPI (%)" valor={form.aliquotaIpi} onChange={set('aliquotaIpi')} numero erro={erros.aliquotaIpi} />
          <CampoTexto l={3} rotulo="Código de enquadramento" valor={form.codigoEnquadramentoIpi} onChange={set('codigoEnquadramentoIpi')} maxLength={3} erro={erros.codigoEnquadramentoIpi} />
        </Grade>
      </Secao>

      <Secao titulo="IBS e CBS (reforma tributária)" descricao="Campos da LC 214/2025. Alíquotas informadas pela contabilidade; nada é presumido.">
        <Grade>
          <CampoTexto l={3} rotulo="CST IBS/CBS" valor={form.cstIbsCbs} onChange={set('cstIbsCbs')} maxLength={3} erro={erros.cstIbsCbs} />
          <CampoTexto l={3} rotulo="Classificação (cClassTrib)" valor={form.classificacaoTributaria} onChange={set('classificacaoTributaria')} maxLength={6} erro={erros.classificacaoTributaria} />
          <CampoTexto l={3} rotulo="Alíquota IBS (%)" valor={form.aliquotaIbs} onChange={set('aliquotaIbs')} numero erro={erros.aliquotaIbs} />
          <CampoTexto l={3} rotulo="Alíquota CBS (%)" valor={form.aliquotaCbs} onChange={set('aliquotaCbs')} numero erro={erros.aliquotaCbs} />
          <CampoArea rotulo="Dados fiscais adicionais" valor={form.informacoesAdicionais} onChange={set('informacoesAdicionais')} maxLength={2000} />
        </Grade>
        {avisos.length > 0 && <div className={estilos.espaco3}><Aviso>{avisos.join(' ')}</Aviso></div>}
      </Secao>
    </>
  );
}
