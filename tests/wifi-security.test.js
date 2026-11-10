'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'root/usr/libexec/unifi-network/unifi-status-details'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/view/status/include/45_unifi.js'), 'utf8');
const wifiFilter = backend.match(/wifi="\$\(printf '%s' "\$response" \| jq -c '([\s\S]*?)'\)"/)[1];
const securitySource = frontend.match(/function securityText\(wifi\) \{[\s\S]*?\n\}/)[0];
const securityText = vm.runInNewContext('(' + securitySource + ')', { _: text => text });

function projectWifi(config) {
	return JSON.parse(execFileSync('jq', ['-c', wifiFilter], {
		input: JSON.stringify({ data: [config] }), encoding: 'utf8'
	}))[0];
}

// UniFi keeps wpa_mode=wpa2 even for WPA3-only networks.
const cases = [
	['WPA2', { security: 'wpapsk', wpa_mode: 'wpa2', wpa3_support: false, wpa3_transition: false }, 'WPA2'],
	['WPA3 only', { security: 'wpapsk', wpa_mode: 'wpa2', wpa3_support: true, wpa3_transition: false }, 'WPA3'],
	['WPA2/WPA3 transition', { security: 'wpapsk', wpa_mode: 'wpa2', wpa3_support: true, wpa3_transition: true }, 'WPA2/WPA3'],
	['explicit WPA3 mode', { security: 'wpapsk', wpa_mode: 'wpa3' }, 'WPA3'],
	['legacy WPA2', { security: 'wpapsk', wpa_mode: 'wpa2' }, 'WPA2'],
	['open', { security: 'open' }, 'Open']
];

for (const [name, config, expected] of cases) {
	test(name, () => assert.equal(securityText(projectWifi(config)), expected));
}

test('status projection does not expose the Wi-Fi password', () => {
	const wifi = projectWifi({ security: 'wpapsk', wpa_mode: 'wpa2',
		wpa3_support: true, x_passphrase: 'test-secret' });
	assert.equal(wifi.wpa3Support, true);
	assert.equal(wifi.hasPassword, true);
	assert.equal(JSON.stringify(wifi).includes('test-secret'), false);
	assert.equal(Object.hasOwn(wifi, 'x_passphrase'), false);
});
