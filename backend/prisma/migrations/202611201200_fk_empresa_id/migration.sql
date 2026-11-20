-- =============================================================================
-- Chaves estrangeiras de "empresaId" -> "Empresa"(id) em 56 tabelas que não as
-- tinham (integridade multiempresa: hoje o banco aceitaria empresaId inexistente).
--
-- Pré-requisito: 202611200900_sincroniza_schema_drift (cobre Dimensao, Unidade,
-- TipoProduto e FatorConversao).
-- Verificado na produção em 2026-11-20: 0 registros órfãos nas 56 tabelas.
--
-- Padrão seguro: ADD CONSTRAINT ... NOT VALID (instantâneo, sem varrer a tabela)
-- e depois VALIDATE CONSTRAINT (verifica as linhas existentes com trava leve).
-- ON DELETE RESTRICT: impede apagar uma empresa que ainda tem dados
-- (exceto Auditoria: SET NULL, para preservar a trilha de auditoria).
-- Não altera nem apaga dados.
-- =============================================================================

-- Auditoria: SET NULL — o histórico sobrevive se a empresa for apagada.
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ComposicaoKit" ADD CONSTRAINT "ComposicaoKit_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Estoque" ADD CONSTRAINT "Estoque_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SessaoInventario" ADD CONSTRAINT "SessaoInventario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ContagemInventario" ADD CONSTRAINT "ContagemInventario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EstoqueSnapshotDiario" ADD CONSTRAINT "EstoqueSnapshotDiario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EstoqueMovimentacao" ADD CONSTRAINT "EstoqueMovimentacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CompraFornecedor" ADD CONSTRAINT "CompraFornecedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "IntegracaoPDV" ADD CONSTRAINT "IntegracaoPDV_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Financeiro" ADD CONSTRAINT "Financeiro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DRE" ADD CONSTRAINT "DRE_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "IndicadorDiario" ADD CONSTRAINT "IndicadorDiario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Meta" ADD CONSTRAINT "Meta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Departamento" ADD CONSTRAINT "Departamento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Cargo" ADD CONSTRAINT "Cargo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Advertencia" ADD CONSTRAINT "Advertencia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Desligamento" ADD CONSTRAINT "Desligamento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Ponto" ADD CONSTRAINT "Ponto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "IntegracaoPonto" ADD CONSTRAINT "IntegracaoPonto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RegraAutomacao" ADD CONSTRAINT "RegraAutomacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ConversaIA" ADD CONSTRAINT "ConversaIA_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RelatorioGerado" ADD CONSTRAINT "RelatorioGerado_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Folha" ADD CONSTRAINT "Folha_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LancamentoFolha" ADD CONSTRAINT "LancamentoFolha_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PagamentoRH" ADD CONSTRAINT "PagamentoRH_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DecimoTerceiro" ADD CONSTRAINT "DecimoTerceiro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PixSettings" ADD CONSTRAINT "PixSettings_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PixCobranca" ADD CONSTRAINT "PixCobranca_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "IntegracaoExterno" ADD CONSTRAINT "IntegracaoExterno_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ShopeePedido" ADD CONSTRAINT "ShopeePedido_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PlanoDesenvolvimento" ADD CONSTRAINT "PlanoDesenvolvimento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Treinamento" ADD CONSTRAINT "Treinamento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ParticipanteTreinamento" ADD CONSTRAINT "ParticipanteTreinamento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AvaliacaoComportamental" ADD CONSTRAINT "AvaliacaoComportamental_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PesquisaBemEstar" ADD CONSTRAINT "PesquisaBemEstar_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RegistroGamificacao" ADD CONSTRAINT "RegistroGamificacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Recompensa" ADD CONSTRAINT "Recompensa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ResgateRecompensa" ADD CONSTRAINT "ResgateRecompensa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CriterioPontuacao" ADD CONSTRAINT "CriterioPontuacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AvaliacaoCriterio" ADD CONSTRAINT "AvaliacaoCriterio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AcaoRadar" ADD CONSTRAINT "AcaoRadar_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "FeedbackLideranca" ADD CONSTRAINT "FeedbackLideranca_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "VendaPagamento" ADD CONSTRAINT "VendaPagamento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EstoqueReserva" ADD CONSTRAINT "EstoqueReserva_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DivergenciaCaixa" ADD CONSTRAINT "DivergenciaCaixa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- Validação das linhas existentes
ALTER TABLE "Auditoria" VALIDATE CONSTRAINT "Auditoria_empresaId_fkey";
ALTER TABLE "Categoria" VALIDATE CONSTRAINT "Categoria_empresaId_fkey";
ALTER TABLE "ComposicaoKit" VALIDATE CONSTRAINT "ComposicaoKit_empresaId_fkey";
ALTER TABLE "Estoque" VALIDATE CONSTRAINT "Estoque_empresaId_fkey";
ALTER TABLE "SessaoInventario" VALIDATE CONSTRAINT "SessaoInventario_empresaId_fkey";
ALTER TABLE "ContagemInventario" VALIDATE CONSTRAINT "ContagemInventario_empresaId_fkey";
ALTER TABLE "EstoqueSnapshotDiario" VALIDATE CONSTRAINT "EstoqueSnapshotDiario_empresaId_fkey";
ALTER TABLE "EstoqueMovimentacao" VALIDATE CONSTRAINT "EstoqueMovimentacao_empresaId_fkey";
ALTER TABLE "CompraFornecedor" VALIDATE CONSTRAINT "CompraFornecedor_empresaId_fkey";
ALTER TABLE "Compra" VALIDATE CONSTRAINT "Compra_empresaId_fkey";
ALTER TABLE "Venda" VALIDATE CONSTRAINT "Venda_empresaId_fkey";
ALTER TABLE "Caixa" VALIDATE CONSTRAINT "Caixa_empresaId_fkey";
ALTER TABLE "IntegracaoPDV" VALIDATE CONSTRAINT "IntegracaoPDV_empresaId_fkey";
ALTER TABLE "Financeiro" VALIDATE CONSTRAINT "Financeiro_empresaId_fkey";
ALTER TABLE "DRE" VALIDATE CONSTRAINT "DRE_empresaId_fkey";
ALTER TABLE "IndicadorDiario" VALIDATE CONSTRAINT "IndicadorDiario_empresaId_fkey";
ALTER TABLE "Meta" VALIDATE CONSTRAINT "Meta_empresaId_fkey";
ALTER TABLE "Departamento" VALIDATE CONSTRAINT "Departamento_empresaId_fkey";
ALTER TABLE "Cargo" VALIDATE CONSTRAINT "Cargo_empresaId_fkey";
ALTER TABLE "Funcionario" VALIDATE CONSTRAINT "Funcionario_empresaId_fkey";
ALTER TABLE "Documento" VALIDATE CONSTRAINT "Documento_empresaId_fkey";
ALTER TABLE "Advertencia" VALIDATE CONSTRAINT "Advertencia_empresaId_fkey";
ALTER TABLE "Suspensao" VALIDATE CONSTRAINT "Suspensao_empresaId_fkey";
ALTER TABLE "Desligamento" VALIDATE CONSTRAINT "Desligamento_empresaId_fkey";
ALTER TABLE "Ponto" VALIDATE CONSTRAINT "Ponto_empresaId_fkey";
ALTER TABLE "IntegracaoPonto" VALIDATE CONSTRAINT "IntegracaoPonto_empresaId_fkey";
ALTER TABLE "Alerta" VALIDATE CONSTRAINT "Alerta_empresaId_fkey";
ALTER TABLE "Notificacao" VALIDATE CONSTRAINT "Notificacao_empresaId_fkey";
ALTER TABLE "RegraAutomacao" VALIDATE CONSTRAINT "RegraAutomacao_empresaId_fkey";
ALTER TABLE "ConversaIA" VALIDATE CONSTRAINT "ConversaIA_empresaId_fkey";
ALTER TABLE "RelatorioGerado" VALIDATE CONSTRAINT "RelatorioGerado_empresaId_fkey";
ALTER TABLE "Folha" VALIDATE CONSTRAINT "Folha_empresaId_fkey";
ALTER TABLE "LancamentoFolha" VALIDATE CONSTRAINT "LancamentoFolha_empresaId_fkey";
ALTER TABLE "PagamentoRH" VALIDATE CONSTRAINT "PagamentoRH_empresaId_fkey";
ALTER TABLE "DecimoTerceiro" VALIDATE CONSTRAINT "DecimoTerceiro_empresaId_fkey";
ALTER TABLE "PixSettings" VALIDATE CONSTRAINT "PixSettings_empresaId_fkey";
ALTER TABLE "PixCobranca" VALIDATE CONSTRAINT "PixCobranca_empresaId_fkey";
ALTER TABLE "ChaveApi" VALIDATE CONSTRAINT "ChaveApi_empresaId_fkey";
ALTER TABLE "IntegracaoExterno" VALIDATE CONSTRAINT "IntegracaoExterno_empresaId_fkey";
ALTER TABLE "ShopeePedido" VALIDATE CONSTRAINT "ShopeePedido_empresaId_fkey";
ALTER TABLE "PlanoDesenvolvimento" VALIDATE CONSTRAINT "PlanoDesenvolvimento_empresaId_fkey";
ALTER TABLE "Treinamento" VALIDATE CONSTRAINT "Treinamento_empresaId_fkey";
ALTER TABLE "ParticipanteTreinamento" VALIDATE CONSTRAINT "ParticipanteTreinamento_empresaId_fkey";
ALTER TABLE "AvaliacaoComportamental" VALIDATE CONSTRAINT "AvaliacaoComportamental_empresaId_fkey";
ALTER TABLE "PesquisaBemEstar" VALIDATE CONSTRAINT "PesquisaBemEstar_empresaId_fkey";
ALTER TABLE "RegistroGamificacao" VALIDATE CONSTRAINT "RegistroGamificacao_empresaId_fkey";
ALTER TABLE "Recompensa" VALIDATE CONSTRAINT "Recompensa_empresaId_fkey";
ALTER TABLE "ResgateRecompensa" VALIDATE CONSTRAINT "ResgateRecompensa_empresaId_fkey";
ALTER TABLE "CriterioPontuacao" VALIDATE CONSTRAINT "CriterioPontuacao_empresaId_fkey";
ALTER TABLE "AvaliacaoCriterio" VALIDATE CONSTRAINT "AvaliacaoCriterio_empresaId_fkey";
ALTER TABLE "AcaoRadar" VALIDATE CONSTRAINT "AcaoRadar_empresaId_fkey";
ALTER TABLE "FeedbackLideranca" VALIDATE CONSTRAINT "FeedbackLideranca_empresaId_fkey";
ALTER TABLE "VendaPagamento" VALIDATE CONSTRAINT "VendaPagamento_empresaId_fkey";
ALTER TABLE "EstoqueReserva" VALIDATE CONSTRAINT "EstoqueReserva_empresaId_fkey";
ALTER TABLE "IdempotencyKey" VALIDATE CONSTRAINT "IdempotencyKey_empresaId_fkey";
ALTER TABLE "DivergenciaCaixa" VALIDATE CONSTRAINT "DivergenciaCaixa_empresaId_fkey";
