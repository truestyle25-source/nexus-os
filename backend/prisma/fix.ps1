$p = 'backend/prisma/schema.prisma'
$l = Get-Content $p
$nl = @()
for ($i = 0; $i -lt $l.Count; $i++) {
    if ($l[$i] -match '^   tipoLabel' -and $i + 1 -lt $l.Count -and $l[$i+1] -match '^   tipoLabel') {
        $i++
    } else {
        $nl += $l[$i]
    }
}
$nl | Set-Content $p