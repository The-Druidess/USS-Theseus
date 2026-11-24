'use strict';

function makeSlackAuthorization({ fs, path, workspace, writeDurable }) {
  const file = path.join(workspace, 'slack-finance-authorization.json');
  function authorized() {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return false;
      throw new Error('Slack authorization storage is unavailable or invalid: ' + error.message);
    }
    if (!value || value.version !== 1 || typeof value.authorized !== 'boolean'
        || Object.keys(value).some(key => !['version', 'authorized'].includes(key)))
      throw new Error('Slack authorization storage is invalid');
    return value.authorized;
  }
  function set(value) {
    if (typeof value !== 'boolean') throw new Error('Slack authorization must be a boolean');
    writeDurable({ fs, path }, file, JSON.stringify({ version: 1, authorized: value }));
    if (authorized() !== value) throw new Error('Slack authorization read-back failed');
  }
  return { authorized, set };
}
module.exports = { makeSlackAuthorization };
