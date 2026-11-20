import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const upstream = 'https://github.com/fengwk/html-view-skill.git';
const win = process.platform === 'win32';
const run = (bin, args, options) => spawnSync(bin, args, { encoding: 'utf8', timeout: 30_000, ...options });
const output = result => [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
function ok(result) {
  assert.equal(result.status, 0, output(result));
  return result.stdout.trim();
}
function refuses(result, reason) {
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, reason);
}
const linkDirectory = (target, path) => symlinkSync(target, path, win ? 'junction' : 'dir');

// Exercise the downloaded file in an isolated HOME. Redirect the real clone URL to a local Git repo.
function fixture(t, shell) {
  const path = mkdtempSync(join(tmpdir(), 'html-view-test-'));
  t.after(() => rmSync(path, { force: true, recursive: true }));
  const home = join(path, 'user home'), remote = join(path, 'remote'), scripts = join(path, 'downloaded');
  for (const dir of [home, remote, scripts]) mkdirSync(dir);
  const script = join(scripts, `install-html-view.${shell.ext}`);
  cpSync(join(root, `scripts/install.${shell.ext}`), script);
  mkdirSync(join(remote, 'skills'));
  cpSync(join(root, 'skills/html-view'), join(remote, 'skills/html-view'), { recursive: true });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, INSTALL_TEST_HOME: home, INSTALL_TEST_SCRIPT: script,
    GIT_CONFIG_GLOBAL: join(path, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (directory, ...args) => ok(run('git', ['-C', directory, ...args], { env }));
  git(remote, 'init', '-q', '-b', 'main');
  git(remote, 'config', '--global', `url.${pathToFileURL(remote).href}.insteadOf`, upstream);
  git(remote, 'add', '.');
  git(remote, '-c', 'user.name=Installer test', '-c', 'user.email=installer@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  const repo = join(home, '.agents/skill-lib/html-view-skill');
  const skill = join(repo, 'skills/html-view');
  const agents = join(home, '.agents/skills');
  const claude = join(home, '.claude/skills');
  const install = () => run(shell.bin, shell.args(script), { cwd: scripts, env });
  // `curl … | bash` runs the script from standard input, possibly cut short by a dropped connection.
  const pipe = (text = readFileSync(script, 'utf8')) => run(shell.bin, [], { cwd: scripts, env, input: text });
  const clone = () => {
    mkdirSync(join(home, '.agents/skill-lib'), { recursive: true });
    git(home, 'clone', '--', upstream, repo);
  };
  return { path, home, repo, skill, remote, agents, claude, git, install, pipe, script, clone };
}

function assertLink(directory, skill) {
  const path = join(directory, 'html-view');
  assert.ok(lstatSync(path).isSymbolicLink(), `${path} must be a link, not a copy`);
  // Native resolution normalizes Windows short names as well as following the junction.
  assert.equal(realpathSync.native(path), realpathSync.native(skill));
  return path;
}

const bash = !win && run('bash', ['-c', 'exit 0']).status === 0;
const powershell = ['pwsh', ...(win ? ['powershell.exe'] : [])]
  .find(exe => run(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0);
const gitAvailable = run('git', ['--version']).status === 0;
const shells = [
  { name: 'Bash', ext: 'sh', bin: bash && 'bash', args: script => [script] },
  { name: 'PowerShell', ext: 'ps1', bin: powershell, args: () => [
    '-NoProfile', '-NonInteractive', ...(win ? ['-ExecutionPolicy', 'RemoteSigned'] : []), '-Command',
    'Set-Variable -Name HOME -Value $env:INSTALL_TEST_HOME -Force -Scope Global; & $env:INSTALL_TEST_SCRIPT',
  ] },
];

// A CI job must exercise its requested shell; missing tools must not look like a green run.
const requiredShell = process.env.HTMLVIEW_INSTALL_TEST_SHELL;
const selectedShells = requiredShell ? shells.filter(({ name }) => name === requiredShell) : shells;
if (requiredShell) assert.ok(selectedShells[0]?.bin && gitAvailable, `Installer tests require ${requiredShell} and Git`);

for (const shell of selectedShells) {
  const needsTools = { skip: !(shell.bin && gitAvailable) };
  test(`${shell.name}: recover from a failed clone, link both clients and reuse the checkout offline`, needsTools, t => {
    const f = fixture(t, shell);
    const unavailable = join(f.path, 'unavailable-remote');
    // A failed clone reports what happened and must not register a broken skill.
    renameSync(f.remote, unavailable);
    refuses(f.install(), /Could not clone into/);
    assert.ok(!existsSync(f.agents) && !existsSync(f.claude));
    renameSync(unavailable, f.remote);
    assert.match(ok(f.install()), /Using checkout:/);
    assert.equal(f.git(f.repo, 'config', '--local', '--get', 'remote.origin.url'), upstream);
    const head = f.git(f.repo, 'rev-parse', 'HEAD');
    const entry = assertLink(f.agents, f.skill);
    const other = assertLink(f.claude, f.skill);
    assert.match(ok(run(process.execPath, [join(entry, 'scripts/htmlview'), '--help'])), /htmlview/);
    assert.ok(!existsSync(join(f.home, '.pi')));

    // A healthy, edited checkout can restore one link even when the source remote is gone.
    const file = join(f.skill, 'SKILL.md');
    const edited = `${readFileSync(file, 'utf8')}\nUser edit\n`;
    writeFileSync(file, edited);
    renameSync(f.remote, unavailable);
    rmSync(other);
    assert.match(ok(f.install()), /Skipped existing entry \(unchanged\)/);
    assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), head);
    assert.equal(readFileSync(file, 'utf8'), edited);
    assertLink(f.agents, f.skill);
    assertLink(f.claude, f.skill);
  });

  // The README installs with `curl -fsSL <raw URL> | bash`.
  test(`${shell.name}: install from a pipe, and change nothing when the download is cut short`, { skip: needsTools.skip || shell.name !== 'Bash' }, t => {
    const f = fixture(t, shell);
    const text = readFileSync(f.script, 'utf8');
    // Cut right after the complete clone step: the partial text must still change nothing.
    const cut = f.pipe(text.slice(0, text.indexOf('[[ -d $repo')));
    assert.notEqual(cut.status, null, output(cut));
    assert.ok(!existsSync(join(f.home, '.agents')) && !existsSync(join(f.home, '.claude')), output(cut));
    assert.match(ok(f.pipe()), /Using checkout:/);
    assertLink(f.agents, f.skill);
    assertLink(f.claude, f.skill);
  });

  test(`${shell.name}: leave an existing directory and a dangling link untouched`, needsTools, t => {
    const f = fixture(t, shell);
    const vendor = join(f.home, 'other-skill-registry');
    mkdirSync(join(vendor, 'html-view'), { recursive: true });
    mkdirSync(join(f.home, '.agents'));
    linkDirectory(vendor, f.agents);
    const existing = join(vendor, 'html-view', 'owner.txt');
    writeFileSync(existing, 'user data');
    mkdirSync(f.claude, { recursive: true });
    const missing = join(f.home, 'missing-skill');
    const dangling = join(f.claude, 'html-view');
    linkDirectory(missing, dangling);
    const log = ok(f.install());
    assert.equal([...log.matchAll(/Skipped existing entry \(unchanged\)/g)].length, 2);
    assert.equal(readFileSync(existing, 'utf8'), 'user data');
    assert.deepEqual(readdirSync(join(vendor, 'html-view')), ['owner.txt']);
    assert.ok(lstatSync(dangling).isSymbolicLink());
    assert.ok(!existsSync(missing));
  });

  test(`${shell.name}: reject a noncheckout without cloning over it or creating links`, needsTools, t => {
    const f = fixture(t, shell);
    mkdirSync(f.repo, { recursive: true });
    refuses(f.install(), /not a Git checkout/);
    assert.deepEqual(readdirSync(f.repo), []);
    assert.ok(!existsSync(f.agents) && !existsSync(f.claude));
  });

  test(`${shell.name}: reject a foreign origin or a checkout missing a tracked asset`, needsTools, t => {
    const f = fixture(t, shell);
    f.clone();
    f.git(f.repo, 'remote', 'set-url', 'origin', 'https://example.test/another/project.git');
    refuses(f.install(), /origin is not the HTML View project/);
    assert.ok(!existsSync(f.agents) && !existsSync(f.claude));
    f.git(f.repo, 'remote', 'set-url', 'origin', 'git@github.com:fengwk/html-view-skill.git');
    const missing = join(f.skill, 'assets/page/reading.css');
    rmSync(missing);
    refuses(f.install(), /tracked skill files are missing/);
    assert.ok(!existsSync(missing) && !existsSync(f.agents) && !existsSync(f.claude));
  });
}
