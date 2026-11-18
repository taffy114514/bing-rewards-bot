# Publish this repo to GitHub: create the repo, then push main.
#
# Usage (from this folder):
#   .\publish.ps1 -Token "ghp_your_token"
#
# Token: https://github.com/settings/tokens  ->  Generate new token (classic)
#   Scope required: repo.  Revoke it on the same page when you are done.

param(
    [Parameter(Mandatory=$true)][string]$Token,
    [string]$RepoName = "bing-rewards-bot",
    [string]$Description = "Automate Microsoft Rewards daily points on Windows with real mouse/keyboard input driving Edge",
    [switch]$Private
)

$ErrorActionPreference = "Stop"
$Api = "https://api.github.com"
$Headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = "application/vnd.github+json"
    "User-Agent"           = "bing-rewards-publish"
    "X-GitHub-Api-Version" = "2022-11-28"
}

Write-Host "[1/5] Checking token ..." -ForegroundColor Cyan
$me = Invoke-RestMethod -Uri "$Api/user" -Headers $Headers -Method Get
$user = $me.login
Write-Host "      Signed in as: $user" -ForegroundColor Green

Write-Host "[2/5] Creating repo $user/$RepoName ..." -ForegroundColor Cyan
$exists = $true
try {
    $null = Invoke-RestMethod -Uri "$Api/repos/$user/$RepoName" -Headers $Headers -Method Get
} catch {
    $exists = $false
}

if ($exists) {
    Write-Host "      Repo already exists, pushing to it." -ForegroundColor Yellow
} else {
    $body = @{
        name        = $RepoName
        description = $Description
        private     = [bool]$Private
        has_issues  = $true
    } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$Api/user/repos" -Headers $Headers -Method Post -Body $body -ContentType "application/json"
    Write-Host "      Created: https://github.com/$user/$RepoName" -ForegroundColor Green
}

Write-Host "[3/5] Configuring remote ..." -ForegroundColor Cyan
$remotes = @(git remote)
if ($remotes -contains "origin") { git remote remove origin | Out-Null }
git remote add origin "https://github.com/$user/$RepoName.git"

Write-Host "[4/5] Pushing main ..." -ForegroundColor Cyan
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
git -c "http.extraHeader=Authorization: Basic $b64" push -u origin main
if ($LASTEXITCODE -ne 0) { throw "push failed, exit code $LASTEXITCODE" }

Write-Host "[5/5] Done" -ForegroundColor Cyan
Write-Host "      Repo: https://github.com/$user/$RepoName" -ForegroundColor Green
Write-Host ""
Write-Host "Note: the token is NOT written to .git/config. Revoke it at https://github.com/settings/tokens when finished." -ForegroundColor DarkGray
