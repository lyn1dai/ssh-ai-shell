'use strict';

const KNOWN_SHELL_COMMANDS = new Set([
  'ls', 'll', 'la', 'cd', 'pwd', 'cat', 'echo', 'grep', 'egrep', 'fgrep', 'find', 'mkdir', 'rmdir',
  'rm', 'cp', 'mv', 'touch', 'chmod', 'chown', 'chgrp', 'ln', 'stat', 'file', 'du', 'df', 'free',
  'ps', 'top', 'htop', 'kill', 'killall', 'pkill', 'pgrep', 'jobs', 'fg', 'bg', 'nohup',
  'sudo', 'su', 'useradd', 'userdel', 'usermod', 'passwd', 'groupadd', 'groupdel',
  'apt', 'apt-get', 'apt-cache', 'yum', 'dnf', 'rpm', 'dpkg', 'brew', 'snap', 'flatpak',
  'pip', 'pip3', 'conda', 'npm', 'yarn', 'pnpm', 'npx', 'node', 'python', 'python3',
  'java', 'javac', 'mvn', 'gradle', 'go', 'cargo', 'rustc',
  'git', 'svn', 'hg',
  'docker', 'docker-compose', 'kubectl', 'helm', 'minikube', 'k3s',
  'systemctl', 'service', 'journalctl', 'cron', 'crontab',
  'ssh', 'scp', 'sftp', 'rsync', 'wget', 'curl', 'ping', 'traceroute', 'netstat', 'ss', 'ip',
  'ifconfig', 'iptables', 'firewall-cmd', 'nmap', 'nc', 'telnet', 'dig', 'nslookup',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'bzip2', 'xz', '7z',
  'vim', 'vi', 'nano', 'emacs', 'less', 'more', 'head', 'tail', 'sort', 'uniq', 'wc', 'cut',
  'tr', 'tee', 'xargs', 'awk', 'sed', 'diff', 'patch', 'column', 'jq', 'yq',
  'make', 'cmake', 'gcc', 'g++', 'cc', 'ld', 'nm', 'objdump',
  'mount', 'umount', 'fdisk', 'parted', 'lsblk', 'blkid',
  'uname', 'hostname', 'whoami', 'id', 'uptime', 'date', 'cal', 'history', 'alias', 'which',
  'whereis', 'type', 'source', 'export', 'env', 'printenv', 'set', 'unset',
  'clear', 'reset', 'exit', 'logout', 'reboot', 'shutdown', 'halt', 'poweroff', 'init',
  'screen', 'tmux', 'watch', 'time', 'timeout',
  'mysql', 'psql', 'redis-cli', 'mongo', 'sqlite3',
  'nginx', 'apache2', 'httpd', 'php', 'perl', 'ruby', 'rake', 'bundle',
]);

function looksLikeObviousShellCommand(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^[./~]/.test(t)) return true;
  if (/[|>&;`$()]/.test(t)) return true;
  if (/^\w+=/.test(t)) return true;

  const words = t.split(/\s+/);
  const firstWord = (words[0] || '').toLowerCase().replace(/^.*\//, '');
  if (KNOWN_SHELL_COMMANDS.has(firstWord)) return true;
  if (/(?:^|\s)--?[a-zA-Z]/.test(t)) return true;
  if (/^[a-zA-Z]+-[a-zA-Z]/.test(words[0] || '')) return true;
  return false;
}

function classifyInlineInput(text) {
  const t = String(text || '').trim();
  if (!t) return 'shell';
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t)) return 'natural';
  if (/^[./~]/.test(t)) return 'shell';
  if (/[|>&;`$()]/.test(t)) return 'shell';
  if (/^\w+=/.test(t)) return 'shell';

  const words = t.split(/\s+/);
  const firstWord = (words[0] || '').toLowerCase().replace(/^.*\//, '');
  if (KNOWN_SHELL_COMMANDS.has(firstWord)) return 'shell';
  if (/^\S+$/.test(t) && /^[a-zA-Z0-9_.-]+$/.test(t)) return 'shell';
  if (/(?:^|\s)--?[a-zA-Z]/.test(t)) return 'shell';
  if (/^[a-zA-Z]+-[a-zA-Z]/.test(words[0] || '')) return 'shell';
  if (/^[A-Z]/.test(t) && words.length >= 3) return 'natural';
  if (words.length >= 4) return 'natural';
  return 'shell';
}

function classifyPastedText(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'uncertain';

  if (text.startsWith('/cmd ')) return 'command';
  if (text.startsWith('/nl ')) return 'natural_language';

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 'uncertain';

  const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  const hasTaskWords = /(增加|修改|删除|替换|在.+中|帮我|请|写入|更新|执行以下|运行以下|粘贴到|配置)/.test(text);
  // Exclude URL-scheme lines (http://, https://, git://, etc.) from YAML detection —
  // they match the key: value pattern but are not config content.
  const hasYamlLike = lines.some(line => /^[\w.-]+\s*:\s*.+$/.test(line) && !/^\w+:\/\//.test(line))
    || lines.some(line => /^[\w.-]+\s*:\s*$/.test(line));
  const hasJsonLike = /^[\[{]/.test(text);
  const hasShellOps = /(&&|\|\||\||>|<|2>&1|;)/.test(text);
  const hasCodeFence = /```/.test(text);

  // Single-line pastes like `git clone ...` should execute as commands instead of
  // falling through to the conservative `uncertain -> natural` path.
  if (
    lines.length === 1
    && !hasChinese
    && !hasTaskWords
    && !hasYamlLike
    && !hasJsonLike
    && looksLikeObviousShellCommand(lines[0].replace(/^\$\s*/, ''))
  ) {
    return 'command';
  }

  let commandLikeLines = 0;
  for (const line of lines) {
    const normalized = line.replace(/^\$\s*/, '');
    if (classifyInlineInput(normalized) === 'shell') {
      commandLikeLines += 1;
    }
  }

  const nonCommandLikeLines = lines.length - commandLikeLines;
  let nlScore = 0;
  let cmdScore = 0;
  let structuredScore = 0;

  if (hasChinese) nlScore += 2;
  if (hasTaskWords) nlScore += 3;
  if (hasYamlLike || hasJsonLike) structuredScore += 3;
  if (hasShellOps) cmdScore += 2;
  if (hasCodeFence && /```(bash|sh|shell|powershell|ps1)/i.test(text)) cmdScore += 3;
  if (hasCodeFence && /```(yaml|yml|json|sql|md)/i.test(text)) {
    nlScore += 2;
    structuredScore += 2;
  }

  cmdScore += Math.min(4, commandLikeLines);
  if (nonCommandLikeLines > commandLikeLines) nlScore += 2;

  const looksMixed = hasTaskWords && (commandLikeLines > 0 || hasYamlLike || hasJsonLike);
  if (looksMixed && commandLikeLines > 0) return 'mixed';
  if (nlScore + structuredScore >= cmdScore + 2) return 'natural_language';

  const commandRatio = commandLikeLines / lines.length;
  if (cmdScore >= nlScore + structuredScore + 2 && commandRatio >= 0.6) return 'command';
  return 'uncertain';
}

module.exports = {
  classifyInlineInput,
  classifyPastedText,
};
