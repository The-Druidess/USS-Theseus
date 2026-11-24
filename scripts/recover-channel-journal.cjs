'use strict';

const recovery = require('../sidecar/channels/journal-recovery.js');

function main(argv) {
  const command = argv.shift(), args = {};
  while (argv.length) {
    const key = argv.shift();
    if (!/^--[a-z-]+$/.test(key) || !argv.length || Object.prototype.hasOwnProperty.call(args, key))
      throw new Error('expected distinct --name value arguments');
    args[key] = argv.shift();
  }
  const common = ['--workspace', '--kind'];
  const allowed = command === 'inspect' || command === 'apply'
    ? common.concat(['--candidate'], command === 'apply' ? ['--revision', '--confirm'] : [])
    : command === 'holds' || command === 'resolve'
      ? common.concat(command === 'resolve' ? ['--id', '--action', '--revision', '--confirm'] : [])
      : null;
  if (!allowed || Object.keys(args).some(key => !allowed.includes(key)) || allowed.some(key => !args[key]))
    throw new Error('usage: inspect|apply --workspace ABS --kind inbox|outbox --candidate ABS [--revision HASH --confirm ' + recovery.CONFIRM_REPLACEMENT
      + ']; holds|resolve --workspace ABS --kind inbox|outbox [--id ID --action resume|discard --revision HASH --confirm ' + recovery.CONFIRM_ITEM + ']');
  const result = command === 'inspect' || command === 'apply'
    ? recovery.replacement(args['--workspace'], args['--kind'], args['--candidate'], args['--revision'], args['--confirm'])
    : recovery.held(args['--workspace'], args['--kind'], args['--id'], args['--action'], args['--revision'], args['--confirm']);
  console.log(JSON.stringify(result, null, 2));
}

try { main(process.argv.slice(2)); }
catch (error) { console.error('channel journal recovery failed: ' + ((error && error.message) || error)); process.exitCode = 1; }
