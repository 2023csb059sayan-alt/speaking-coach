import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker registration with install prompt handling
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration must never stop the app from working; it only means
      // the app will not be available offline.
    });
  });

  // Handle install prompt
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    // Dispatch custom event for React components
    window.dispatchEvent(new CustomEvent('install-available'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });

  // Expose install function globally
  (window as { promptInstall?: () => Promise<void> }).promptInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        // User accepted install - could track analytics here
      }
      deferredPrompt = null;
    }
  };
}

// Type for beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Accessibility: announce page changes to screen readers
const announcePageChange = (message: string) => {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  document.body.appendChild(announcement);
  setTimeout(() => announcement.remove(), 1000);
};

// Listen for route changes (simple implementation)
let currentPath = window.location.pathname;
const observer = new MutationObserver(() => {
  if (window.location.pathname !== currentPath) {
    currentPath = window.location.pathname;
    // Announce route change
    const pageName = currentPath === '/' ? 'Home' :
      currentPath.includes('conversation') ? 'Conversation practice' :
      currentPath.includes('interview') ? 'Interview preparation' :
      currentPath.includes('vocabulary') ? 'Vocabulary review' :
      currentPath.includes('transparency') ? 'Free tier transparency' : 'Page';
    announcePageChange(`${pageName} loaded`);
  }
});

observer.observe(document.body, { childList: true, subtree: true });