# Nexus OS — Domínio (regras de negócio puras)

Este pacote contém a lógica de cálculo dos módulos pedidos: financeiro, contabilidade, patrimônio, produção, contratos, integração entre módulos e fiscal.

Não tem banco, não tem rotas e não tem telas. Por isso pode ser compilado e testado sem nenhuma dependência externa.

## Como rodar
```
npm test
```
Compila o TypeScript (`tsc`) e roda 54 testes com o test runner nativo do Node.

## O que está implementado e testado

| Módulo | Arquivo | Implementado | Não implementado |
|---|---|---|---|
| Datas e valores | `src/datas.ts` | Datas reais, soma de meses com ajuste de fim de mês, valores em centavos | — |
| Financeiro | `src/financeiro.ts` | Títulos a pagar e receber, baixas parciais e totais, situação (aberto, vencido, parcial, pago, cancelado), fluxo de caixa diário projetado, conciliação automática por valor exato e data | Juros e multa, cobrança, boleto, conciliação de pagamento parcial, leitura de arquivo bancário (OFX) |
| Contabilidade | `src/contabilidade.ts` | Plano de contas em árvore, contas sintéticas e analíticas, lançamentos em partidas dobradas (recusa desbalanceado), balancete | Encerramento de exercício, apuração de impostos, livros oficiais |
| Patrimônio | `src/patrimonio.ts` | Depreciação linear mensal, cronograma que fecha exatamente na base, valor residual, depreciado até uma data | Outros métodos de depreciação, reavaliação, baixa de bem |
| Produção | `src/producao.ts` | Consumo previsto pela ficha técnica, comparação previsto x realizado em percentual | Custo de produção, apontamento por operação, baixa automática de estoque |
| Contratos | `src/contratos.ts` | Renovação automática com reajuste, alerta de contratos sem renovação que vencem em N dias | Aditivos, multas, cronograma de faturamento |
| Integração | `src/integracao.ts` | Compra aprovada gera conta a pagar e entrada de estoque. Venda finalizada gera contas a receber por parcela e saída de estoque. Chaves de idempotência | **Nada é gravado.** A função só descreve o efeito. A aplicação em banco numa transação ainda precisa ser feita |
| Fiscal | `src/fiscal.ts` | Estados de documento, validação de dados antes de transmitir, trava para que o usuário não declare nota autorizada | **Não gera XML, não assina, não transmite.** Sem provedor fiscal configurado, a emissão falha de forma explícita |

## Limites que precisam ser declarados

1. **A integração entre módulos ainda não acontece.** `efeitosCompraAprovada` e `efeitosVendaFinalizada` dizem o que deveria ser criado. Quem aplica esses efeitos no banco, de forma atômica e idempotente, é a camada que ainda não existe.
2. **Baixa de título não gera lançamento contábil automaticamente.** A ligação entre financeiro e contabilidade é uma tarefa separada.
3. **Conciliação é só por valor exato.** Diferenças de tarifa, juros ou pagamento parcial exigem conferência manual.
4. **Emissão de nota fiscal eletrônica não existe neste pacote.** Ela depende de certificado digital, homologação no órgão fiscal do estado e de um provedor escolhido por você.
5. **Não há telas.** As regras existem, mas nenhum usuário consegue usá-las ainda.
6. **Os testes validam as regras, não o sistema.** Não há teste de banco, de rotas nem de permissões nesta parte.

## Próximos passos, em ordem
1. Persistir títulos, lançamentos, bens, contratos e notas nas tabelas do Nexus, usando as funções deste pacote dentro de transações.
2. Aplicar os efeitos de integração numa única transação, guardando as chaves de idempotência para evitar duplicidade.
3. Ligar as baixas de título ao lançamento contábil correspondente.
4. Criar as rotas com permissões por módulo e ação, como no pacote corrigido.
5. Escolher o provedor fiscal e só então implementar a transmissão.
