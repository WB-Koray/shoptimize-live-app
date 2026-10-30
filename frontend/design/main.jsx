// Tasarim tezgahi girisi. Gercek Dashboard bilesenini sahte veriyle render eder.
// Backend, Docker, oturum ya da canli trafik gerekmez.
//
// Kullanim:  npm run tasarim   ->  http://localhost:5174/design.html
// Alan secimi URL ile:          ?alan=performans   (simdi | performans | kurtarma | plan)
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../src/index.css';
import Dashboard from '../src/Dashboard';
import { ThemeProvider } from '../src/ThemeContext';
import { LangProvider } from '../src/LangContext';
import ErrorBoundary from '../src/ErrorBoundary';
import { mockKur, SAHTE_OTURUM } from './mock';

mockKur();

// Dil ve tema URL'den secilebilsin: ekran goruntulerini ikisinde de almak
// icin tezgahi yeniden yazmaya gerek kalmasin.
const p = new URLSearchParams(location.search);
localStorage.setItem('spt_lang', p.get('dil') || 'tr');
localStorage.setItem('spt_mode', p.get('tema') || 'light');
// Kurulum modali tezgahta hic cikmasin: ekrani kapatiyor ve yerlesim
// olcumunu imkansiz hale getiriyor. ?onboarding=1 ile gorulebilir.
if (p.get('onboarding') !== '1') localStorage.setItem('spt_onboarding_done', '1');

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <LangProvider>
      <ThemeProvider>
        <Dashboard session={SAHTE_OTURUM} onLogout={() => {}} />
      </ThemeProvider>
    </LangProvider>
  </ErrorBoundary>
);
