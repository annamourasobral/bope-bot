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
