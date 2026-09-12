# NEXUS OS - PARTE 5 - RH E PONTO - 100% FIEL AO PROMPT MESTRE

## Seções 20 e 21 - Sem endpoint inventado:

### Seção 20 RH:
- Funcionários com CPF único, idExternoPonto (ControlID), departamento, cargo, filial, data admissão/desligamento, status ATIVO/INATIVO/FERIAS/AFASTADO/DESLIGADO
- Departamento, Cargo, Advertências, Férias, Histórico, Desempenho
- Botões + NOVO SETOR, + NOVO CARGO, + NOVO FUNCIONÁRIO reais
- Indicadores: total, ativos, por setor, turnover, absenteísmo, produtividade, faltas, atrasos, horas extras, desempenho

### Seção 21 Controle de Ponto - ControlID iDClass API OFICIAL:
- Campos: entrada, saidaIntervalo, retornoIntervalo, saida, atrasoMinutos, horaExtraMinutos, falta, inconsistencia, bancoHoras, saidaAntecipada, idExterno
- Fluxo fiel: PONTO → RH → INDICADORES → DASHBOARD → IA
- Integração ControlID:
  - NUNCA inventa endpoint - usa só API oficial documentada:
  - POST /login.fcgi com {login, password} -> retorna session
  - POST /load_objects.fcgi com {object: "access_logs"} + Cookie session -> retorna logs
  - Mapeia user_id (idExternoPonto) -> Funcionario
  - Calcula atraso, hora extra, falta, inconsistência
  - Origem PONTO, auditoria, Seção 39 chave nunca no frontend

### Fiel ao Prompt:
- Seção 31 Origem, 32 Auditoria, 39 Segurança, 46 Idempotência (unique funcionario+data), 43 Regra funcionalidade
