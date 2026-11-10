'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'root/usr/libexec/unifi-network/unifi-status-details'), 'utf8');

test('projects large client lists without passing them through argv', t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unifi-status-details-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	const clients = Array.from({ length: 1000 }, (_, i) => ({
		mac: `02:00:${(i >> 24) & 255}:${(i >> 16) & 255}:${(i >> 8) & 255}:${i & 255}`,
		is_wired: false,
		radio_proto: 'ax',
		signal: -55,
		tx_rate: 1201000,
		rx_rate: 1201000
	}));
	fs.writeFileSync(path.join(dir, 'clients.json'), JSON.stringify({ data: clients }));
	fs.writeFileSync(path.join(dir, 'common.sh'), [
		'unifi_uuid() { return 0; }',
		'unifi_config() { return 0; }',
		'unifi_legacy_site() { printf default; }',
		'unifi_legacy_request() {',
		`\tcase "$1" in */stat/sta) cat '${path.join(dir, 'clients.json')}' ;; *) printf '{"data":[]}' ;; esac`,
		'}'
	].join('\n'));
	const script = source.replace('/usr/libexec/unifi-network/unifi-common.sh', path.join(dir, 'common.sh'));
	const scriptPath = path.join(dir, 'unifi-status-details');
	fs.writeFileSync(scriptPath, script);

	const result = JSON.parse(execFileSync('sh', [scriptPath, '00000000-0000-0000-0000-000000000000'], { encoding: 'utf8' }));
	assert.equal(result.clients.length, 1000);
	assert.equal(result.clients[0].mac, '02:00:0:0:0:0');
	assert.equal(result.devices.length, 0);
	assert.equal(result.wifi.length, 0);
});
