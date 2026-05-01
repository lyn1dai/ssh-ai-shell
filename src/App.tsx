import React, { useState, useEffect } from 'react';
import ConnectForm from './components/ConnectForm';
import TerminalPage from './components/TerminalPage';
import type { ConnectConfig, Theme } from './types';

type Page = 'connect' | 'terminal';

export default function App() {
  const [page, setPage] = useState<Page>('connect');
  const [config, setConfig] = useState<ConnectConfig | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('app-theme') as Theme) || 'dark';
  });

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  function handleConnect(cfg: ConnectConfig) {
    setConfig(cfg);
    setPage('terminal');
  }

  function handleDisconnect() {
    setConfig(null);
    setPage('connect');
  }

  if (page === 'terminal' && config) {
    return (
      <TerminalPage
        config={config}
        onDisconnect={handleDisconnect}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  return (
    <ConnectForm
      onConnect={handleConnect}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}
