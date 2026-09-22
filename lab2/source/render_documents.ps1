$ErrorActionPreference = 'Stop'
$lab2Root = Split-Path $PSScriptRoot -Parent
$lab2Word = New-Object -ComObject Word.Application
$lab2Word.Visible = $false
$lab2Word.DisplayAlerts = 0
try {
    foreach ($lab2Name in @('Deliverables','AI-Critique-Report')) {
        $lab2Input = Join-Path $lab2Root ($lab2Name + '.docx')
        if (-not (Test-Path -LiteralPath $lab2Input)) { continue }
        $lab2Doc = $lab2Word.Documents.Open($lab2Input, $false, $true)
        try {
            $lab2Doc.Repaginate()
            $lab2Doc.ExportAsFixedFormat((Join-Path $lab2Root ($lab2Name + '.pdf')), 17)
        } finally { $lab2Doc.Close(0) }
        $lab2Qa = Join-Path $lab2Root ('qa/' + $lab2Name)
        New-Item -ItemType Directory -Force $lab2Qa | Out-Null
        & 'C:\Users\Raymond\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe' -scale-to 1600 -png (Join-Path $lab2Root ($lab2Name + '.pdf')) (Join-Path $lab2Qa 'page')
        if ($LASTEXITCODE -ne 0) { throw 'PDF page rendering failed' }
    }
} finally { $lab2Word.Quit() }
