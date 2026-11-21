'use client';
// Abas da ficha do fornecedor ligadas ao formulário principal (Salvar no topo grava todas).
import { useState } from 'react';
import { Alternador, Aviso, Botao, Campo, CampoArea, CampoSelecao, CampoTexto, Celula, Grade, Metrica, Secao, Selo, cx, estilos as s } from '@/components/produto/ui';
import { fmtData, fmtNum, mensagemDeErro } from '@/lib/produto-ficha';
import { fornecedorApi, mascararCep, soDigitos, type CatalogosFornecedor, type Endereco, type FichaFornecedor } from '@/lib/fornecedor-ficha';
import type { FormFornecedor } from './formulario';
import f from './fornecedor.module.css';

type Set = <K extends keyof FormFornecedor>(k: K, v: FormFornecedor[K]) => void;
interface Props { form: FormFornecedor; set: Set; ed: boolean; catalogos: CatalogosFornecedor; ficha: FichaFornecedor | null; avisar: (m: string, erro?: boolean) => void; erros?: Record<string, string> }

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const REGIMES = ['Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real', 'Isento / Não contribuinte'];
const opc = (l: string[]) => l.map((v) => ({ valor: v, texto: v }));
const on = (ed: boolean, fn: (v: string) => void) => (ed ? fn : undefined);

// ============================================================================ DADOS
export function AbaDados({ form, set, ed, catalogos, ficha, erros }: Props) {
  const r = ficha?.resumo;
  const recebe = ['Ativo', 'Crítico'].includes(form.status);
  return (
    <>
      <div className={f.tresColunas}>
        <Secao titulo="Dados cadastrais" descricao="Identificação e classificação do fornecedor.">
          <Grade>
            <CampoTexto l={6} rotulo="Inscrição estadual" valor={form.ieIsento ? 'ISENTO' : form.inscricaoEstadual} onChange={ed && !form.ieIsento ? (v) => set('inscricaoEstadual', v) : undefined} maxLength={30} />
            <CampoTexto l={6} rotulo="Inscrição municipal" valor={form.inscricaoMunicipal} onChange={on(ed, (v) => set('inscricaoMunicipal', v))} maxLength={30} />
            <Alternador l={12} rotulo="Inscrição estadual isenta" ligado={form.ieIsento} onChange={ed ? (v) => set('ieIsento', v) : undefined} />
            <CampoTexto l={6} rotulo="CNAE principal" valor={form.cnae} onChange={on(ed, (v) => set('cnae', v))} maxLength={12} placeholder="0000-0/00" erro={erros?.cnae} />
            <CampoTexto l={6} rotulo="Data de abertura" tipo="date" valor={form.dataAbertura} onChange={on(ed, (v) => set('dataAbertura', v))} />
            <CampoSelecao l={6} rotulo="Regime tributário" valor={form.regimeTributario} onChange={on(ed, (v) => set('regimeTributario', v))} vazio="—" opcoes={opc(REGIMES)} />
            <CampoSelecao l={6} rotulo="Categoria" valor={form.categoria} onChange={on(ed, (v) => set('categoria', v))} opcoes={opc([...new Set([...catalogos.categorias, form.categoria].filter(Boolean))])} />
            <CampoTexto l={12} rotulo="Segmento de atuação" valor={form.segmento} onChange={on(ed, (v) => set('segmento', v))} maxLength={80} />
          </Grade>
        </Secao>

        <Secao titulo="Contato principal" descricao="Outros contatos ficam na aba Contatos.">
          <Grade>
            <CampoTexto l={12} rotulo="Nome" valor={form.cpNome} onChange={on(ed, (v) => set('cpNome', v))} maxLength={120} erro={erros?.cpNome} />
            <CampoTexto l={6} rotulo="Departamento" valor={form.cpDepartamento} onChange={on(ed, (v) => set('cpDepartamento', v))} maxLength={80} />
            <CampoTexto l={6} rotulo="Cargo" valor={form.cpCargo} onChange={on(ed, (v) => set('cpCargo', v))} maxLength={80} />
            <CampoTexto l={6} rotulo="Telefone" valor={form.cpTelefone} onChange={on(ed, (v) => set('cpTelefone', v))} maxLength={30} inputMode="numeric" />
            <CampoTexto l={6} rotulo="Celular / WhatsApp" valor={form.cpWhatsapp || form.cpCelular} onChange={on(ed, (v) => { set('cpWhatsapp', v); set('cpCelular', v); })} maxLength={30} inputMode="numeric" />
            <CampoTexto l={12} rotulo="E-mail" tipo="email" valor={form.cpEmail} onChange={on(ed, (v) => set('cpEmail', v))} maxLength={160} />
            <CampoTexto l={12} rotulo="Site" valor={form.site} onChange={on(ed, (v) => set('site', v))} maxLength={160} />
            <CampoTexto l={6} rotulo="E-mail para pedidos" tipo="email" valor={form.emailPedidos} onChange={on(ed, (v) => set('emailPedidos', v))} maxLength={160} />
            <CampoTexto l={6} rotulo="E-mail para NF-e" tipo="email" valor={form.emailNfe} onChange={on(ed, (v) => set('emailNfe', v))} maxLength={160} />
          </Grade>
        </Secao>

        <Secao titulo="Situação e informações" descricao="Preenchido pelo sistema.">
          <Grade>
            <CampoTexto l={12} rotulo="Empresa vinculada" valor={ficha?.empresa.nome ?? catalogos.empresa?.nome ?? '—'} somenteLeitura />
            <CampoTexto l={6} rotulo="Data de cadastro" valor={ficha ? fmtData(ficha.auditoria.criadoEm, false) : 'Ao salvar'} somenteLeitura />
            <CampoTexto l={6} rotulo="Cadastrado por" valor={ficha?.auditoria.criadoPor ?? (ficha ? '—' : 'Você')} somenteLeitura />
            <Celula l={12}>
              <Aviso tom={recebe ? 'ok' : 'erro'}>
                {recebe ? `Fornecedor ${form.status.toLowerCase()} pode receber novos pedidos de compra.` : `Fornecedor ${form.status.toLowerCase()} não recebe novos pedidos de compra.`}
              </Aviso>
            </Celula>
          </Grade>
        </Secao>
      </div>

      {ficha && r && (
        <Secao titulo="Resumo do cadastro" descricao="Dados reais de Compras, Financeiro e Avaliação.">
          <div className={s.metricas}>
            <Metrica rotulo="Pedidos" valor={`${r.pedidos} pedido(s)`} ajuda={`${r.pedidosAbertos} em aberto`} />
            <Metrica rotulo="Títulos a pagar" valor={r.titulosAPagar ? `R$ ${fmtNum(r.titulosAPagar.valor)}` : '—'} ajuda={r.titulosAPagar ? `${r.titulosAPagar.quantidade} em aberto` : 'Exige financeiro.visualizar'} />
            <Metrica rotulo={`Total comprado (${r.ano})`} valor={`R$ ${fmtNum(r.totalCompradoAno)}`} />
            <Metrica rotulo="Nota do fornecedor" valor={r.notaMedia == null ? '—' : `${fmtNum(r.notaMedia, 1)} / 5`}
              ajuda={r.notaMedia == null ? 'Sem avaliações' : <span className={f.estrelas}>{'★'.repeat(Math.round(r.notaMedia))}{'☆'.repeat(5 - Math.round(r.notaMedia))}</span>} />
          </div>
        </Secao>
      )}
    </>
  );
}

// ============================================================================ ENDEREÇO
function BlocoEndereco({ valor, onChange, ed, avisar, erros }: { valor: Required<Endereco>; onChange: (e: Required<Endereco>) => void; ed: boolean; avisar: Props['avisar']; erros?: Record<string, string> }) {
  const [buscando, setBuscando] = useState(false);
  const m = (k: keyof Endereco, v: string) => onChange({ ...valor, [k]: v });
  async function buscar() {
    if (soDigitos(valor.cep).length !== 8) { avisar('Informe um CEP com 8 dígitos.', true); return; }
    setBuscando(true);
    try {
      const r = await fornecedorApi.cep(valor.cep);
      onChange({ ...valor, cep: mascararCep(r.cep), logradouro: r.logradouro || valor.logradouro, bairro: r.bairro || valor.bairro, cidade: r.cidade, uf: r.uf, codigoIbge: r.codigoIbge, complemento: valor.complemento || r.complemento });
      avisar('Endereço preenchido pelo CEP. Confira e complete o número.');
    } catch (e) { avisar(`${mensagemDeErro(e)} Você pode preencher o endereço manualmente.`, true); } finally { setBuscando(false); }
  }
  return (
    <Grade>
      <CampoTexto l={3} rotulo="CEP" valor={valor.cep} onChange={ed ? (v) => m('cep', mascararCep(v)) : undefined} inputMode="numeric" maxLength={9} placeholder="00000-000" erro={erros?.cep} />
      {ed && <Celula l={3} alinharCampo><Botao onClick={buscar} desabilitado={buscando}>{buscando ? 'Buscando…' : 'Buscar CEP'}</Botao></Celula>}
      <CampoTexto l={ed ? 6 : 8} rotulo="Logradouro" valor={valor.logradouro ?? ''} onChange={on(ed, (v) => m('logradouro', v))} maxLength={160} />
      <CampoTexto l={2} rotulo="Número" valor={valor.numero ?? ''} onChange={on(ed, (v) => m('numero', v))} maxLength={20} />
      <CampoTexto l={4} rotulo="Complemento" valor={valor.complemento ?? ''} onChange={on(ed, (v) => m('complemento', v))} maxLength={80} />
      <CampoTexto l={6} rotulo="Bairro" valor={valor.bairro ?? ''} onChange={on(ed, (v) => m('bairro', v))} maxLength={80} />
      <CampoTexto l={6} rotulo="Cidade" valor={valor.cidade ?? ''} onChange={on(ed, (v) => m('cidade', v))} maxLength={80} erro={erros?.cidade} />
      <CampoSelecao l={3} rotulo="UF" valor={(valor.uf ?? '').toUpperCase()} onChange={on(ed, (v) => m('uf', v))} vazio="—" opcoes={opc(UFS)} erro={erros?.uf} />
      <CampoTexto l={3} rotulo="Código IBGE" valor={valor.codigoIbge ?? ''} onChange={on(ed, (v) => m('codigoIbge', soDigitos(v)))} inputMode="numeric" maxLength={7} />
    </Grade>
  );
}

export function AbaEndereco({ form, set, ed, avisar, erros }: Props) {
  const principal: Required<Endereco> = { cep: form.cep, logradouro: form.logradouro, numero: form.numero, complemento: form.complemento, bairro: form.bairro, cidade: form.cidade, uf: form.uf, codigoIbge: form.codigoIbge };
  const mudaPrincipal = (e: Required<Endereco>) => {
    for (const k of Object.keys(e) as Array<keyof Endereco>) if (e[k] !== principal[k]) set(k as keyof FormFornecedor, e[k] as never);
  };
  return (
    <>
      <Secao titulo="Endereço principal" descricao="O CEP preenche o endereço pelo ViaCEP; todos os campos podem ser editados.">
        <BlocoEndereco valor={principal} onChange={mudaPrincipal} ed={ed} avisar={avisar} erros={erros} />
        <div className={s.espaco3}>
          <Grade><CampoTexto l={3} rotulo="País" valor={form.pais} onChange={on(ed, (v) => set('pais', v))} maxLength={60} /></Grade>
        </div>
      </Secao>
      <Secao titulo="Endereço de cobrança" acoes={<Alternador l={12} rotulo="Diferente do principal" ligado={form.cobrancaDiferente} onChange={ed ? (v) => set('cobrancaDiferente', v) : undefined} />}>
        {form.cobrancaDiferente ? <BlocoEndereco valor={form.cobranca} onChange={(e) => set('cobranca', e)} ed={ed} avisar={avisar} /> : <Aviso>A cobrança usa o endereço principal.</Aviso>}
      </Secao>
      <Secao titulo="Endereço alternativo" descricao="Entrega, depósito ou outro local, quando necessário." acoes={<Alternador l={12} rotulo="Usar endereço alternativo" ligado={form.alternativoAtivo} onChange={ed ? (v) => set('alternativoAtivo', v) : undefined} />}>
        {form.alternativoAtivo ? <BlocoEndereco valor={form.alternativo} onChange={(e) => set('alternativo', e)} ed={ed} avisar={avisar} /> : <Aviso>Nenhum endereço alternativo.</Aviso>}
      </Secao>
    </>
  );
}

// ============================================================================ FINANCEIRO
export function AbaFinanceiro({ form, set, ed, ficha, catalogos }: Props) {
  const podeBanco = ficha ? ficha.podeVerBancario : catalogos.podeVerBancario;
  const edBanco = ed && podeBanco;
  return (
    <>
      <Secao titulo="Pagamento" descricao="Condição e forma padrão dos pedidos deste fornecedor.">
        <Grade>
          <CampoSelecao l={3} rotulo="Condição de pagamento" valor={form.condicaoPagamento} onChange={on(ed, (v) => set('condicaoPagamento', v))} vazio="—" opcoes={opc(['À vista', '7 dias', '14 dias', '21 dias', '28 dias', '30 dias', '30/60', '30/60/90', '45 dias', '60 dias'])} />
          <CampoSelecao l={3} rotulo="Forma de pagamento" valor={form.formaPagamento} onChange={on(ed, (v) => set('formaPagamento', v))} vazio="—" opcoes={[{ valor: 'BOLETO', texto: 'Boleto' }, { valor: 'PIX', texto: 'PIX' }, { valor: 'TRANSFERENCIA', texto: 'Transferência bancária' }, { valor: 'CARTAO', texto: 'Cartão' }]} />
          <CampoTexto l={3} rotulo="Limite de crédito (R$)" valor={form.limiteCredito} onChange={on(ed, (v) => set('limiteCredito', v))} numero />
          <CampoTexto l={3} rotulo="Natureza financeira" valor={form.naturezaFinanceira} onChange={on(ed, (v) => set('naturezaFinanceira', v))} maxLength={60} />
          <CampoTexto l={3} rotulo="Plano de contas" valor={form.planoContas} onChange={on(ed, (v) => set('planoContas', v))} maxLength={60} />
          <CampoTexto l={3} rotulo="Centro de custo" valor={form.centroCusto} onChange={on(ed, (v) => set('centroCusto', v))} maxLength={60} />
        </Grade>
      </Secao>
      <Secao titulo="Dados bancários e PIX" descricao="Acesso restrito: ver e alterar exige a permissão fornecedores.administrar. Toda alteração fica na auditoria (sem o valor).">
        {!podeBanco && <div className={s.espacoAbaixo}><Aviso>Dados bancários mascarados. Você não tem a permissão fornecedores.administrar.</Aviso></div>}
        <Grade>
          <CampoSelecao l={4} rotulo="Tipo da chave PIX" valor={form.tipoChavePix} onChange={on(edBanco, (v) => set('tipoChavePix', v))} vazio="—" opcoes={[{ valor: 'CNPJ', texto: 'CNPJ' }, { valor: 'CPF', texto: 'CPF' }, { valor: 'EMAIL', texto: 'E-mail' }, { valor: 'TELEFONE', texto: 'Telefone' }, { valor: 'ALEATORIA', texto: 'Aleatória' }]} />
          <CampoTexto l={8} rotulo="Chave PIX" valor={form.chavePix} onChange={on(edBanco, (v) => set('chavePix', v))} maxLength={140} />
          <CampoTexto l={4} rotulo="Banco" valor={form.banco} onChange={on(edBanco, (v) => set('banco', v))} maxLength={80} />
          <CampoTexto l={2} rotulo="Código do banco" valor={form.codigoBanco} onChange={on(edBanco, (v) => set('codigoBanco', soDigitos(v).slice(0, 3)))} inputMode="numeric" maxLength={3} />
          <CampoTexto l={2} rotulo="Agência" valor={form.agencia} onChange={on(edBanco, (v) => set('agencia', v))} maxLength={10} />
          <CampoTexto l={2} rotulo="Conta" valor={form.conta} onChange={on(edBanco, (v) => set('conta', v))} maxLength={20} />
          <CampoTexto l={2} rotulo="Dígito" valor={form.contaDigito} onChange={on(edBanco, (v) => set('contaDigito', v))} maxLength={2} />
          <CampoSelecao l={3} rotulo="Tipo de conta" valor={form.tipoConta} onChange={on(edBanco, (v) => set('tipoConta', v))} vazio="—" opcoes={[{ valor: 'CORRENTE', texto: 'Corrente' }, { valor: 'POUPANCA', texto: 'Poupança' }, { valor: 'PAGAMENTO', texto: 'Pagamento' }]} />
          <CampoTexto l={6} rotulo="Titular" valor={form.titular} onChange={on(edBanco, (v) => set('titular', v))} maxLength={160} />
          <CampoTexto l={3} rotulo="CPF/CNPJ do titular" valor={form.titularDocumento} onChange={on(edBanco, (v) => set('titularDocumento', v))} maxLength={20} />
        </Grade>
      </Secao>
    </>
  );
}

// ============================================================================ FISCAL
const TRI = [{ valor: 'sim', texto: 'Sim' }, { valor: 'nao', texto: 'Não' }];
export function AbaFiscal({ form, set, ed }: Props) {
  return (
    <>
      <Secao titulo="Enquadramento" descricao="Informativo: nenhum cálculo fiscal é feito a partir destes campos; as regras de cada nota seguem o cadastro fiscal dos produtos.">
        <Grade>
          <CampoSelecao l={3} rotulo="Contribuinte de ICMS" valor={form.contribuinteIcms} onChange={on(ed, (v) => set('contribuinteIcms', v))} vazio="Não informado" opcoes={TRI} />
          <CampoSelecao l={3} rotulo="Optante pelo Simples Nacional" valor={form.optanteSimples} onChange={on(ed, (v) => set('optanteSimples', v))} vazio="Não informado" opcoes={TRI} />
          <CampoSelecao l={3} rotulo="Regime tributário" valor={form.regimeTributario} onChange={on(ed, (v) => set('regimeTributario', v))} vazio="—" opcoes={opc(REGIMES)} />
          <CampoTexto l={3} rotulo="CFOP padrão de entrada" valor={form.cfopEntrada} onChange={on(ed, (v) => set('cfopEntrada', v))} maxLength={5} inputMode="numeric" placeholder="1102" />
        </Grade>
      </Secao>
      <Secao titulo="Retenções aplicáveis" descricao="Marque as retenções que se aplicam aos pagamentos deste fornecedor.">
        <Grade>
          {([['retemIrrf', 'IRRF'], ['retemPis', 'PIS'], ['retemCofins', 'COFINS'], ['retemCsll', 'CSLL'], ['retemIss', 'ISS'], ['retemInss', 'INSS']] as const).map(([k, r]) => (
            <Alternador key={k} l={2} rotulo={r} ligado={form[k]} onChange={ed ? (v) => set(k, v) : undefined} />
          ))}
        </Grade>
      </Secao>
      <Secao titulo="Observações fiscais">
        <Grade><CampoArea rotulo="Observações fiscais" valor={form.observacoesFiscais} onChange={on(ed, (v) => set('observacoesFiscais', v))} maxLength={1000} /></Grade>
      </Secao>
    </>
  );
}

// ============================================================================ COMPRAS E LOGÍSTICA
export function AbaCompras({ form, set, ed, catalogos }: Props) {
  return (
    <>
      <Secao titulo="Condições de compra" descricao="Usadas pelo módulo Compras e pelos indicadores de pontualidade da aba Avaliação.">
        <Grade>
          <CampoTexto l={3} rotulo="Prazo médio de entrega (dias)" valor={form.prazoEntregaDias} onChange={on(ed, (v) => set('prazoEntregaDias', soDigitos(v)))} numero inputMode="numeric" />
          <CampoTexto l={3} rotulo="Pedido mínimo (R$)" valor={form.pedidoMinimo} onChange={on(ed, (v) => set('pedidoMinimo', v))} numero />
          <Campo rotulo="Modalidade de frete" l={3}>
            {() => (
              <div className={f.opcoes} role="radiogroup" aria-label="Modalidade de frete">
                {(['CIF', 'FOB'] as const).map((m) => (
                  <label key={m} className={cx(f.opcao, form.modalidadeFrete === m && f.opcaoAtiva)} title={m === 'CIF' ? 'Frete por conta do fornecedor' : 'Frete por conta do comprador'}>
                    <input type="radio" name="frete" checked={form.modalidadeFrete === m} disabled={!ed} onChange={() => set('modalidadeFrete', m)} /> {m}
                  </label>
                ))}
              </div>
            )}
          </Campo>
          <CampoSelecao l={3} rotulo="Comprador responsável" valor={form.compradorId} onChange={on(ed, (v) => set('compradorId', v))} vazio="—" opcoes={catalogos.compradores.map((u) => ({ valor: u.id, texto: u.nome }))} />
          <CampoTexto l={6} rotulo="Transportadora padrão" valor={form.transportadora} onChange={on(ed, (v) => set('transportadora', v))} maxLength={120} />
          <CampoArea rotulo="Condições comerciais" valor={form.condicoesComerciais} onChange={on(ed, (v) => set('condicoesComerciais', v))} maxLength={1000} />
          <CampoArea rotulo="Observações logísticas" valor={form.observacoesLogisticas} onChange={on(ed, (v) => set('observacoesLogisticas', v))} maxLength={1000} />
        </Grade>
      </Secao>
    </>
  );
}

// ============================================================================ OBSERVAÇÕES
export function AbaObservacoes({ form, set, ed }: Props) {
  return (
    <Secao titulo="Observações internas" descricao="Uso interno da empresa. Nunca são enviadas ao fornecedor.">
      <Grade>
        <CampoArea l={6} rotulo="Observações gerais" valor={form.observacoes} onChange={on(ed, (v) => set('observacoes', v))} maxLength={4000} />
        <CampoArea l={6} rotulo="Informações comerciais" valor={form.infoComerciais} onChange={on(ed, (v) => set('infoComerciais', v))} maxLength={4000} />
        <CampoArea l={6} rotulo="Restrições de atendimento" valor={form.restricoesAtendimento} onChange={on(ed, (v) => set('restricoesAtendimento', v))} maxLength={4000} />
        <CampoArea l={6} rotulo="Orientações para compradores" valor={form.orientacoesCompradores} onChange={on(ed, (v) => set('orientacoesCompradores', v))} maxLength={4000} />
      </Grade>
    </Secao>
  );
}

export { Selo };
