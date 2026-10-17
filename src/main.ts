// Capture mode first (dev server with ?capture only): it must own the clock before anything reads it.
import './capture/clock';
import './ui/kit.css';
import { App } from './app';
import { showLaunchNotice } from './ui/launchNotice';

const root = document.getElementById('app')!;
async function startApp(): Promise<void> {
  await showLaunchNotice(root);
  const app = new App(root);
  await app.account.init();
  // Debug handle for the console and the screenshot tool.
  (window as unknown as { app: App }).app = app;
  const params = new URLSearchParams(location.search);
  const start = (params.get('screen') as Parameters<App['go']>[0]) || 'title';
  await app.go(start);
}
void startApp();
