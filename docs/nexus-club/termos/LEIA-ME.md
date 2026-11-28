# Termos de Uso e Política de Privacidade — NEXUS CLUB

> **Situação: MINUTA (versão 0.1, 27/11/2026). NÃO está publicada e não pode ser publicada como está.**
> O cadastro de clientes do NEXUS CLUB só abre depois que as duas versões finais forem publicadas.

## Arquivos
| Arquivo | O que é |
|---|---|
| `TERMOS_USO.minuta.md` | Parte I da minuta (Termos de Uso do NEXUS OS e do NEXUS CLUB) |
| `POLITICA_PRIVACIDADE.minuta.md` | Parte II da minuta (Política de Privacidade) |
| `FATOS_TECNICOS_PARA_REVISAO.md` | O que o sistema faz de verdade (fornecedores, onde ficam os dados, segurança, cookies), para o advogado |

As orientações internas e o checklist da minuta original não foram copiados para os textos: eles não podem ir para o público.

## O que falta antes de publicar
1. Preencher os campos entre colchetes: razão social, CNPJ, endereço, e-mails e canais de suporte e de
   privacidade, encarregado (DPO) ou canal, links, data de publicação (21 campos no total).
2. Decidir: idade mínima para usar o NEXUS CLUB; se a data de nascimento continua no cadastro; como explicar o CPF obrigatório.
3. Ajustar o texto com os fatos de `FATOS_TECNICOS_PARA_REVISAO.md` (ex.: banco de dados nos EUA → transferência internacional; não há autenticação em dois fatores).
4. Revisão por advogado(a) com experiência em LGPD, SaaS e comércio eletrônico.
5. Tirar a marca "MINUTA" do topo dos arquivos.

## Como publicar (quando estiver pronto)
Cada tipo é publicado separadamente e vira uma versão nova (quem aceitou fica ligado à versão exata;
versão nova pede novo aceite). Com `DATABASE_URL` do banco certo, dentro de `backend/`:

```
npm run club:publicar-termo -- TERMOS_USO ../docs/nexus-club/termos/TERMOS_USO.final.md
npm run club:publicar-termo -- POLITICA_PRIVACIDADE ../docs/nexus-club/termos/POLITICA_PRIVACIDADE.final.md
```

Sem `--confirmar` o comando só mostra o que faria. O comando **recusa** texto que ainda tenha campos entre
colchetes ou a palavra "MINUTA".
