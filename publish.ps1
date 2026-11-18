# 一键发布到 GitHub：建仓库 + 推送 main 分支
#
# 用法（在本目录下打开 PowerShell）：
#   .\publish.ps1 -Token "ghp_你的token"
#
# Token 生成：https://github.com/settings/tokens  ->  Generate new token (classic)
#   勾选 repo 即可，有效期自选。用完可在同一页面 Revoke。

param(
    [Parameter(Mandatory=$true)][string]$Token,
    [string]$RepoName = "bing-rewards-bot",
    [string]$Description = "Windows 上用真实鼠标键盘驱动 Edge，自动完成 Microsoft Rewards 每日积分任务",
    [switch]$Private
)

$ErrorActionPreference = "Stop"
$Api = "https://api.github.com"
$Headers = @{
    Authorization           = "Bearer $Token"
    Accept                  = "application/vnd.github+json"
    "User-Agent"            = "bing-rewards-publish"
    "X-GitHub-Api-Version"  = "2022-11-28"
}

Write-Host "[1/5] 校验 token ..." -ForegroundColor Cyan
$me = Invoke-RestMethod -Uri "$Api/user" -Headers $Headers -Method Get
$user = $me.login
Write-Host "      登录账号: $user" -ForegroundColor Green

Write-Host "[2/5] 创建仓库 $user/$RepoName ..." -ForegroundColor Cyan
$exists = $true
try { $null = Invoke-RestMethod -Uri "$Api/repos/$user/$RepoName" -Headers $Headers -Method Get }
catch { $exists = $false }

if ($exists) {
    Write-Host "      仓库已存在，直接推送" -ForegroundColor Yellow
} else {
    $body = @{
        name        = $RepoName
        description = $Description
        private     = [bool]$Private
        has_issues  = $true
    } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$Api/user/repos" -Headers $Headers -Method Post -Body $body -ContentType "application/json"
    Write-Host "      已创建: https://github.com/$user/$RepoName" -ForegroundColor Green
}

Write-Host "[3/5] 配置 remote ..." -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin "https://github.com/$user/$RepoName.git"

Write-Host "[4/5] 推送 main ..." -ForegroundColor Cyan
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
git -c "http.extraHeader=Authorization: Basic $b64" push -u origin main
if ($LASTEXITCODE -ne 0) { throw "推送失败，退出码 $LASTEXITCODE" }

Write-Host "[5/5] 完成" -ForegroundColor Cyan
Write-Host "      仓库地址: https://github.com/$user/$RepoName" -ForegroundColor Green
Write-Host ""
Write-Host "提示：token 没有写进 .git/config。不再需要时去 https://github.com/settings/tokens 点 Revoke 作废。" -ForegroundColor DarkGray
