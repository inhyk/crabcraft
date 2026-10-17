// Capture mode first (dev server with ?capture only): it must own the clock before anything reads it.
import './capture/clock';
import './ui/kit.css';
import { App } from './app';
import { showLaunchNotice } from './ui/launchNotice';

const root = document.getElementById('app')!;
async function startApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const start = params.get('screen') || 'title';
  // The capture tools (tools/trailer, tools/crowd) drive the dev server headless: no launch notice.
  const capture = import.meta.env.DEV && params.has('capture');
  if (capture && start === 'crowd') {
    // The crowd capture scene (tools/crowd): dev server only, a production build drops it.
    const app = new App(root);
    (window as unknown as { app: App }).app = app;
    const crowd = await import('./capture/crowd/index');
    await crowd.startCrowdScene(app);
    return;
  }
  if (!capture) await showLaunchNotice(root);
  const app = new App(root);
  await app.account.init();
  // Debug handle for the console and the screenshot tool.
  (window as unknown as { app: App }).app = app;
  await app.go((params.get('screen') || app.account.resume || 'title') as Parameters<App['go']>[0]);
  // The game screen greets once its world has loaded.
  if (app.currentId !== 'game') app.account.greet();
}
void startApp();
