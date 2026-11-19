[CmdletBinding(PositionalBinding = $false)]
param([Alias('h')][switch] $Help)

$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'Usage: .\install.ps1'
    Write-Output 'Clones into ~/.agents/skill-lib/html-view-skill and links html-view in'
    Write-Output '~/.agents/skills and ~/.claude/skills. Existing entries are not replaced.'
    return
}

function Stop-Install([string] $Message) {
    [Console]::Error.WriteLine("html-view install: $Message")
    exit 1
}

if (-not $HOME) { Stop-Install 'HOME is not set.' }
$git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $git) { Stop-Install 'Install Git and retry.' }
$url = 'https://github.com/fengwk/html-view-skill.git'
$repo = Join-Path $HOME '.agents/skill-lib/html-view-skill'
$skill = Join-Path $repo 'skills/html-view'

function Test-Entry([string] $Path) {
    $parent = [IO.Path]::GetDirectoryName($Path)
    if (-not [IO.Directory]::Exists($parent)) { return $false }
    # List the entry itself, without resolving a potentially dangling directory link.
    return [IO.Directory]::GetFileSystemEntries($parent, [IO.Path]::GetFileName($Path)).Length -gt 0
}

function Invoke-InstallGit([string[]] $GitArgs) {
    # Windows PowerShell may surface native stderr as errors. Check Git's exit code ourselves.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    & $git.Source @GitArgs
}

function Stop-BadCheckout([string] $Reason) {
    Stop-Install "Cannot use ${repo}: $Reason. Repair it or move it aside and rerun; it was not replaced."
}

if (-not (Test-Entry $repo)) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $repo))
    Invoke-InstallGit @('clone', '--', $url, $repo)
    if ($LASTEXITCODE -ne 0) { Stop-Install "Could not clone into $repo. Check the Git error above and retry." }
}

if (-not (Test-Path -LiteralPath $repo -PathType Container) -or -not (Test-Entry (Join-Path $repo '.git'))) {
    Stop-BadCheckout 'not a Git checkout'
}
$inside = Invoke-InstallGit @('-C', $repo, 'rev-parse', '--is-inside-work-tree')
if ($LASTEXITCODE -ne 0 -or $inside -ne 'true') { Stop-BadCheckout 'not a Git worktree' }
$prefix = Invoke-InstallGit @('-C', $repo, 'rev-parse', '--show-prefix')
if ($LASTEXITCODE -ne 0 -or $prefix) { Stop-BadCheckout 'not a checkout root' }
$null = Invoke-InstallGit @('-C', $repo, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}')
if ($LASTEXITCODE -ne 0) { Stop-BadCheckout 'HEAD is missing or invalid' }
# Compare the configured URL, not the rewritten transport URL used by Git mirrors.
$origin = Invoke-InstallGit @('-C', $repo, 'config', '--local', '--get', 'remote.origin.url')
if ($LASTEXITCODE -ne 0) { Stop-BadCheckout 'missing origin URL' }
if ($origin -isnot [string] -or $origin -notmatch '\A(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)fengwk/html-view-skill(?:\.git)?/?\z') {
    Stop-BadCheckout 'origin is not the HTML View project'
}
foreach ($file in @('SKILL.md', 'scripts/htmlview', 'scripts/src/cli/main.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $skill $file) -PathType Leaf)) { Stop-BadCheckout 'skill files are missing' }
}
Invoke-InstallGit @('-C', $repo, 'diff', '--quiet', '--no-renames', '--diff-filter=D', 'HEAD', '--', 'skills/html-view')
if ($LASTEXITCODE -ne 0) { Stop-BadCheckout 'tracked skill files are missing or Git could not read the checkout' }
Write-Output "Using checkout: $repo"

# Directory junctions on Windows do not require the symbolic-link privilege.
$linkType = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
foreach ($relative in @('.agents/skills', '.claude/skills')) {
    $dir = Join-Path $HOME $relative
    $target = Join-Path $dir 'html-view'
    if (Test-Entry $target) {
        Write-Output "Skipped existing entry (unchanged): $target"
        continue
    }
    $null = [IO.Directory]::CreateDirectory($dir)
    $null = New-Item -ItemType $linkType -Path $target -Value $skill
    Write-Output "Linked: $target -> $skill"
}
