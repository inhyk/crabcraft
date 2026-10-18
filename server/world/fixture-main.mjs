import { startFixture } from './fixture.ts';
const fixture = await startFixture();
function send(message, callback = () => {}) {
  if (process.connected) process.send(message, error => callback(error)); else callback();
}
send({ type: 'ready', url: fixture.url });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await fixture.close();
  send({ type: 'final', stats: fixture.stats() }, () => { if (process.connected) process.disconnect(); });
}
process.on('message', message => {
  if (message?.type === 'stats') send({ type: 'stats', stats: fixture.stats() });
  if (message?.type === 'stop') void stop();
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('disconnect', () => void stop());
