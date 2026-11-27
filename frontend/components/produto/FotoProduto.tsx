'use client';
/**
 * Bloco "Foto do produto" da aba PDV (NEXUS CLUB, F-Foto).
 * Substitui só o antigo campo "Imagem do produto (URL)": enviar/trocar/remover a foto
 * (arrastar e soltar; no celular abre câmera ou galeria) e, como alternativa, o link.
 * A foto vai direto para o servidor (POST/DELETE /produtos/:id/imagem), que confere
 * o conteúdo, tira os metadados e gera os tamanhos. O link continua no formulário da ficha.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Botao, CampoTexto, estilos } from './ui';
import { fichaApi, mensagemDeErro, type Ficha } from '@/lib/produto-ficha';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const LIMITE = 5 * 1024 * 1024;

function paraBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

export function FotoProduto({ ficha, link, onLink, podeEditar, onMudou }: {
  ficha: Ficha; link: string; onLink?: (v: string) => void; podeEditar: boolean; onMudou: () => Promise<unknown> | void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhida, setEscolhida] = useState<{ arquivo: File; previa: string } | null>(null);
  const [mostrarLink, setMostrarLink] = useState(!ficha.temFotoEnviada && !!link);
  const [arrastando, setArrastando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);

  useEffect(() => () => { if (escolhida) URL.revokeObjectURL(escolhida.previa); }, [escolhida]);

  const linkValido = /^https?:\/\//i.test(link);
  const enviada = ficha.foto?.detalhe ?? null;
  const mostrada = escolhida?.previa ?? enviada ?? (linkValido ? link : null);

  const escolher = (arquivo: File | undefined) => {
    setAviso(null);
    if (!arquivo) return;
    if (!TIPOS.includes(arquivo.type)) { setAviso({ tom: 'erro', texto: 'Envie uma foto em JPG, PNG ou WEBP.' }); return; }
    if (arquivo.size > LIMITE) { setAviso({ tom: 'erro', texto: 'A foto passa de 5 MB. Envie uma foto menor.' }); return; }
    setEscolhida({ arquivo, previa: URL.createObjectURL(arquivo) });
  };

  const salvar = async () => {
    if (!escolhida) return;
    setOcupado(true); setAviso(null);
    try {
      await fichaApi.enviarFoto(ficha.produto.id, { nome: escolhida.arquivo.name, base64: await paraBase64(escolhida.arquivo) });
      setEscolhida(null);
      await onMudou();
      setAviso({ tom: 'ok', texto: 'Foto salva.' });
    } catch (e) { setAviso({ tom: 'erro', texto: mensagemDeErro(e) }); } finally { setOcupado(false); }
  };

  const remover = async () => {
    setAviso(null);
    if (escolhida) { setEscolhida(null); return; }
    if (!ficha.temFotoEnviada) { onLink?.(''); return; }
    if (!window.confirm('Remover a foto deste produto?')) return;
    setOcupado(true);
    try { await fichaApi.removerFoto(ficha.produto.id); await onMudou(); setAviso({ tom: 'ok', texto: 'Foto removida.' }); }
    catch (e) { setAviso({ tom: 'erro', texto: mensagemDeErro(e) }); } finally { setOcupado(false); }
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setArrastando(false);
    if (podeEditar && !ocupado) escolher(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={`${estilos.c12} ${estilos.foto}`} onDragOver={(e) => { e.preventDefault(); if (podeEditar) setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={soltar}>
      <div className={estilos.fotoPrevia}>
        {mostrada ? <img src={mostrada} alt={`Foto de ${ficha.produto.nome}`} /> : <span className={estilos.ajuda}>Sem foto</span>}
      </div>
      <div className={estilos.fotoCorpo}>
        <div className={estilos.fotoTitulo}>Foto do produto</div>
        <div className={estilos.ajuda}>
          Usada no catálogo do PDV, nas promoções e no NEXUS CLUB (catálogo e loja).<br />
          JPG, PNG ou WEBP · até 5 MB · recomendado 600×600 px. A foto é ajustada para quadrado e otimizada automaticamente.
        </div>
        {podeEditar && (
          <div className={estilos.fotoAcoes}>
            {escolhida ? (
              <>
                <Botao primario onClick={salvar} desabilitado={ocupado}>{ocupado ? 'Salvando…' : 'Salvar foto'}</Botao>
                <Botao onClick={() => entrada.current?.click()} desabilitado={ocupado}>Escolher outra</Botao>
                <Botao onClick={remover} desabilitado={ocupado}>Cancelar</Botao>
              </>
            ) : (
              <>
                <Botao primario onClick={() => entrada.current?.click()} desabilitado={ocupado}>📷 {mostrada ? 'Trocar foto' : 'Enviar foto'}</Botao>
                {(ficha.temFotoEnviada || linkValido) && <Botao perigo onClick={remover} desabilitado={ocupado}>🗑 Remover</Botao>}
                <Botao onClick={() => setMostrarLink((v) => !v)} desabilitado={ocupado}>🔗 Usar link (URL)</Botao>
              </>
            )}
            <input ref={entrada} type="file" accept={TIPOS.join(',')} hidden onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}
        {podeEditar && (
          <div className={`${estilos.fotoSoltar} ${arrastando ? estilos.fotoSoltarAtivo : ''}`}>
            {escolhida
              ? 'Prévia da foto escolhida. Ela só é gravada quando você clicar em "Salvar foto".'
              : `Arraste uma imagem aqui ou toque em "${mostrada ? 'Trocar foto' : 'Enviar foto'}" (no celular abre a câmera ou a galeria). A prévia aparece antes de salvar.`}
          </div>
        )}
        {aviso && <div className={aviso.tom === 'erro' ? estilos.erroTexto : estilos.ajuda} role="status">{aviso.texto}</div>}
        {mostrarLink && (
          <CampoTexto l={12} rotulo="Imagem do produto (URL)" valor={link} onChange={onLink} placeholder="https://…"
            ajuda={ficha.temFotoEnviada ? 'A foto enviada tem prioridade sobre o link. Remova a foto para usar o link.' : 'Salvo com o botão Salvar da ficha.'} />
        )}
        <div className={estilos.fotoTamanhos}><span>miniatura 160 px</span><span>lista 400 px</span><span>detalhe 1000 px</span></div>
      </div>
    </div>
  );
}
