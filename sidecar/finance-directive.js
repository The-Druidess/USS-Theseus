'use strict';

const { writeFileDurable } = require('./durable-write.js');

function makeFinanceDirectiveStore({ fs, path, workspace, now }) {
  const file = path.join(workspace, 'finance-directive.json');
  const marker = path.join(workspace, 'finance-directive.required');
  function validate(value) {
    if (!value || value.version !== 1 || value.title !== 'F-00 Financial Authority Directive'
        || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000
        || !Number.isSafeInteger(value.activatedAt) || value.activatedAt <= 0) {
      throw new Error('Invalid active finance directive; repair the directive store before running agents.');
    }
    return { version: 1, title: value.title, text: value.text, activatedAt: value.activatedAt };
  }
  function read() {
    let raw, required;
    try { required = fs.readFileSync(marker, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (required === undefined && raw === undefined) return null;
    if (required !== 'F-00\n' || raw === undefined) throw new Error('Active finance directive storage is incomplete.');
    return validate(JSON.parse(raw));
  }
  function activate(title, text) {
    const active = validate({ version: 1, title, text, activatedAt: now() });
    writeFileDurable({ fs, path }, marker, 'F-00\n');
    writeFileDurable({ fs, path }, file, JSON.stringify(active));
    const verified = read();
    if (JSON.stringify(verified) !== JSON.stringify(active)) throw new Error('Finance directive read-back did not match.');
    return verified;
  }
  return { read, activate };
}

function financeDirectiveContext(active) {
  if (!active) return '';
  return '\n\nACTIVE FINANCE DIRECTIVE — Q REFERENCE:\n'
    + 'Follow this directive alongside applicable safety and authorization controls. '
    + 'This text does not grant tool access or override the enforced finance guard.\n'
    + active.title + '\n' + active.text;
}

module.exports = { makeFinanceDirectiveStore, financeDirectiveContext };
