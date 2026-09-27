const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const commandsPath = path.join(__dirname, '..', 'src', 'commands');

test('todos os módulos carregam', () => {
  require('../src/db');
  require('../src/ranks');
  require('../src/permissions');
  require('../src/health');
});

for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  test(`comando ${file} é válido`, () => {
    const command = require(path.join(commandsPath, file));
    assert.ok(command.data, 'falta export data');
    assert.strictEqual(typeof command.execute, 'function', 'falta export execute');
    command.data.toJSON();
  });
}

test('queda de conexão com o banco não derruba o bot', () => {
  const db = require('../src/db');
  assert.doesNotThrow(() => db.pool.emit('error', new Error('Connection terminated unexpectedly')));
});

test('keep-alive consulta o banco no intervalo configurado', (t) => {
  const db = require('../src/db');
  let tick;
  let intervalMs;
  t.mock.method(global, 'setInterval', (fn, ms) => {
    tick = fn;
    intervalMs = ms;
    return { unref: () => {} };
  });
  const query = t.mock.method(db.pool, 'query', async () => ({ rows: [] }));
  db.startKeepAlive(4);
  assert.strictEqual(intervalMs, 4 * 60 * 1000);
  tick();
  assert.strictEqual(query.mock.calls[0].arguments[0], 'SELECT 1');
});
