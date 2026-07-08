import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Bootstrap } from './api';
import Dashboard from './components/Dashboard';
import Transactions from './components/Transactions';
import Accounts from './components/Accounts';
import Budgets from './components/Budgets';
import Bills from './components/Bills';
import QuickAdd from './components/QuickAdd';

export type Screen = 'dash' | 'tx' | 'accts' | 'bud' | 'bills';

export interface ScreenProps {
  boot: Bootstrap;
  rev: number;
  refresh: () => void;
  showToast: (msg: string) => void;
  openAdd: () => void;
  onNav: (s: Screen) => void;
}

const NAV: { id: Screen; ico: string; label: string }[] = [
  { id: 'dash', ico: '◧', label: 'Dashboard' },
  { id: 'tx', ico: '⇅', label: 'Transactions' },
  { id: 'accts', ico: '▤', label: 'Accounts' },
  { id: 'bud', ico: '◔', label: 'Budgets' },
  { id: 'bills', ico: '⏱', label: 'Bills & Subs' },
];

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [screen, setScreen] = useState<Screen>('dash');
  const [rev, setRev] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);

  const refresh = useCallback(() => {
    api.bootstrap().then(setBoot).catch(() => setToast('Could not reach the Pondo server'));
    setRev(r => r + 1);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if ((e.key === 'n' || e.key === 'N') && !addOpen && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [addOpen]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const cur = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  };

  if (!boot) return <div className="loading">Loading Pondo…</div>;

  const common: ScreenProps = {
    boot, rev, refresh, showToast,
    openAdd: () => setAddOpen(true),
    onNav: setScreen,
  };

  const navBtns = NAV.map(n => (
    <button key={n.id} className={`nav-btn ${screen === n.id ? 'on' : ''}`} onClick={() => setScreen(n.id)}>
      <span className="ico">{n.ico}</span> {n.label}
    </button>
  ));

  return (
    <div className="app">
      <nav className="side">
        <div className="brand">
          <div className="brand-mark">₱</div>
          <div><span className="brand-name">Pondo</span><span className="brand-sub">personal finance</span></div>
        </div>
        {navBtns}
        <div className="side-foot">
          Quick add: <span className="kbd">N</span> · Save: <span className="kbd">↵</span><br />
          <button className="theme-btn foot-theme" onClick={toggleTheme}>◐ Toggle theme</button>
        </div>
      </nav>

      <main className="main">
        <div className="mobile-nav">{navBtns}</div>

        {boot.accounts.length === 0 && screen !== 'accts' && (
          <div className="card empty-banner">
            <span><b>Welcome to Pondo.</b> Start by adding your accounts — cash, banks, e-wallets, cards.</span>
            <button className="add-btn" onClick={() => setScreen('accts')}>Set up accounts →</button>
          </div>
        )}

        {screen === 'dash' && <Dashboard {...common} />}
        {screen === 'tx' && <Transactions {...common} />}
        {screen === 'accts' && <Accounts {...common} />}
        {screen === 'bud' && <Budgets {...common} />}
        {screen === 'bills' && <Bills {...common} />}
      </main>

      {addOpen && (
        <QuickAdd
          accounts={boot.accounts}
          categories={boot.categories}
          onClose={() => setAddOpen(false)}
          onSaved={(msg) => { setAddOpen(false); showToast(msg); refresh(); }}
        />
      )}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
