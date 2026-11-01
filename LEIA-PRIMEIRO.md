# Nexus OS — Entrega unificada (revisão 2)

1. **Nexus-OS-Enterprise-Pack/**: módulos complementares com permissões por módulo e ação, autenticação do sistema, envio do token pela tela, restrição da medicina do trabalho, trava da nota fiscal e fluxo de aprovação sem atalhos. Leia `CORRECOES.md`.
2. **dominio/**: regras de negócio puras (financeiro, contabilidade, depreciação, produção, contratos, integração, fiscal e validação de CNPJ), com 58 testes. Para testar: entre na pasta e rode `npm test`. Leia `README.md`.

Os dois projetos ainda não estão ligados entre si nem ao banco do Nexus OS. Os limites estão descritos em cada arquivo.
