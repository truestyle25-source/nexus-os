/*
Baseline do schema base (correcao C1 - auditoria PDV).
Gerado por gen_baseline.ps1 a partir de:
  prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

Contem APENAS as tabelas/enums/indices que NENHUMA outra migration da cadeia ja cria,
com guards (IF NOT EXISTS / DO EXCEPTION duplicate_object) para ser seguro tambem em
bancos existentes que ja possuem o schema (onboarding: prisma migrate resolve --applied).
Colunas adicionadas posteriormente pela cadeia sao SUBTRAIDAS aqui e recriadas pelas
respectivas migrations da cadeia. FKs entre tabelas-base ficam na trailing
202610081100_parity_fks_indexes (aplicada por ultimo, com guards pg_constraint).
*/

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "Origem" AS ENUM ('MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO', 'PDV', 'PONTO', 'INTEGRACAO', 'IA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusGeral" AS ENUM ('ATIVO', 'INATIVO', 'ARQUIVADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "AcaoAuditoria" AS ENUM ('CRIAR', 'EDITAR', 'EXCLUIR', 'LOGIN', 'LOGOUT', 'IMPORTAR', 'SINCRONIZAR', 'ALTERAR_PERMISSAO', 'ALTERAR_CONFIG');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "TipoMovEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'INVENTARIO', 'PERDA', 'AVARIA', 'TRANSFERENCIA', 'DEVOLUCAO', 'VENDA', 'COMPRA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusCompra" AS ENUM ('SOLICITADA', 'PEDIDO', 'RECEBIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusVenda" AS ENUM ('ABERTA', 'FINALIZADA', 'CANCELADA', 'DEVOLVIDA', 'ESTORNADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusIntegracao" AS ENUM ('CONECTADO', 'ATENCAO', 'ERRO', 'NAO_CONFIGURADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "TipoFinanceiro" AS ENUM ('RECEITA', 'DESPESA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusFinanceiro" AS ENUM ('PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusFuncionario" AS ENUM ('ATIVO', 'INATIVO', 'FERIAS', 'AFASTADO', 'DESLIGADO', 'ARQUIVADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "TipoAlerta" AS ENUM ('ESTOQUE_BAIXO', 'ESTOQUE_ZERADO', 'VALIDADE', 'QUEDA_VENDAS', 'META_BAIXA', 'CONTA_VENCIDA', 'DESPESA_ALTA', 'FALTA', 'ATRASO', 'HORA_EXTRA', 'ANOMALIA_IA', 'COMPRA_PENDENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "PrioridadeAlerta" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusAlerta" AS ENUM ('ABERTO', 'LIDO', 'RESOLVIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusAssinatura" AS ENUM ('TRIAL', 'ATIVA', 'ATRASADA', 'CANCELADA', 'EXPIRADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum (guarded: bancos existentes ja podem possui-lo)
DO $$ BEGIN
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'PAGO', 'FALHOU', 'ESTORNADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Empresa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "cnpj" TEXT,
    "inscricaoEstadual" TEXT,
    "responsavelCpf" TEXT,
    "responsavelRg" TEXT,
    "cep" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Filial" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "status" "StatusGeral" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Filial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Setor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "StatusGeral" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Usuario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "setorId" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "status" "StatusGeral" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "ultimoLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Permissao" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "permitido" BOOLEAN NOT NULL DEFAULT false,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "empresaId" TEXT,
    "acao" "AcaoAuditoria" NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "valorAnterior" JSONB,
    "valorNovo" JSONB,
    "origem" "Origem" NOT NULL,
    "ip" TEXT,
    "contexto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Categoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Produto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "categoriaId" TEXT,
    "fornecedorId" TEXT,
    "nome" TEXT NOT NULL,
    "sku" TEXT,
    "codigoBarras" TEXT,
    "custo" DECIMAL(10,2) NOT NULL,
    "precoVenda" DECIMAL(10,2) NOT NULL,
    "margem" DECIMAL(5,2),
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 5,
    "estoqueMaximo" INTEGER NOT NULL DEFAULT 100,
    "validade" TIMESTAMP(3),
    "imagem" TEXT,
    "descricao" TEXT,
    "status" "StatusGeral" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Estoque" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EstoqueMovimentacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "quantidade" INTEGER NOT NULL,
    "tipo" "TipoMovEstoque" NOT NULL,
    "motivo" TEXT,
    "documento" TEXT,
    "origem" "Origem" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstoqueMovimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Fornecedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Ativo',
    "contato" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompraFornecedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "compraId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "dataPedido" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataEntrega" TIMESTAMP(3),

    CONSTRAINT "CompraFornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Compra" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "status" "StatusCompra" NOT NULL DEFAULT 'SOLICITADA',
    "condPagamento" TEXT,
    "dataCompra" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataRecebimento" TIMESTAMP(3),
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompraItem" (
    "id" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valorUnit" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "CompraItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Cliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "valorTotalComprado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ticketMedio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ultimaCompra" TIMESTAMP(3),
    "frequencia" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusGeral" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Venda" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "setorId" TEXT,
    "clienteId" TEXT,
    "funcionarioId" TEXT,
    "formaPagamento" "FormaPagamento" NOT NULL DEFAULT 'DINHEIRO',
    "status" "StatusVenda" NOT NULL DEFAULT 'ABERTA',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "pdvId" TEXT,
    "pdvSincronizado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VendaItem" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "VendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IntegracaoPDV" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT,
    "status" "StatusIntegracao" NOT NULL DEFAULT 'NAO_CONFIGURADO',
    "ultimaSincronizacao" TIMESTAMP(3),
    "proximaSincronizacao" TIMESTAMP(3),
    "qtdRegistros" INTEGER NOT NULL DEFAULT 0,
    "erros" JSONB,
    "historico" JSONB,
    "origem" "Origem" NOT NULL DEFAULT 'INTEGRACAO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoPDV_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Financeiro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "tipo" "TipoFinanceiro" NOT NULL,
    "categoria" TEXT NOT NULL,
    "centroCusto" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" TIMESTAMP(3),
    "status" "StatusFinanceiro" NOT NULL DEFAULT 'PENDENTE',
    "vendaId" TEXT,
    "compraId" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DRE" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFim" TIMESTAMP(3) NOT NULL,
    "receitaBruta" DECIMAL(12,2) NOT NULL,
    "deducoes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receitaLiquida" DECIMAL(12,2) NOT NULL,
    "custos" DECIMAL(12,2) NOT NULL,
    "despesas" DECIMAL(12,2) NOT NULL,
    "resultadoOperacional" DECIMAL(12,2) NOT NULL,
    "lucroPrejuizo" DECIMAL(12,2) NOT NULL,
    "margemBruta" DECIMAL(5,2) NOT NULL,
    "margemLiquida" DECIMAL(5,2) NOT NULL,
    "origem" "Origem" NOT NULL DEFAULT 'AUTOMATICO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DRE_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IndicadorDiario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "data" DATE NOT NULL,
    "faturamento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qtdVendas" INTEGER NOT NULL DEFAULT 0,
    "ticketMedio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndicadorDiario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Meta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "setorId" TEXT,
    "funcionarioId" TEXT,
    "tipo" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "metaValor" DECIMAL(12,2) NOT NULL,
    "realizado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "percentual" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "diferenca" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "projecao" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Departamento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Departamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Cargo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "departamentoId" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cargo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Funcionario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "departamentoId" TEXT,
    "cargoId" TEXT,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "idExternoPonto" TEXT,
    "dataAdmissao" TIMESTAMP(3),
    "dataDesligamento" TIMESTAMP(3),
    "status" "StatusFuncionario" NOT NULL DEFAULT 'ATIVO',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Documento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "entidadeTipo" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "funcionarioId" TEXT,
    "nomeOriginal" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 's3',
    "contentType" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "descricao" TEXT,
    "enviadoPorId" TEXT,
    "situacao" TEXT NOT NULL DEFAULT 'disponivel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Advertencia" (
    "id" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Advertencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ferias" (
    "id" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGENDADA',
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Ferias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ponto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "entrada" TIMESTAMP(3),
    "saidaIntervalo" TIMESTAMP(3),
    "retornoIntervalo" TIMESTAMP(3),
    "saida" TIMESTAMP(3),
    "atrasoMinutos" INTEGER NOT NULL DEFAULT 0,
    "horaExtraMinutos" INTEGER NOT NULL DEFAULT 0,
    "falta" BOOLEAN NOT NULL DEFAULT false,
    "inconsistencia" TEXT,
    "bancoHoras" INTEGER NOT NULL DEFAULT 0,
    "saidaAntecipada" BOOLEAN NOT NULL DEFAULT false,
    "origem" "Origem" NOT NULL DEFAULT 'PONTO',
    "idExterno" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ponto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IntegracaoPonto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "status" "StatusIntegracao" NOT NULL DEFAULT 'NAO_CONFIGURADO',
    "ultimaSincronizacao" TIMESTAMP(3),
    "qtdRegistros" INTEGER NOT NULL DEFAULT 0,
    "erros" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoPonto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Alerta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoAlerta" NOT NULL,
    "prioridade" "PrioridadeAlerta" NOT NULL DEFAULT 'MEDIA',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" "StatusAlerta" NOT NULL DEFAULT 'ABERTO',
    "entidade" TEXT,
    "entidadeId" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'AUTOMATICO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notificacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "tipo" TEXT NOT NULL,
    "prioridade" "PrioridadeAlerta" NOT NULL DEFAULT 'MEDIA',
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "origem" TEXT,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RegraAutomacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "condicao" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "origem" "Origem" NOT NULL DEFAULT 'AUTOMATICO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegraAutomacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConversaIA" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "contexto" JSONB,
    "origem" "Origem" NOT NULL DEFAULT 'IA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversaIA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Assinatura" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'TRIAL',
    "trialInicio" TIMESTAMP(3) NOT NULL,
    "trialFim" TIMESTAMP(3) NOT NULL,
    "proximaCobranca" TIMESTAMP(3),
    "valorMensal" DECIMAL(10,2) NOT NULL DEFAULT 19.90,
    "checkoutUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Pagamento" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "orderNsu" TEXT,
    "externalId" TEXT,
    "pagoEm" TIMESTAMP(3),
    "origem" "Origem" NOT NULL DEFAULT 'INTEGRACAO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Empresa_cnpj_key" ON "Empresa"("cnpj");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Filial_empresaId_idx" ON "Filial"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Setor_empresaId_filialId_idx" ON "Setor"("empresaId", "filialId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Usuario_empresaId_idx" ON "Usuario"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Permissao_usuarioId_idx" ON "Permissao"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Permissao_usuarioId_modulo_acao_key" ON "Permissao"("usuarioId", "modulo", "acao");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Auditoria_usuarioId_idx" ON "Auditoria"("usuarioId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Auditoria_entidade_entidadeId_idx" ON "Auditoria"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Auditoria_createdAt_idx" ON "Auditoria"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Categoria_empresaId_idx" ON "Categoria"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Produto_empresaId_idx" ON "Produto"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Produto_sku_idx" ON "Produto"("sku");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Estoque_empresaId_idx" ON "Estoque"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Estoque_filialId_produtoId_key" ON "Estoque"("filialId", "produtoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EstoqueMovimentacao_empresaId_produtoId_idx" ON "EstoqueMovimentacao"("empresaId", "produtoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EstoqueMovimentacao_createdAt_idx" ON "EstoqueMovimentacao"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fornecedor_empresaId_idx" ON "Fornecedor"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Compra_empresaId_idx" ON "Compra"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Cliente_empresaId_idx" ON "Cliente"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Venda_empresaId_filialId_idx" ON "Venda"("empresaId", "filialId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Venda_createdAt_idx" ON "Venda"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VendaItem_vendaId_idx" ON "VendaItem"("vendaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntegracaoPDV_empresaId_idx" ON "IntegracaoPDV"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Financeiro_empresaId_tipo_idx" ON "Financeiro"("empresaId", "tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Financeiro_vencimento_idx" ON "Financeiro"("vencimento");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DRE_empresaId_periodoInicio_periodoFim_idx" ON "DRE"("empresaId", "periodoInicio", "periodoFim");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "IndicadorDiario_empresaId_filialId_data_key" ON "IndicadorDiario"("empresaId", "filialId", "data");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Meta_empresaId_tipo_periodo_idx" ON "Meta"("empresaId", "tipo", "periodo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Departamento_empresaId_idx" ON "Departamento"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Cargo_empresaId_idx" ON "Cargo"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Funcionario_empresaId_idx" ON "Funcionario"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Funcionario_cpf_idx" ON "Funcionario"("cpf");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ponto_empresaId_data_idx" ON "Ponto"("empresaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ponto_funcionarioId_data_key" ON "Ponto"("funcionarioId", "data");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alerta_empresaId_status_idx" ON "Alerta"("empresaId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notificacao_empresaId_usuarioId_lida_idx" ON "Notificacao"("empresaId", "usuarioId", "lida");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Assinatura_empresaId_key" ON "Assinatura"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Pagamento_assinaturaId_status_idx" ON "Pagamento"("assinaturaId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Pagamento_orderNsu_idx" ON "Pagamento"("orderNsu");
