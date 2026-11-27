-- NEXUS CLUB (F-Foto): chave da foto do produto no armazenamento privado. Somente acréscimo;
-- "imagem" (link) continua como está e segue funcionando para os produtos antigos.
ALTER TABLE "Produto" ADD COLUMN "imagemChave" TEXT;
