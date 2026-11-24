'use strict';

function makeSlackHalt({ fs, path, workspace, writeDurable, initiallyHalted, onError }) {
  const file = path.join(workspace, 'slack.halt.json');
  let halted = initiallyHalted === true;

  function read() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || typeof value.halted !== 'boolean')
      throw new Error('invalid Slack halt state');
    return value.halted;
  }
  try { halted = read() === true || halted; }
  catch (error) { halted = true; onError(error); }

  function save(value) {
    writeDurable({ fs, path }, file, JSON.stringify({ version: 1, halted: value }));
    if (read() !== value) throw new Error('Slack halt read-back failed');
  }
  return {
    halted: () => halted,
    halt() { halted = true; save(true); },
    resume() { if (halted) { save(false); halted = false; } }
  };
}

module.exports = { makeSlackHalt };
