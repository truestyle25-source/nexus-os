# NEXUS OS — produção

## Backend

Configure:

- `DATABASE_URL`
- `JWT_SECRET` com pelo menos 32 caracteres
- `FRONTEND_URLS`
- `OPENAI_API_KEY` quando a NEXUS AI estiver habilitada
- `INFINITEPAY_CHECKOUT_URL` quando o checkout estiver configurado

Depois:

```bash
cd backend
npm install
npm run prisma:generate
npm run db:migrate
npm run build
npm start
```

O primeiro cadastro deve ser feito por `/auth/register-company`. O seed não cria dados fictícios.

## Frontend

Configure `NEXT_PUBLIC_API_URL` apontando para o backend público e execute:

```bash
cd frontend
npm install
npm run build
npm start
```

## Control iD / iDClass

A integração de ponto usa somente a API oficial documentada pelo fabricante. O NEXUS executa login, leitura de `access_logs` e logout no equipamento. A senha da integração é armazenada criptografada no banco e nunca é retornada pela API.

O vínculo dos logs usa `user_id` do equipamento contra `Funcionario.idExternoPonto`. Os registros são agrupados por funcionário/data e as batidas são vinculadas, em ordem cronológica, aos quatro campos de ponto existentes no schema.

## PDV

O NEXUS não inventa integração de PDV. Sem um fornecedor, API/SDK/webhook ou banco oficialmente autorizado fornecido pelo proprietário, a integração permanece `NAO_CONFIGURADO` e a sincronização não simula dados.

## Limitação conhecida

A recuperação de senha tem os dois lados implementados: `POST /auth/recuperar-senha` gera um token (hash SHA-256, validade de 1h, auditado) e `POST /auth/redefinir-senha` o consome para trocar a senha. O que falta é só a entrega: o projeto não inclui um provedor de e-mail, então o token nunca chega ao usuário fora do banco. Não foi criado um mecanismo fictício de envio. Para entrega real, conecte um serviço de e-mail autorizado e envie o token recebido em `recuperar-senha` (ele não é retornado pela API, por segurança).

## Empresa suspensa

`Empresa.status` (StatusGeral) controla o acesso de toda a empresa. Se `status != ATIVO`, o login e todo endpoint autenticado retornam 403, mesmo com um token ainda válido. Hoje nada altera esse campo automaticamente — é um gancho pronto para a Fase 3 (Assinatura/inadimplência) usar, não uma cobrança automática já ligada.
