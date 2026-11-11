$p = 'c:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/backend/prisma/schema.prisma'
$l = Get-Content $p
$l[1334] = '   // Guardadas separadamente porque o salário e as datas do cadastro podem'
$l[1335] = '   // mudar depois, mas o termo já impresso precisa continuar fiel ao que foi'
$l[1337] = '   // verbasTotal` Não fecha sozinha: `verbasTotal` inclui também 1/3, férias'
$l[1338] = '   // proporcionais e saldo de salário, que ganharam colunas próprias.'
$l[1339] = '   verbas13        Decimal?    @db.Decimal(12, 2) // 13º proporcional'
$l[1340] = '   verbasFerias    Decimal?    @db.Decimal(12, 2) // férias vencidas'
$l[1341] = '   verbasAviso     Decimal?    @db.Decimal(12, 2) // aviso prévio indenizado'
$l[1344] = '   // calculados no navegador com percentuais fixos e Não eram gravados: o PDF'
$l[1345] = '   // saía com números que o banco não conseguia reproduzir.'
$l | Set-Content $p -Encoding UTF8
Write-Host 'OK'