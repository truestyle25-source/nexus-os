-- ===========================================================================
--  Ciclo 5 — correção: o evento de treinamento mede PRESENÇA, não "conclusão"
-- ===========================================================================
--
--  AO LER O ENUM, O NEXUS DESCOBRIU QUE NÃO EXISTE STATUS "CONCLUÍDO".
--  `StatusParticipante` tem CONVIDADO, CONFIRMADO, PRESENTE, AUSENTE e
--  CANCELADO. Nenhum deles significa "terminou o curso".
--
--  Um `where: { status: 'CONCLUIDO' }` compilaria no TypeScript e devolveria
--  ZERO linhas para sempre — e o pior efeito do possível: um critério de
--  "concluiu 2 treinamentos" com `MAIOR_OU_IGUAL 2` nunca creditaria, sem erro
--  em lugar nenhum. A empresa acharia que a política dela estava quebrada.
--
--  A correção é RENOMEAR o evento, não forçar um status inventado. O dado real
--  disponível é a presença, e é isso que o evento passa a significar. Uma
--  empresa que quiser惩罚 conclusão pode pedir o campo de aproveitamento como
--  evolução própria — com dado próprio, como este ciclo exige.

-- RenameEnumValue: o nome antigo prometia uma coisa que o banco não tem.
ALTER TYPE "EventoPontuacao" RENAME VALUE 'TREINAMENTO_CONCLUIDO' TO 'TREINAMENTO_PRESENTE';
