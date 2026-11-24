"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Mic,
  Waves,
  ArrowUp,
  MessageSquare,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wallet,
  LogOut,
  Zap,
  MicOff,
  Search,
  X,
  Keyboard,
  PhoneOff,
  Volume2,
  VolumeX,
  Sparkles,
  History,
  Brain,
  BookOpen,
  ShieldCheck,
  AlertTriangle,
  Bell,
  ClipboardCheck,
} from "lucide-react";
import api, { getToken } from "@/lib/api";
import { mensagemDeErroApi } from "@/lib/erros-api";
import { formatDateTime } from "@/lib/format";
import { nexusAi, NOME_FERRAMENTA, novaChaveIA, limparTextoIA, type ResultadoIA } from "@/lib/nexus-ai";
import { DocumentosEmpresa, MemoriaEmpresa } from "@/components/nexus-ai/Conhecimento";
import { Aprovacoes, Automacoes, Inteligencia } from "@/components/nexus-ai/Automacoes";
import { AvaliarResposta } from "@/components/nexus-ai/AvaliarResposta";

type Message = { id: string; role: "user" | "assistant"; text: string; erro?: boolean; detalhes?: ResultadoIA["detalhes"]; execucaoId?: string | null; status?: string };
type Painel = null | "historico" | "memoria" | "documentos" | "inteligencia" | "aprovacoes" | "automacoes";

/** Selo de verificação e fontes (NEXUS AI): números conferidos com os dados das ferramentas. */
function Verificacao({ d }: { d: ResultadoIA["detalhes"] | undefined }) {
  if (!d) return null;
  const v = d.verificacao;
  const fontes = [...new Set(d.fontes.map((f) => NOME_FERRAMENTA[f.ferramenta] ?? f.ferramenta))];
  return (
    <div style={{ marginTop: 8, fontSize: 11, color: "var(--nx-ink-3)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {v && (v.aprovada
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--nx-success, #22c55e)" }}><ShieldCheck size={12} />{v.numeros.length} número(s) conferido(s) com os dados</span>
        : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--nx-warning, #f59e0b)" }}><AlertTriangle size={12} />Números não confirmados: {v.divergentes.join(", ")}</span>)}
      {fontes.length > 0 && <span>Fontes: {fontes.join(" · ")}</span>}
    </div>
  );
}
type Origem = "texto" | "audio" | "modo_voz";

/** Frases curtas que a ATMA diz enquanto analisa (tocam na hora: o áudio já vem preparado). */
const AVISOS_ATMA = ["Deixa eu analisar isso para você.", "Um instante, estou consultando seus dados.", "Certo, vou verificar agora."];

/**
 * No modo voz, fala só o começo de uma resposta longa (a resposta completa fica escrita na
 * tela). O backend já pede respostas curtas por voz; isto é a garantia.
 */
function resumoParaFala(texto: string, limite = 320): string {
  if (texto.length <= limite) return texto;
  const frases = texto.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [texto];
  let falado = "";
  for (const f of frases) { if ((falado + f).length > limite && falado) break; falado += f; }
  return `${falado.trim()} Os detalhes estão na tela.`;
}

/** Identidade da ATMA, a essência inteligente do NEXUS OS. */
const CUMPRIMENTO_ATMA = "Olá! Que bom ter você por aqui. Sou a ATMA. O que vamos fazer hoje?";

/**
 * Voz reserva (quando a voz neural do servidor não responde): prefere uma voz FEMININA em
 * português do Brasil disponível no aparelho, para a ATMA não virar uma voz masculina ou robótica.
 */
const VOZES_FEMININAS_PT = /thalita|francisca|maria|luciana|vit[oó]ria|leticia|let[ií]cia|helena|camila|fernanda|joana|raquel|google português do brasil/i;
function vozReservaDaAtma(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const pt = voices.filter((v) => v.lang === "pt-BR" || v.lang.toLowerCase().startsWith("pt"));
  return pt.find((v) => v.lang === "pt-BR" && VOZES_FEMININAS_PT.test(v.name)) || pt.find((v) => VOZES_FEMININAS_PT.test(v.name)) || pt.find((v) => v.lang === "pt-BR") || pt[0] || null;
}

const shortcuts = ["Quanto vendi hoje?", "Estoque baixo?", "Resumo financeiro"];
const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, route: "/" },
  { id: "pdv", label: "PDV", icon: ShoppingCart, route: "/pdv" },
  { id: "estoque", label: "Estoque", icon: Package, route: "/estoque" },
  { id: "financeiro", label: "Financeiro", icon: Wallet, route: "/financeiro" },
];

function Sandwich({ open }: { open: boolean }) {
  return (
    <div style={{ width: 18, height: 14, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
      <span
        style={{
          display: "block",
          height: 2,
          width: "100%",
          background: "currentColor",
          borderRadius: 999,
          transition: "all .3s",
          transform: open ? "rotate(45deg) translateY(3.5px)" : "none",
        }}
      />
      <span
        style={{
          display: "block",
          height: 2,
          width: "100%",
          background: "currentColor",
          borderRadius: 999,
          transition: "all .3s",
          transform: open ? "rotate(-45deg) translateY(-3.5px)" : "none",
        }}
      />
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  // Conversa no servidor (NEXUS AI): o histórico fica guardado e pode ser reaberto.
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [conversas, setConversas] = useState<{ id: string; titulo: string; updatedAt: string }[] | null>(null);

  // Busca da lista "Recentes". Ela filtra as mensagens DESTA SESSÃO (as únicas
  // que existem na tela): o campo antes era decorativo — sem `value`, sem
  // `onChange` e sem filtro — e o texto ao lado afirmava que o histórico era
  // "preservado localmente", o que nunca foi verdade (as mensagens vivem só no
  // useState e somem ao recarregar).
  const [buscaConversa, setBuscaConversa] = useState("");

  // 1. Estado do Modo Voz
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const isVoiceModeRef = useRef(false);
  useEffect(() => {
    isVoiceModeRef.current = isVoiceMode;
  }, [isVoiceMode]);

  const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [voiceUserTranscript, setVoiceUserTranscript] = useState("");
  const [voiceAiTranscript, setVoiceAiTranscript] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  /**
   * Perguntas do usuário desta sessão, filtradas pela busca, mais recentes
   * primeiro. É a lista que o campo de busca filtra de verdade — antes o input
   * não tinha valor, nem onChange, nem filtro: digitar não produzia efeito.
   */
  const recentes = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .filter((m) => !buscaConversa.trim() || m.text.toLowerCase().includes(buscaConversa.trim().toLowerCase()))
        .slice(-5)
        .reverse(),
    [messages, buscaConversa],
  );

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopAnyAudio = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch {}
      currentAudioRef.current = null;
    }
  };

  // Áudio da voz neural da ATMA (servidor). Reutilizado pela fala e pelos avisos.
  const obterAudioTTS = async (texto: string): Promise<Blob> => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("nexus_api_url")?.trim() : "";
    let baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";
    if (stored) {
      try {
        const u = new URL(stored);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.origin !== window.location.origin) baseUrl = u.origin;
      } catch {}
    }
    const token = getToken();
    const response = await fetch(`${baseUrl}/api/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text: texto }),
    });
    if (!response.ok) throw new Error("TTS HTTP " + response.status);
    return response.blob();
  };

  // Aviso curto enquanto a ATMA analisa (a pergunta pode levar alguns segundos). Os áudios são
  // preparados ao abrir o modo voz, então tocam na hora; ao terminar, NÃO reabre o microfone.
  const avisosRef = useRef<string[]>([]);
  const avisoIndiceRef = useRef(0);
  const avisoTocandoRef = useRef<Promise<void> | null>(null);
  const prepararAvisos = () => {
    if (avisosRef.current.length) return;
    void Promise.all(AVISOS_ATMA.map((t) => obterAudioTTS(t).then((b) => URL.createObjectURL(b)).catch(() => null)))
      .then((urls) => { avisosRef.current = urls.filter((u): u is string => !!u); });
  };
  const tocarAviso = () => {
    const lista = avisosRef.current;
    if (!lista.length || !isVoiceModeRef.current) return;
    const audio = new Audio(lista[avisoIndiceRef.current++ % lista.length]);
    currentAudioRef.current = audio;
    avisoTocandoRef.current = new Promise<void>((fim) => {
      audio.onended = () => fim();
      audio.onerror = () => fim();
      setTimeout(fim, 4000);
    }).finally(() => { avisoTocandoRef.current = null; });
    void audio.play().catch(() => undefined);
  };

  // Voz da ATMA: voz neural do servidor (Edge TTS, Thalita calma); reserva: voz feminina do navegador
  const speak = async (texto: string) => {
    if (!texto) return;

    // Deixa o aviso "estou analisando" terminar antes de responder (no máximo 4 s).
    if (avisoTocandoRef.current) await avisoTocandoRef.current;
    // Para qualquer áudio antigo
    stopAnyAudio();

    const cleanText = texto
      .replace(/[*#_`~>]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) return;

    try {
      const blob = await obterAudioTTS(cleanText);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        if (isVoiceModeRef.current) {
          setVoiceStatus("listening");
          startListening();
        } else {
          setVoiceStatus("idle");
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        if (isVoiceModeRef.current) {
          setVoiceStatus("listening");
          startListening();
        } else {
          setVoiceStatus("idle");
        }
      };

      // SÓ TOCA SE FOR MODO VOZ
      if (isVoiceModeRef.current) {
        setVoiceStatus("speaking");
        await audio.play();
      }
    } catch (e) {
      console.warn("Edge TTS fallback para voz do navegador:", e);
      // Fallback grátis se der erro — usa Google/navegador pt-BR
      if (typeof window !== "undefined" && "speechSynthesis" in window && isVoiceModeRef.current) {
        const u = new SpeechSynthesisUtterance(cleanText);
        u.lang = "pt-BR";
        u.voice = vozReservaDaAtma(window.speechSynthesis.getVoices());
        u.rate = 0.96; // natural e moderada, como a voz principal da ATMA
        u.pitch = 0.95; // levemente mais grave: evita a voz aguda

        u.onend = () => {
          if (isVoiceModeRef.current) {
            setVoiceStatus("listening");
            startListening();
          } else {
            setVoiceStatus("idle");
          }
        };

        u.onerror = () => {
          if (isVoiceModeRef.current) {
            setVoiceStatus("listening");
            startListening();
          } else {
            setVoiceStatus("idle");
          }
        };

        setVoiceStatus("speaking");
        window.speechSynthesis.speak(u);
      }
    }
  };

  const startListening = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.abort();
    } catch {}
    try {
      recognitionRef.current.start();
      setIsRecording(true);
      if (isVoiceModeRef.current) {
        setVoiceStatus("listening");
      }
    } catch (e) {
      console.warn("Speech recognition start warning:", e);
    }
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {}
    setIsRecording(false);
  };

  const atmaCumprimentouRef = useRef(false);

  // 2. TOGGLE DO MODO VOZ (Botão azul Waves)
  const enterVoiceMode = () => {
    stopAnyAudio();
    setIsVoiceMode(true);
    isVoiceModeRef.current = true;
    setVoiceStatus("listening");
    setVoiceUserTranscript("");
    setVoiceAiTranscript("");
    prepararAvisos();
    // A ATMA se apresenta na primeira vez que o modo voz é aberto nesta sessão;
    // ao terminar de falar, o speak() já volta a ouvir.
    if (!atmaCumprimentouRef.current) {
      atmaCumprimentouRef.current = true;
      setVoiceAiTranscript(CUMPRIMENTO_ATMA);
      void speak(CUMPRIMENTO_ATMA);
      return;
    }
    setTimeout(() => {
      startListening();
    }, 120);
  };

  const exitVoiceMode = () => {
    stopAnyAudio();
    stopListening();
    setIsVoiceMode(false);
    isVoiceModeRef.current = false;
    setVoiceStatus("idle");
  };

  useEffect(() => {
    if (!getToken()) {
      router.replace("/");
      return;
    }
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);

    // Configuração do reconhecimento de fala
    const w: any = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = "pt-BR";
      rec.continuous = false;
      rec.interimResults = false;

      rec.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        setInput("");
        setIsRecording(false);

        if (isVoiceModeRef.current) {
          setVoiceUserTranscript(transcript);
          setVoiceStatus("thinking");
          // 3. MODO VOZ -> envia como 'modo_voz' (fala a resposta)
          void handleSendMessage(transcript, "modo_voz");
        } else {
          // 2. ÁUDIO SOLTO -> envia como 'audio' (NÃO FALA, apenas texto!)
          void handleSendMessage(transcript, "audio");
        }
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      rec.onerror = (e: any) => {
        console.warn("Speech recognition error:", e);
        setIsRecording(false);
        if (isVoiceModeRef.current) {
          setVoiceStatus("idle");
        }
      };

      recognitionRef.current = rec;
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // REGRA DA META:
  // 1. texto -> apenas texto
  // 2. audio solto -> apenas texto
  // 3. modo_voz (botão azul) -> fala com voz neural humana grátis
  const handleSendMessage = async (textToSend: string, origem: Origem) => {
    const text = textToSend.trim();
    if (!text || isTyping) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", text };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setIsTyping(true);

    if (isVoiceModeRef.current) {
      setVoiceUserTranscript(text);
      setVoiceStatus("thinking");
    }

    try {
      // NEXUS BRAIN: consulta os especialistas com ferramentas tipadas e verifica os números.
      // Por voz: resposta curta e, se a pergunta for de uma área só, direto ao especialista (mais rápido).
      const porVoz = origem === "modo_voz" && isVoiceModeRef.current;
      if (porVoz) tocarAviso();
      const data = await nexusAi.perguntar({ pergunta: text, agente: "nexus", conversaId: conversaId ?? undefined, idempotencyKey: novaChaveIA(), modo: porVoz ? "voz" : "texto" });
      if (data.conversaId) setConversaId(data.conversaId);
      const respostaText = limparTextoIA(String(data.resposta || "").trim()) || "A IA não retornou resposta para esta pergunta.";

      // `fallback: true` significa que o MODELO NÃO FOI CONSULTADO. O backend
      // devolve 200 com um texto de aviso quando `GEMINI_API_KEY` não está
      // configurada, e a tela ignorava essa marca: o gestor lia "Olá! Sou a IA
      // da NEXUS OS" dentro de um balão normal e acreditava que a IA tinha
      // respondido. Outros módulos já respeitam o sinal (`RelatorioCard`
      // mostra "Estrutura local (Gemini indisponível)"); aqui ele era perdido.
      const semModelo = data.status !== "CONCLUIDA";
      const aiMsg: Message = {
        id: `${Date.now()}-a`,
        role: "assistant",
        text: respostaText,
        erro: semModelo,
        detalhes: data.detalhes,
        execucaoId: data.execucaoId,
        status: data.status,
      };
      setMessages((p) => [...p, aiMsg]);

      if (isVoiceModeRef.current) {
        setVoiceAiTranscript(respostaText);
      }

      // REGRA DA META: SÓ fala se for modo voz (botão azul)
      //
      // A resposta em fallback NÃO é falada: no modo voz a IA leria em voz alta
      // "Configure GEMINI_API_KEY no .env", que é informação de configuração
      // para o gestor, não uma conversa.
      if (origem === "modo_voz" && !semModelo) {
        await speak(resumoParaFala(respostaText));
      }
      // Se origem for 'texto' ou 'audio', NÃO FALA. Apenas mostra texto.
    } catch (err: any) {
      const msg = mensagemDeErroApi(err, "Não foi possível falar com a IA agora. Verifique a conexão com o backend.");
      setMessages((p) => [...p, { id: `${Date.now()}-e`, role: "assistant", text: msg, erro: true }]);
      if (isVoiceModeRef.current) {
        setVoiceAiTranscript(msg);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setMessages([]);
    setConversaId(null);
    setPainel(null);
    setInput("");
    setVoiceUserTranscript("");
    setVoiceAiTranscript("");
    if (isVoiceMode) {
      exitVoiceMode();
    }
  };

  // Investigação que ficou aguardando o provedor: retoma do ponto em que parou (sem refazer ferramentas).
  const [retomando, setRetomando] = useState<string | null>(null);
  const retomarMensagem = async (m: Message) => {
    if (!m.execucaoId) return;
    setRetomando(m.id);
    try {
      const r = await nexusAi.retomar(m.execucaoId);
      setMessages((p) => p.map((x) => (x.id === m.id ? { ...x, text: limparTextoIA(r.resposta ?? x.text), erro: r.status !== "CONCLUIDA", detalhes: r.detalhes, status: r.status } : x)));
    } catch { /* a mensagem continua com o botão para tentar de novo */ } finally { setRetomando(null); }
  };

  const abrirPainel = (p: Painel) => {
    if (isVoiceMode) exitVoiceMode();
    // No celular a barra lateral cobre a tela: fecha para mostrar o painel escolhido.
    if (typeof window !== "undefined" && window.innerWidth <= 768) setSidebarOpen(false);
    setPainel(p);
    if (p === "historico") nexusAi.conversas().then(setConversas).catch(() => setConversas([]));
  };
  const abrirConversa = async (id: string) => {
    try {
      const c = await nexusAi.conversa(id);
      setConversaId(c.id);
      setMessages(c.mensagens.map((m) => ({ id: m.id, role: m.papel === "USUARIO" ? "user" : "assistant", text: m.papel === "USUARIO" ? m.conteudo : limparTextoIA(m.conteudo), detalhes: m.detalhes, execucaoId: m.execucaoId, status: m.status ?? undefined, erro: m.papel === "NEXUS" && !!m.status && m.status !== "CONCLUIDA" })));
      setPainel(null);
    } catch { /* a lista continua aberta */ }
  };

  const handleNav = (route: string) => {
    if (isVoiceMode) exitVoiceMode();
    router.push(route);
  };

  const handleSairIA = () => {
    if (isVoiceMode) exitVoiceMode();
    // O Dashboard mora na RAIZ ("/"). `/dashboard` não existe e o
    // `next build` confirma: a rota não aparece na tabela de rotas, então
    // `router.push("/dashboard")` terminava sempre em _not-found.
    router.push("/");
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  // No celular a conversa abre com a barra lateral fechada (ela abre pelo botão de menu).
  useEffect(() => { if (window.innerWidth <= 768) setSidebarOpen(false); }, []);

  const handleMicClick = () => {
    if (isRecording) {
      stopListening();
    } else {
      if (recognitionRef.current) {
        startListening();
      } else {
        alert("Seu navegador não suporta reconhecimento de voz nativo. Recomendamos Google Chrome ou Edge.");
      }
    }
  };

  const handlePlus = () => {
    fileInputRef.current?.click();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // O NEXUS OS não tem endpoint de anexo no chat da IA: `POST /rh/documentos`
    // (o único upload real) pertence ao RH e exige entidadeId de Funcionario,
    // Advertencia, Suspensao ou Desligamento. Enviar o arquivo para a IA seria
    // fingir uma análise que não acontece. A tela informa o limite real.
    setMessages((p) => [
      ...p,
      {
        id: `${Date.now()}-anexo`,
        role: "assistant",
        text:
          `O arquivo "${file.name}" (${(file.size / 1024).toFixed(1)} KB) foi selecionado, ` +
          `mas o NEXUS OS ainda não aceita anexo na conversa com a IA — o único upload ` +
          `disponível é o de documentos do RH (Configurações > RH > Documentos). ` +
          `Nenhum conteúdo do arquivo foi enviado ao modelo.`,
        erro: true,
      },
    ]);
    // Limpa o input para permitir reescolher o mesmo arquivo depois.
    e.target.value = "";
  };

  return (
    <div className="nexus-root">
      <style>{`
.nexus-root{height:100dvh;width:100%;background:var(--nx-canvas);color:var(--nx-ink);display:flex;font-family:Inter,system-ui;overflow:hidden;position:relative}
        .nexus-bg{position:fixed;inset:0;pointer-events:none;overflow:hidden}
        .nexus-bg-a{position:absolute;top:-128px;left:50%;transform:translateX(-50%);width:900px;height:600px;background:color-mix(in srgb,var(--nx-accent) 12%,transparent);filter:blur(140px);border-radius:999px}
        .nexus-bg-b{position:absolute;bottom:-128px;left:-128px;width:600px;height:600px;background:color-mix(in srgb,var(--nx-accent-2) 10%,transparent);filter:blur(140px);border-radius:999px}
        .sidebar{width:300px;min-width:300px;background:var(--nx-surface);color:var(--nx-ink);border-right:1px solid var(--nx-border);display:flex;flex-direction:column;transition:transform .3s;z-index:20}
        .sidebar.closed{transform:translateX(-100%);position:absolute;left:0;top:0;bottom:0}
        .sidebar-header{padding:20px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between}
        .pill{border-radius:999px;border:1px solid var(--nx-border);background:var(--nx-surface-2);color:var(--nx-ink-2);padding:8px 16px;font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .2s}
        .pill:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.02)}
        .pill:active{transform:scale(0.98)}
        .nav-btn{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--nx-ink-2);font-size:13px;cursor:pointer;text-align:left;transition:all .2s}
        .nav-btn:hover{background:var(--nx-surface-2);color:var(--nx-ink)}
        .nav-btn.active{background:var(--nx-accent);color:var(--nx-ink);font-weight:600}
        .main{flex:1;display:flex;flex-direction:column;position:relative;min-width:0;overflow:hidden;background:transparent}
        .header{height:56px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:color-mix(in srgb,var(--nx-surface) 90%,transparent);backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}
        .icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--nx-border);background:var(--nx-surface-2);display:grid;place-items:center;cursor:pointer;transition:all .2s;color:var(--nx-ink-2)}
        .icon-btn:hover{background:var(--nx-surface-3);transform:scale(1.05);color:var(--nx-ink)}
        .icon-btn:active{transform:scale(0.95)}
        .chat-area{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:0 16px}
        .chat-inner{max-width:760px;margin:0 auto;padding:32px 0}
        .bubble-user{max-width:80%;margin-left:auto;background:var(--nx-accent);color:var(--nx-ink);border-radius:24px;border-bottom-right-radius:8px;padding:14px 18px;font-size:14px;line-height:1.5;animation:pop .2s ease;box-shadow:0 4px 14px color-mix(in srgb,var(--nx-accent) 24%,transparent)}
        .bubble-ai{max-width:80%;background:var(--nx-surface-2);border:1px solid var(--nx-border);border-radius:24px;border-bottom-left-radius:8px;padding:16px 18px;font-size:14px;line-height:1.6;color:var(--nx-ink);animation:pop .2s ease;white-space:pre-wrap}
        .bubble-ai.erro{background:color-mix(in srgb,var(--nx-red) 12%,var(--nx-surface));border-color:color-mix(in srgb,var(--nx-red) 30%,var(--nx-border));color:var(--nx-red)}
        @keyframes pop{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
        .input-wrap{position:relative;flex-shrink:0;left:0;right:0;padding:16px;background:linear-gradient(to top,var(--nx-canvas) 50%,color-mix(in srgb,var(--nx-canvas) 90%,transparent),transparent)}
        .input-pill{max-width:760px;margin:0 auto;height:62px;border-radius:28px;background:var(--nx-surface);border:1px solid var(--nx-border);display:flex;align-items:center;gap:10px;padding:0 10px;box-shadow:var(--nx-shadow-pop)}
        .input-pill:focus-within{border-color:var(--nx-accent)}
        .circle-btn{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .2s;border:none}
        .circle-btn:hover{transform:scale(1.06)}
        .circle-btn:active{transform:scale(0.92)}
        .circle-plus{background:var(--nx-surface-2);color:var(--nx-ink-2)}
        .circle-plus:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
        .circle-mic{background:var(--nx-surface-2);color:var(--nx-ink-2)}
        .circle-mic:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
        .circle-mic.rec{background:color-mix(in srgb,var(--nx-red) 18%,transparent);color:var(--nx-red);box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent);animation:pulse 1.2s infinite}
        @keyframes pulse{0%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--nx-red) 10%,transparent)}100%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}}
        .circle-send{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 30%,transparent)}
        .circle-waves{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 30%,transparent);position:relative}
        .circle-waves:hover{background:var(--nx-accent-2);box-shadow:0 8px 24px color-mix(in srgb,var(--nx-accent-2) 38%,transparent)}
        .chat-input{flex:1;background:transparent;border:none;outline:none;color:var(--nx-ink);font-size:15px;min-width:0}
        .chat-input::placeholder{color:var(--nx-ink-3)}

        /* Modo Voz: mesma hierarquia visual nos temas claro e escuro. */
        .voice-mode-overlay{position:absolute;inset:0;background:radial-gradient(circle at center,var(--nx-surface-2) 0%,var(--nx-surface) 55%,var(--nx-canvas) 100%);z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 20px 40px;animation:fadeIn .3s ease}
        @keyframes fadeIn{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}
        .voice-topbar{width:100%;max-width:800px;display:flex;align-items:center;justify-content:space-between}
        .voice-badge{display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:13px;font-weight:500;color:var(--nx-ink-2)}
        .voice-dot{width:8px;height:8px;border-radius:999px;background:var(--nx-accent-2);box-shadow:0 0 10px color-mix(in srgb,var(--nx-accent-2) 55%,transparent);animation:blink 1.5s infinite}
        .voice-dot.speaking{background:var(--nx-accent);box-shadow:0 0 12px color-mix(in srgb,var(--nx-accent) 60%,transparent)}
        .voice-dot.listening{background:var(--nx-green);box-shadow:0 0 12px color-mix(in srgb,var(--nx-green) 60%,transparent)}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        .voice-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:680px;padding:20px 0;width:100%}
        .wave-orb-container{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:32px}
        .wave-ring{position:absolute;border-radius:999px;border:2px solid color-mix(in srgb,var(--nx-accent) 25%,transparent);pointer-events:none}
        .wave-ring-1{width:140px;height:140px;animation:wavePulse1 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite}
        .wave-ring-2{width:200px;height:200px;animation:wavePulse2 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite .5s}
        .wave-ring-3{width:260px;height:260px;animation:wavePulse3 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite 1s}
        @keyframes wavePulse1{0%{transform:scale(0.8);opacity:0.8}50%{transform:scale(1.1);opacity:0.3}100%{transform:scale(0.8);opacity:0.8}}
        @keyframes wavePulse2{0%{transform:scale(0.75);opacity:0.5}50%{transform:scale(1.2);opacity:0.15}100%{transform:scale(0.75);opacity:0.5}}
        @keyframes wavePulse3{0%{transform:scale(0.7);opacity:0.3}50%{transform:scale(1.25);opacity:0.05}100%{transform:scale(0.7);opacity:0.3}}
        .wave-core{width:110px;height:110px;border-radius:999px;background:linear-gradient(135deg,var(--nx-accent) 0%,var(--nx-accent-2) 100%);display:grid;place-items:center;color:var(--nx-ink);box-shadow:0 0 50px color-mix(in srgb,var(--nx-accent) 35%,transparent),0 0 90px color-mix(in srgb,var(--nx-accent-2) 22%,transparent);z-index:2;cursor:pointer;transition:all .3s}
        .wave-core.speaking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-red) 100%);box-shadow:0 0 60px color-mix(in srgb,var(--nx-red) 35%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 30%,transparent);animation:speakingBeat 1.2s ease-in-out infinite}
        .wave-core.thinking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);animation:rotateGlow 3s linear infinite}
        .wave-core.listening{box-shadow:0 0 60px color-mix(in srgb,var(--nx-green) 35%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent) 25%,transparent)}
        @keyframes speakingBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
        @keyframes rotateGlow{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}
        .voice-status-title{font-size:22px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px;color:var(--nx-ink)}
        .voice-transcript-box{max-height:160px;overflow-y:auto;width:100%;padding:14px 20px;border-radius:18px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:15px;line-height:1.6;color:var(--nx-ink-2)}
        .voice-transcript-user{color:var(--nx-accent-ink);font-weight:500;margin-bottom:8px;font-size:14px}
        .voice-transcript-ai{color:var(--nx-ink);font-size:15px}
        .voice-controls{display:flex;align-items:center;gap:24px}
        .voice-btn-subtle{width:50px;height:50px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);display:grid;place-items:center;color:var(--nx-ink-2);cursor:pointer;transition:all .2s}
        .voice-btn-subtle:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.05)}
        .voice-btn-end{width:64px;height:64px;border-radius:999px;background:var(--nx-red);border:none;display:grid;place-items:center;color:var(--nx-ink);cursor:pointer;box-shadow:0 8px 24px color-mix(in srgb,var(--nx-red) 32%,transparent);transition:all .2s}
        .voice-btn-end:hover{transform:scale(1.08);background:color-mix(in srgb,var(--nx-red) 88%,var(--nx-ink));box-shadow:0 12px 30px color-mix(in srgb,var(--nx-red) 42%,transparent)}
        .voice-btn-end:active{transform:scale(0.94)}
        @media(max-width:768px){.sidebar{position:fixed!important;left:0;top:0;bottom:0;transform:translateX(-100%)}.sidebar.open{transform:translateX(0)}.main{width:100%}.wave-orb-container{width:200px;height:200px}}
`}</style>
      <div className="nexus-bg">
        <div className="nexus-bg-a" />
        <div className="nexus-bg-b" />
      </div>

      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`} style={{ position: "relative" }}>
        <div className="sidebar-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--nx-accent)",
                color: "var(--nx-ink)",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
              }}
            >
              N
            </div>
            NEXUS OS
          </div>
          <button className="icon-btn" onClick={toggleSidebar} title="Fechar menu">
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 12 }}>
          <button
            className="pill"
            style={{ width: "100%", justifyContent: "center", background: "var(--nx-accent)", color: "var(--nx-ink)", fontWeight: 600, borderRadius: 12 }}
            onClick={handleNewChat}
          >
            <Plus size={16} /> Nova conversa
          </button>
        </div>
        <div style={{ padding: "0 12px", flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "var(--nx-ink-3)", margin: "16px 0 8px", fontWeight: 600 }}>
            Navegação NEXUS OS
          </div>
          {navItems.map((n) => (
            <button key={n.id} className="nav-btn" onClick={() => handleNav(n.route)}>
              <n.icon size={16} />
              {n.label}
            </button>
          ))}
          <div style={{ fontSize: 11, letterSpacing: 1, color: "var(--nx-ink-3)", margin: "16px 0 8px", fontWeight: 600 }}>
            NEXUS AI
          </div>
          <button className={`nav-btn${painel === "historico" ? " active" : ""}`} onClick={() => abrirPainel("historico")}><History size={16} />Histórico</button>
          <button className={`nav-btn${painel === "memoria" ? " active" : ""}`} onClick={() => abrirPainel("memoria")}><Brain size={16} />Memória da empresa</button>
          <button className={`nav-btn${painel === "documentos" ? " active" : ""}`} onClick={() => abrirPainel("documentos")}><BookOpen size={16} />Documentos</button>
          <button className={`nav-btn${painel === "inteligencia" ? " active" : ""}`} onClick={() => abrirPainel("inteligencia")}><Bell size={16} />Inteligência</button>
          <button className={`nav-btn${painel === "aprovacoes" ? " active" : ""}`} onClick={() => abrirPainel("aprovacoes")}><ClipboardCheck size={16} />Aprovações</button>
          <button className={`nav-btn${painel === "automacoes" ? " active" : ""}`} onClick={() => abrirPainel("automacoes")}><Zap size={16} />Automações</button>
          <button className="nav-btn active" style={{ marginTop: 8 }} onClick={handleSairIA}>
            <LogOut size={16} />
            Sair da IA
          </button>
          <div style={{ marginTop: 20, position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--nx-ink-3)" }} />
            <input
              value={buscaConversa}
              onChange={(e) => setBuscaConversa(e.target.value)}
              placeholder="Buscar nesta sessão"
              aria-label="Buscar conversas desta sessão"
              style={{
                width: "100%",
                height: 36,
                borderRadius: 10,
                background: "var(--nx-surface-2)",
                border: "1px solid var(--nx-border)",
                paddingLeft: 32,
                paddingRight: 32,
                color: "var(--nx-ink)",
                fontSize: 13,
              }}
            />
            {buscaConversa && (
              <button
                type="button"
                onClick={() => setBuscaConversa("")}
                aria-label="Limpar busca"
                style={{
                  position: "absolute",
                  right: 8,
                  top: 10,
                  color: "var(--nx-ink-3)",
                  background: "none",
                  border: 0,
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "var(--nx-ink-3)", margin: "16px 0 8px", fontWeight: 600 }}>Recentes</div>
          {messages.length === 0 ? (
            <div
              style={{
                padding: "12px",
                borderRadius: 12,
                background: "var(--nx-surface-2)",
                border: "1px dashed var(--nx-border-strong)",
                color: "var(--nx-ink-3)",
                fontSize: 11.5,
                lineHeight: 1.6,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <MessageSquare size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Nenhuma pergunta nesta conversa. As conversas ficam guardadas em Histórico.</span>
            </div>
          ) : recentes.length === 0 ? (
            <div
              style={{
                padding: "12px",
                borderRadius: 12,
                background: "var(--nx-surface-2)",
                border: "1px dashed var(--nx-border-strong)",
                color: "var(--nx-ink-3)",
                fontSize: 11.5,
                lineHeight: 1.6,
              }}
            >
              Nenhuma conversa desta sessão corresponde a “{buscaConversa.trim()}”.
            </div>
          ) : (
            recentes.map((m) => (
                <div
                  key={m.id}
                  onClick={() => handleSendMessage(m.text, "texto")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "var(--nx-surface-2)",
                    border: "1px solid var(--nx-border)",
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <MessageSquare size={12} style={{ flexShrink: 0 }} />
                    {m.text}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--nx-ink-3)", marginTop: 4 }}>nesta sessão</div>
                </div>
              ))
          )}
        </div>
      </aside>

      <main className="main">
        {/* TOP BAR / HEADER COMUM */}
        <div className="header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="icon-btn" onClick={toggleSidebar} title={sidebarOpen ? "Fechar menu" : "Abrir menu"}>
              {sidebarOpen ? <X size={18} /> : <Sandwich open={false} />}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--nx-accent)",
                  color: "var(--nx-ink)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                N
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>NEXUS OS • IA</span>
              <span style={{ fontSize: 11, color: "var(--nx-ink-3)", background: "var(--nx-surface-2)", padding: "2px 8px", borderRadius: 999 }}>
                Google Gemini
              </span>
            </div>
          </div>
          <div>
            <button
              className="pill"
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: isVoiceMode ? "color-mix(in srgb, var(--nx-red) 15%, transparent)" : "color-mix(in srgb, var(--nx-accent) 15%, transparent)",
                borderColor: isVoiceMode ? "color-mix(in srgb, var(--nx-red) 30%, transparent)" : "color-mix(in srgb, var(--nx-accent) 30%, transparent)",
                color: isVoiceMode ? "var(--nx-red)" : "var(--nx-accent-ink)",
              }}
              onClick={() => (isVoiceMode ? exitVoiceMode() : enterVoiceMode())}
            >
              <Waves size={14} />
              {isVoiceMode ? "Modo Texto" : "Modo Voz"}
            </button>
          </div>
        </div>

        {/* 5. TELA DE MODO VOZ (quando isVoiceMode === true) */}
        {isVoiceMode ? (
          <div className="voice-mode-overlay">
            <div className="voice-topbar">
              <div className="voice-badge">
                <span
                  className={`voice-dot ${
                    voiceStatus === "speaking" ? "speaking" : voiceStatus === "listening" ? "listening" : ""
                  }`}
                />
                <span>
                  {voiceStatus === "listening"
                    ? "Ouvindo você..."
                    : voiceStatus === "thinking"
                    ? "ATMA pensando..."
                    : voiceStatus === "speaking"
                    ? "ATMA falando..."
                    : "Conversando com Nexus"}
                </span>
              </div>
              <button className="icon-btn" onClick={exitVoiceMode} title="Voltar para Modo Texto">
                <X size={20} />
              </button>
            </div>

            <div className="voice-center">
              <div className="wave-orb-container">
                <div className="wave-ring wave-ring-1" />
                <div className="wave-ring wave-ring-2" />
                <div className="wave-ring wave-ring-3" />
                <div
                  className={`wave-core ${voiceStatus}`}
                  onClick={() => {
                    if (voiceStatus === "speaking") {
                      if (typeof window !== "undefined" && "speechSynthesis" in window) {
                        window.speechSynthesis.cancel();
                      }
                      setVoiceStatus("listening");
                      startListening();
                    } else if (voiceStatus === "listening") {
                      stopListening();
                      setVoiceStatus("idle");
                    } else {
                      startListening();
                    }
                  }}
                  title={voiceStatus === "speaking" ? "Pausar fala" : "Falar agora"}
                >
                  <Waves size={48} />
                </div>
              </div>

              <div className="voice-status-title">
                {voiceStatus === "listening" && "Ouvindo você... Fale agora"}
                {voiceStatus === "thinking" && "Processando resposta..."}
                {voiceStatus === "speaking" && "ATMA falando..."}
                {voiceStatus === "idle" && "Pronto. Toque para falar."}
              </div>

              {(voiceUserTranscript || voiceAiTranscript) && (
                <div className="voice-transcript-box">
                  {voiceUserTranscript && (
                    <div className="voice-transcript-user">Você: &ldquo;{voiceUserTranscript}&rdquo;</div>
                  )}
                  {voiceAiTranscript && (
                    <div className="voice-transcript-ai">&ldquo;{voiceAiTranscript}&rdquo;</div>
                  )}
                </div>
              )}
            </div>

            {/* Controles do Modo Voz */}
            <div className="voice-controls">
              <button
                className="voice-btn-subtle"
                onClick={handleMicClick}
                title={isRecording ? "Silenciar microfone" : "Ativar microfone"}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              {/* Botão Vermelho Central para Encerrar Modo Voz */}
              <button className="voice-btn-end" onClick={exitVoiceMode} title="Encerrar conversa por voz">
                <PhoneOff size={24} />
              </button>

              <button className="voice-btn-subtle" onClick={exitVoiceMode} title="Digitar (voltar ao teclado)">
                <Keyboard size={20} />
              </button>
            </div>
          </div>
        ) : (
          /* MODO TEXTO (Padrão) */
          painel ? (
            <div className="chat-area"><div className="chat-inner">
              <button className="pill" onClick={() => setPainel(null)} style={{ marginBottom: 8 }}><X size={14} />Voltar à conversa</button>
              {painel === "memoria" ? <MemoriaEmpresa /> : painel === "documentos" ? <DocumentosEmpresa /> : painel === "inteligencia" ? <Inteligencia onInvestigar={(p) => { setPainel(null); void handleSendMessage(p, "texto"); }} /> : painel === "aprovacoes" ? <Aprovacoes /> : painel === "automacoes" ? <Automacoes /> : (
                <div style={{ marginTop: 16 }}>
                  {conversas === null ? <p style={{ fontSize: 13, color: "var(--nx-ink-3)" }}>Carregando…</p> : conversas.length === 0 ? <p style={{ fontSize: 13, color: "var(--nx-ink-3)" }}>Nenhuma conversa ainda.</p> : conversas.map((c) => (
                    <button key={c.id} className="nav-btn" onClick={() => void abrirConversa(c.id)} style={{ justifyContent: "space-between" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.titulo}</span>
                      <span style={{ fontSize: 11, color: "var(--nx-ink-3)", flexShrink: 0 }}>{formatDateTime(c.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div></div>
          ) : <>
            <div className="chat-area" ref={scrollRef}>
              <div className="chat-inner">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                      marginBottom: 16,
                    }}
                  >
                    <div className={m.role === "user" ? "bubble-user" : `bubble-ai${m.erro ? " erro" : ""}`}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                      {m.role === "assistant" && <Verificacao d={m.detalhes} />}
                      {m.role === "assistant" && m.execucaoId && m.status === "AGUARDANDO_PROVEDOR" && (
                        <button className="pill" style={{ marginTop: 8 }} disabled={retomando === m.id} onClick={() => void retomarMensagem(m)}>
                          {retomando === m.id ? "Retomando…" : "Retomar investigação"}
                        </button>
                      )}
                      {m.role === "assistant" && m.execucaoId && !m.erro && <AvaliarResposta execucaoId={m.execucaoId} inicial={m.detalhes?.avaliacao ?? null} />}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div className="bubble-ai">Consultando os dados da empresa…</div>
                  </div>
                )}
                <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {shortcuts.map((s) => (
                    <button key={s} className="pill" onClick={() => handleSendMessage(s, "texto")}>
                      <Zap size={14} />
                      {s}
                    </button>
                  ))}
                </div>
                <div style={{ height: 120 }} />
              </div>
            </div>

            {/* Input inferior no Modo Texto */}
            <div className="input-wrap">
              <div className="input-pill">
                <button className="circle-btn circle-plus" onClick={handlePlus} title="Anexar arquivo">
                  <Plus size={18} />
                </button>
                <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFile} />

                {/* Input "Fale ou digite..." -> chama com origem 'texto' */}
                <input
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(input, "texto");
                    }
                  }}
                  placeholder="Fale ou digite..."
                />

                {/* Microfone pequeno: fala rápida por voz -> chama com origem 'voz' */}
                <button
                  className={`circle-btn circle-mic ${isRecording ? "rec" : ""}`}
                  onClick={handleMicClick}
                  title={isRecording ? "Parar gravação" : "Falar no microfone"}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                {/* Botão azul: se tiver texto envia como texto. Se vazio, é o Waves que abre o Modo Voz! */}
                {input.trim() ? (
                  <button
                    className="circle-btn circle-send"
                    onClick={() => handleSendMessage(input, "texto")}
                    title="Enviar texto"
                  >
                    <ArrowUp size={20} color="var(--nx-ink)" />
                  </button>
                ) : (
                  <button
                    className="circle-btn circle-waves"
                    onClick={enterVoiceMode}
                    title="Entrar em Modo Voz (Conversar com NEXUS)"
                  >
                    <Waves size={20} color="var(--nx-ink)" />
                  </button>
                )}
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--nx-ink-3)", marginTop: 8 }}>
                Clique no botão de ondas para conversar por voz com a IA • NEXUS OS
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
