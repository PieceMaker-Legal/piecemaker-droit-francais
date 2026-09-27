const path = require('node:path');
const { SHARE_ENV, Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const STATS_INTERVAL_MS = 1000;
const CLOSE_TIMEOUT_MS = 2000;

function runInsideWorker() {
  const { createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');
  const { startRewriterBridge } = require('./rewriter-bridge.cjs');
  const { createHarnessJuridique } = require('../harness/index.cjs');

  const dictionary = createSqliteDictionaryLoader({ databasePath: workerData.databasePath });
  const harness = createHarnessJuridique({ homeDir: workerData.homeDir, verifyResponses: false });

  startRewriterBridge({ dictionary, harness }).then((bridge) => {
    let published = '';
    const publishStats = () => {
      const snapshot = JSON.stringify(bridge.stats);
      if (snapshot === published) return;
      published = snapshot;
      parentPort.postMessage({ type: 'stats', stats: bridge.stats });
    };
    const timer = setInterval(publishStats, STATS_INTERVAL_MS);
    parentPort.on('message', (message) => {
      if (message?.type !== 'close') return;
      clearInterval(timer);
      publishStats();
      bridge.close().finally(() => {
        dictionary.close();
        parentPort.postMessage({ type: 'closed' });
      });
    });
    parentPort.postMessage({ type: 'listening', port: bridge.port });
  }, (error) => {
    dictionary.close();
    parentPort.postMessage({ type: 'error', message: error.message });
  });
}

function startRewriterWorker({ databasePath, homeDir }) {
  const worker = new Worker(path.join(__dirname, 'rewriter-worker.cjs'), {
    workerData: { databasePath, homeDir },
    env: SHARE_ENV,
  });
  const stats = { requests: 0, anonymized: 0, deanonymized: 0, failures: 0, lastError: null };

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      worker.terminate();
      reject(error);
    };
    worker.on('error', (error) => {
      stats.failures += 1;
      stats.lastError = error.message;
      fail(error);
    });
    worker.once('exit', (code) => reject(new Error(`réécrivain arrêté (${code})`)));
    worker.on('message', (message) => {
      if (message?.type === 'stats') Object.assign(stats, message.stats);
      if (message?.type === 'error') fail(new Error(message.message));
      if (message?.type !== 'listening') return;
      resolve({
        port: message.port,
        stats,
        close() {
          return new Promise((done) => {
            const timer = setTimeout(() => worker.terminate().then(() => done()), CLOSE_TIMEOUT_MS);
            worker.once('exit', () => {
              clearTimeout(timer);
              done();
            });
            worker.on('message', (reply) => {
              if (reply?.type === 'closed') worker.terminate();
            });
            worker.postMessage({ type: 'close' });
          });
        },
      });
    });
  });
}

if (!isMainThread && workerData?.databasePath) runInsideWorker();

module.exports = { startRewriterWorker };
