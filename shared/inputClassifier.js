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

function looksLikeStandaloneRepoReference(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return false;

  if (/^(?:https?|git|ssh):\/\//i.test(t)) return true;
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(t)) return true;
  if (/^[\w.-]+\/(?:[\w.-]+\/){1,}[\w.-]+(?:\.git)?$/i.test(t)) return true;

  return false;
}

function looksLikeObviousShellCommand(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (looksLikeStandaloneRepoReference(t)) return true;
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
  if (looksLikeStandaloneRepoReference(t)) return 'shell';
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

/**
 * Detect lines that act as context/reference markers, e.g.
 * "参考下这个", "参考一下", "参考下", "参考如下", "如下参考" etc.
 * Returns true if the line is a standalone context-intro comment rather than
 * content to be executed.
 */
function isContextMarkerLine(line) {
  const t = line.trim();
  // Pure Chinese meta-commentary that introduces a reference block:
  // "参考下这个", "参考一下", "参考下", "参考如下", "如下", "参考以下", etc.
  if (/^参考/.test(t) || /^如下参考/.test(t)) return true;
  // Generic instruction-style markers
  if (/^(以下|以上|下面|上面)(是|为)?(参考|示例|例子)/.test(t)) return true;
  return false;
}

/**
 * Split pasted text into sections separated by context-marker lines.
 * Returns { contextBlocks: string[], taskLines: string[] }
 * taskLines: lines that are NOT inside a reference block (i.e. the actual task)
 * contextBlocks: content that was introduced by a context-marker line
 */
function splitContextFromTask(lines) {
  const contextBlocks = [];
  const taskLines = [];
  let inContextBlock = false;
  let currentBlock = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isContextMarkerLine(line)) {
      // Save previous task lines before entering context block
      inContextBlock = true;
      currentBlock = [];
      continue;
    }
    if (inContextBlock) {
      // A blank separator or a new Chinese-only instruction line ends the context block
      // Heuristic: if a line has Chinese text AND looks like an instruction (not a command),
      // treat it as the task line rather than context content.
      const hasChineseChars = /[\u4e00-\u9fff]/.test(line);
      const looksLikeCmd = looksLikeObviousShellCommand(line.replace(/^\$\s*/, ''));
      if (hasChineseChars && !looksLikeCmd) {
        // This line is a task instruction, not reference content
        contextBlocks.push(...currentBlock);
        currentBlock = [];
        inContextBlock = false;
        taskLines.push(line);
      } else {
        currentBlock.push(line);
      }
    } else {
      taskLines.push(line);
    }
  }
  // Remaining block content goes to context
  if (currentBlock.length > 0) {
    contextBlocks.push(...currentBlock);
  }

  return { contextBlocks, taskLines };
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

  // --- Context/reference block detection ---
  // If the text contains context-marker lines ("参考下这个", "参考下", etc.),
  // separate the reference content from the actual task instruction and
  // classify based on the task portion only.
  const hasContextMarkers = lines.some(isContextMarkerLine);
  if (hasContextMarkers) {
    const { taskLines } = splitContextFromTask(lines);
    if (taskLines.length > 0) {
      const taskText = taskLines.join('\n');
      // Recursively classify just the task portion (no context markers remain)
      return classifyPastedText(taskText);
    }
    // If everything was reference content and there are no task lines,
    // fall through to normal classification of the full text.
  }
  // --- end context detection ---

  const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  const hasTaskWords = /(增加|修改|删除|替换|在.+中|帮我|请|写入|更新|执行以下|运行以下|粘贴到|配置|为准|打出|构建|部署|生成|创建|启动|重启|打包|编译|发布|以.+为准)/.test(text);
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
