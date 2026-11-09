$content = Get-Content 'frontend/tsconfig.json' -Raw
$content = $content.Replace('    "baseUrl": ".",', '')

$content = $content.Replace('    "": ".",', '')
$content | Set-Content 'frontend/tsconfig.json'