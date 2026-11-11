$file = 'c:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/backend/src/modules/dashboard/dashboard.routes.ts'
$content = Get-Content $file
# Substituir (app as any).authenticate por app.authenticate
$content = $content -replace '(app as any)\.authenticate', 'app.authenticate'
$content = $content -replace '(req as any)\.user', 'req.user'
$content | Set-Content $file -Encoding UTF8
Write-Host 'OK - dashboard.routes.ts'