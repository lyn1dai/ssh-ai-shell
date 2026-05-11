import React from 'react';
import { Clipboard, Folder, User, Settings, Server, BookMarked } from 'lucide-react';

export type SidebarPanel = 'clipboard' | 'files' | 'userinfo' | 'settings' | 'hosts' | 'commands' | 'chat' | null;

interface Props {
  activePanel: SidebarPanel;
  onPanelToggle: (panel: SidebarPanel) => void;
  isPrimary?: boolean;  // false → split pane; hide settings/userinfo/hosts
}

const ALL_TOOLS: { icon: React.ElementType; label: string; panel: SidebarPanel }[] = [
  { icon: Clipboard,      label: '历史记录', panel: 'clipboard' },
  { icon: BookMarked,     label: '常用命令', panel: 'commands' },
  { icon: Folder,         label: '文件管理', panel: 'files' },
  { icon: Server,         label: '主机管理', panel: 'hosts' },
  { icon: User,           label: '服务器设置', panel: 'userinfo' },
  { icon: Settings,       label: '设置',     panel: 'settings' },
];

const SPLIT_TOOLS: { icon: React.ElementType; label: string; panel: SidebarPanel }[] = [
  { icon: Clipboard,      label: '历史记录', panel: 'clipboard' },
  { icon: BookMarked,     label: '常用命令', panel: 'commands' },
  { icon: Folder,         label: '文件管理', panel: 'files' },
];

export default function Sidebar({ activePanel, onPanelToggle, isPrimary = true }: Props) {
  const TOOLS = isPrimary ? ALL_TOOLS : SPLIT_TOOLS;
  return (
    <div className="sidebar-rail w-11 flex-shrink-0 border-r border-terminal-border flex flex-col items-center py-2 gap-1.5 relative z-50">
      {TOOLS.map(({ icon: Icon, label, panel }) => (
        <button
          key={label}
          title={label}
          onClick={() => onPanelToggle(activePanel === panel ? null : panel)}
          className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all
            ${activePanel === panel
              ? 'border-terminal-blue/35 bg-terminal-blue/14 text-terminal-blue shadow-[0_12px_24px_rgba(69,145,255,0.18)]'
              : 'border-transparent text-terminal-muted hover:text-terminal-text hover:bg-terminal-surface/76 hover:border-terminal-border/70'
            }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
