'use strict';
'require baseclass';
'require dom';
'require unifi.api as unifiApi';
'require ui';

var revealedPasswords = Object.create(null);
var visibleQrCodes = Object.create(null);

function api(command, args) {
	return unifiApi.json('/usr/libexec/unifi-network/unifi-status', [command].concat(args || []))
		.then(function(response) {
			if (!Array.isArray(response.data))
				throw new Error(_('Unexpected response from UniFi Network'));
			return response;
		});
}

function pages(command, siteId) {
	var all = [];
	var pageCount = 0;
	function next(offset) {
		if (++pageCount > 25)
			return Promise.reject(new Error(_('UniFi API returned too many records')));
		return api(command, [siteId, String(offset)]).then(function(response) {
			all = all.concat(response.data);
			if (all.length > 5000 || response.totalCount > 5000)
				throw new Error(_('UniFi API returned too many records'));
			if (response.data.length && all.length < response.totalCount)
				return next(offset + response.data.length);
			return all;
		});
	}
	return next(0);
}

function selectedSite() {
	return unifiApi.exec('/usr/libexec/unifi-network/unifi-status', ['site'], true).then(function(siteId) {
		siteId = siteId.trim();
		if (siteId)
			return siteId;
		return api('sites').then(function(response) {
			return response.data.length ? response.data[0].id : null;
		});
	});
}

function stateText(state) {
	switch (state) {
	case 'ONLINE': return _('Online');
	case 'OFFLINE': return _('Offline');
	case 'UPDATING': return _('Updating');
	default: return state || '—';
	}
}

function durationText(value) {
	if (!value)
		return '—';
	var seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
	return isFinite(seconds) ? '%t'.format(seconds) : '—';
}

function uptimeText(seconds) {
	return seconds != null && isFinite(Number(seconds)) ? '%t'.format(Number(seconds)) : '—';
}

function percentText(value) {
	return value != null && isFinite(Number(value)) ? Number(value).toFixed(1).replace(/\.0$/, '') + '%' : '—';
}

function rateText(value, divisor) {
	return value != null && isFinite(Number(value)) ? (Number(value) / divisor).toFixed(1).replace(/\.0$/, '') + ' Mbps' : '—';
}

function standardText(protocol) {
	switch (protocol) {
	case 'ng': case 'na': return 'Wi-Fi 4';
	case 'ac': return 'Wi-Fi 5';
	case 'ax': return 'Wi-Fi 6';
	case 'be': return 'Wi-Fi 7';
	default: return protocol || '—';
	}
}

function metric(label, value) {
	return E('div', { 'class': 'unifi-metric' }, [
		E('span', {}, label), E('strong', {}, [value])
	]);
}

function deviceCard(device, stats, count, siteId, kind) {
	var restart = E('button', {
		'class': 'btn cbi-button cbi-button-negative',
		'click': function() {
			if (!window.confirm(_('Restart device %s? Connected clients will be disconnected.').format(device.name || device.model)))
				return;
			restart.disabled = true;
			unifiApi.json('/usr/libexec/unifi-network/unifi-restart', [siteId, device.id])
				.then(function() {
					ui.addNotification(null, E('p', {}, [_('Restart requested for %s').format(device.name || device.model)]));
				})
				.catch(function(error) {
					ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
				})
				.finally(function() { restart.disabled = false; });
		}
	}, _('Restart'));
	var actions = [restart];
	if (device.firmwareUpdatable && device.state === 'ONLINE') {
		var upgrade = E('button', {
			'class': 'btn cbi-button cbi-button-positive',
			'click': function() {
				if (!window.confirm(_('Update firmware on %s? The device and its clients will be disconnected during the upgrade.').format(device.name || device.model)))
					return;
				upgrade.disabled = true;
				unifiApi.json('/usr/libexec/unifi-network/unifi-device-update', ['upgrade', siteId, device.id])
					.then(function() {
						ui.addNotification(null, E('p', {}, [_('Firmware update requested for %s').format(device.name || device.model)]));
					})
					.catch(function(error) {
						ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
					})
					.finally(function() { upgrade.disabled = false; });
			}
		}, _('Update firmware'));
		actions.unshift(upgrade);
	}

	var load = stats && Array.isArray(stats.loadAverage) ? stats.loadAverage.map(function(value) { return value || '—'; }).join(' / ') : '—';
	var firmware = E('span', {}, [
		device.firmwareVersion || '—',
		E('small', { 'class': 'unifi-firmware-availability' },
			device.firmwareUpdatable ? _('Update available') : _('No update available'))
	]);
	return E('article', { 'class': 'unifi-device-card' }, [
		E('div', { 'class': 'unifi-ap-heading' }, [
			E('div', { 'class': 'unifi-ap-identity' }, [
				E('strong', {}, [device.name || device.model || device.macAddress || '—']),
				E('small', {}, [kind + ' · ' + (device.model || '—')])
			]),
			E('span', { 'class': 'unifi-state ' + (device.state === 'ONLINE' ? 'online' : 'offline') }, [stateText(device.state)])
		]),
		E('div', { 'class': 'unifi-device-details' }, [
			metric(_('IP address'), device.ipAddress || '—'),
			metric(_('Firmware'), firmware),
			metric(_('CPU usage'), percentText(stats && stats.cpuUtilizationPct)),
			metric(_('Memory usage'), percentText(stats && stats.memoryUtilizationPct)),
			metric(_('Load average (1/5/15 min)'), load),
			metric(_('Uptime'), uptimeText(stats && stats.uptimeSec))
		]),
		E('div', { 'class': 'unifi-ap-actions' }, [
			E('div', { 'class': 'unifi-client-count' }, [E('strong', {}, String(count)), E('span', {}, _('Connected clients'))]),
			E('div', { 'class': 'unifi-device-buttons' }, actions)
		])
	]);
}

function clientTable(clients, devices, stats, wired, siteId) {
	if (!clients.length)
		return E('p', { 'class': 'unifi-empty' }, wired ? _('No connected wired clients found') : _('No connected Wi-Fi clients found'));

	clients.sort(function(left, right) {
		return (left.name || left.macAddress || '').localeCompare(right.name || right.macAddress || '');
	});
	var headings = wired ? [_('Client'), _('MAC address'), _('Device / port'), _('Link speed'), _('Online time')] :
		[_('Client'), _('MAC address'), _('Access point'), _('Wi-Fi standard'), _('Signal'), _('Negotiated rate'), _('Online time'), _('Action')];

	var rows = clients.map(function(client) {
		var info = stats[(client.macAddress || '').toLowerCase()] || {};
		var uplink = devices[client.uplinkDeviceId] || devices[(info.switchMac || '').toLowerCase()];
		var location = uplink ? (uplink.name || uplink.model || uplink.macAddress) : '—';
		if (wired && info.switchPort != null)
			location += ' · ' + _('Port %s').format(info.switchPort);
		var cells = [
			E('td', { 'class': 'td unifi-client-name' }, [client.name || '—']),
			E('td', { 'class': 'td unifi-mac' }, [client.macAddress || '—']),
			E('td', { 'class': 'td' }, [location])
		];
		if (wired) {
			cells.push(E('td', { 'class': 'td' }, rateText(info.wiredRateMbps, 1)));
		}
		else {
				cells.push(E('td', { 'class': 'td' }, [standardText(info.radioProtocol)]));
				cells.push(E('td', { 'class': 'td' }, [info.signalDbm != null ? info.signalDbm + ' dBm' : '—']));
			cells.push(E('td', { 'class': 'td unifi-rates' }, [
				E('span', {}, '↑ ' + rateText(info.txRateKbps, 1000)),
				E('span', {}, '↓ ' + rateText(info.rxRateKbps, 1000))
			]));
		}
		cells.push(E('td', { 'class': 'td' }, durationText(client.connectedAt)));
		if (!wired) {
			var reconnect = E('button', {
				'class': 'btn',
				'click': function() {
					if (!window.confirm(_('Reconnect Wi-Fi client %s? The client will briefly disconnect.').format(client.name || client.macAddress)))
						return;
					reconnect.disabled = true;
						unifiApi.json('/usr/libexec/unifi-network/unifi-reconnect', [siteId, client.macAddress])
						.then(function() {
							ui.addNotification(null, E('p', {}, [_('Reconnect requested for %s').format(client.name || client.macAddress)]));
						})
						.catch(function(error) {
							ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
						})
						.finally(function() { reconnect.disabled = false; });
				}
			}, _('Reconnect'));
			cells.push(E('td', { 'class': 'td cbi-section-actions' }, reconnect));
		}
		return E('tr', { 'class': 'tr' }, cells.map(function(cell, index) {
			cell.setAttribute('data-title', headings[index]);
			return cell;
		}));
	});

	return E('table', { 'class': 'table unifi-client-table' }, [
		E('tr', { 'class': 'tr table-titles' }, headings.map(function(heading) { return E('th', { 'class': 'th' }, heading); }))
	].concat(rows));
}

function sectionPanel(siteId, id, title, count, content, defaultOpen) {
	var storageKey = 'unifi-section-' + siteId + '-' + id;
	var saved = localStorage.getItem(storageKey);
	var panel = E('details', { 'class': 'unifi-section' }, [
		E('summary', { 'class': 'unifi-section-heading' }, [
			E('span', { 'class': 'unifi-section-title' }, title),
			E('span', { 'class': 'unifi-total' }, String(count))
		]),
		E('div', { 'class': 'unifi-section-content' }, content)
	]);
	panel.open = saved == null ? defaultOpen : saved === 'open';
	panel.addEventListener('toggle', function() {
		localStorage.setItem(storageKey, panel.open ? 'open' : 'closed');
	});
	return panel;
}

function securityText(wifi) {
	if (wifi.security === 'open') return _('Open');
	if (wifi.wpa3Transition) return 'WPA2/WPA3';
	if (wifi.wpa3Support || wifi.wpaMode === 'wpa3') return 'WPA3';
	if (wifi.wpaMode === 'wpa2') return 'WPA2';
	return wifi.wpaMode || wifi.security || '—';
}

function bandText(bands) {
	return (bands || []).map(function(band) {
		return { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }[band] || band;
	}).join(' / ') || '—';
}

function wifiCard(wifi, siteId) {
	var key = siteId + '/' + wifi.id;
	var isRevealed = Object.prototype.hasOwnProperty.call(revealedPasswords, key);
	if (!wifi.hasPassword) {
		delete revealedPasswords[key];
		isRevealed = false;
	}
	var password = E('code', { 'class': 'unifi-password' }, [isRevealed ? revealedPasswords[key] : '••••••••']);
	var reveal = E('button', { 'class': 'btn', 'data-revealed': isRevealed ? 'true' : 'false', 'click': function() {
		if (reveal.getAttribute('data-revealed') === 'true') {
			delete revealedPasswords[key];
			password.textContent = '••••••••';
			reveal.textContent = _('Show password');
			reveal.setAttribute('data-revealed', 'false');
			return;
		}
		reveal.disabled = true;
		unifiApi.json('/usr/libexec/unifi-network/unifi-wifi-secret', ['password', siteId, wifi.id]).then(function(response) {
			revealedPasswords[key] = response.password || '';
			password.textContent = revealedPasswords[key] || '—';
			reveal.textContent = _('Hide password');
			reveal.setAttribute('data-revealed', 'true');
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
		}).finally(function() { reveal.disabled = false; });
	}}, isRevealed ? _('Hide password') : _('Show password'));
	var qrImage = E('img', visibleQrCodes[key] ?
		{ 'alt': _('Wi-Fi QR code'), 'src': visibleQrCodes[key] } :
		{ 'alt': _('Wi-Fi QR code') });
	var qrPanel = E('div', { 'class': 'unifi-qr-panel', 'style': visibleQrCodes[key] ? '' : 'display:none' }, qrImage);
	var qrButton = E('button', { 'class': 'btn', 'click': function() {
		if (qrPanel.style.display !== 'none') {
			delete visibleQrCodes[key];
			qrPanel.style.display = 'none';
			qrImage.removeAttribute('src');
			qrButton.textContent = _('Show QR code');
			return;
		}
		qrButton.disabled = true;
		unifiApi.exec('/usr/libexec/unifi-network/unifi-wifi-secret', ['qr', siteId, wifi.id]).then(function(output) {
			visibleQrCodes[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(output);
			qrImage.src = visibleQrCodes[key];
			qrPanel.style.display = '';
			qrButton.textContent = _('Hide QR code');
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
		}).finally(function() { qrButton.disabled = false; });
	}}, visibleQrCodes[key] ? _('Hide QR code') : _('Show QR code'));
	return E('article', { 'class': 'unifi-wifi-card' }, [
		E('div', { 'class': 'unifi-wifi-heading' }, [
			E('strong', {}, [wifi.name || '—']),
			E('span', { 'class': 'unifi-state ' + (wifi.enabled ? 'online' : 'offline') }, wifi.enabled ? _('Enabled') : _('Disabled'))
		]),
		E('div', { 'class': 'unifi-wifi-meta' }, [
			metric(_('Frequency bands'), bandText(wifi.bands)),
			metric(_('Encryption'), securityText(wifi)),
			metric(_('SSID visibility'), wifi.hidden ? _('Hidden') : _('Broadcast'))
		]),
		E('div', { 'class': 'unifi-wifi-actions' }, [
			wifi.hasPassword ? password : E('span', {}, _('No password')),
			wifi.hasPassword ? reveal : null, qrButton
		].filter(function(item) { return item != null; })),
		qrPanel
	]);
}

return baseclass.extend({
	title: _('UniFi Network'),

	load: function() {
		var pending = this._unifiPending;
		if (!pending) {
			pending = selectedSite().then(function(siteId) {
				if (!siteId)
					return { empty: true };
				return Promise.all([pages('devices', siteId), pages('clients', siteId),
					unifiApi.json('/usr/libexec/unifi-network/unifi-status-details', [siteId]).catch(function(error) {
						return { devices: [], clients: [], wifi: [], error: error.message || String(error) };
					})])
					.then(function(results) {
						return { siteId: siteId, devices: results[0], clients: results[1], details: results[2] };
					});
			}).catch(function(error) {
				return { error: error.message || String(error) };
			});
			this._unifiPending = pending;
			pending.then(function() {
				if (this._unifiPending === pending)
					this._unifiPending = null;
			}.bind(this));
		}
		this._unifiGeneration = (this._unifiGeneration || 0) + 1;
		return Promise.resolve({ pending: pending, generation: this._unifiGeneration });
	},

	render: function(result) {
		if (!document.getElementById('unifi-dashboard-style'))
			document.head.appendChild(E('link', {
				'id': 'unifi-dashboard-style',
				'rel': 'stylesheet',
				'href': L.resource('unifi/dashboard.css')
			}));
		if (result.pending) {
			var container = this._unifiContainer || E('div', {}, [E('p', {}, [_('Collecting data...')])]);
			this._unifiContainer = container;
			result.pending.then(function(data) {
				if (result.generation === this._unifiGeneration)
					dom.content(container, this.render(data));
			}.bind(this));
			return container;
		}

		var settings = E('a', { 'href': L.url('admin/services/unifi'), 'class': 'unifi-settings' }, _('Settings'));
		var checkUpdates = E('button', { 'class': 'btn', 'click': function() {
			checkUpdates.disabled = true;
			unifiApi.json('/usr/libexec/unifi-network/unifi-device-update', ['check', result.siteId])
				.then(function() {
					ui.addNotification(null, E('p', {}, [_('Firmware update check requested; availability will refresh shortly.')]));
				})
				.catch(function(error) {
					ui.addNotification(null, E('p', {}, [_('UniFi API request failed: ') + (error.message || error)]));
				})
				.finally(function() { checkUpdates.disabled = false; });
		}
		}, _('Check for updates'));
		if (result.error)
			return E('div', { 'class': 'unifi-dashboard' }, [settings, E('p', {}, [_('UniFi API request failed: ') + result.error])]);
		if (result.empty)
			return E('div', { 'class': 'unifi-dashboard' }, [settings, E('p', {}, _('No UniFi sites found'))]);

			var devices = result.devices;
			var accessPoints = devices.filter(function(device) { return (device.features || []).indexOf('accessPoint') >= 0; });
			var switches = devices.filter(function(device) { return (device.features || []).indexOf('accessPoint') < 0 && (device.features || []).indexOf('switching') >= 0; });
			var otherDevices = devices.filter(function(device) { return accessPoints.indexOf(device) < 0 && switches.indexOf(device) < 0; });
			var wireless = result.clients.filter(function(client) { return client.type === 'WIRELESS'; });
			var wired = result.clients.filter(function(client) { return client.type === 'WIRED'; });
			var details = result.details;
			var wifi = details.wifi || [];
				var deviceStats = Object.create(null);
				var clientStats = Object.create(null);
				var deviceNames = Object.create(null);
				var counts = Object.create(null);
			(details.devices || []).forEach(function(device) { deviceStats[device.mac] = device; });
			(details.clients || []).forEach(function(client) { clientStats[client.mac] = client; });
			devices.forEach(function(device) {
				deviceNames[device.id] = device;
				deviceNames[(device.macAddress || '').toLowerCase()] = device;
				counts[device.id] = 0;
			});
			result.clients.forEach(function(client) {
				if (Object.prototype.hasOwnProperty.call(counts, client.uplinkDeviceId))
					counts[client.uplinkDeviceId]++;
			});

			var sections = [
				E('div', { 'class': 'unifi-toolbar' }, [checkUpdates, settings]),
				details.error ? E('p', { 'class': 'alert-message warning' }, [_('Supplementary status data unavailable: ') + details.error]) : null,
				sectionPanel(result.siteId, 'wifi', _('Wi-Fi networks'), wifi.length,
					wifi.length ? E('div', { 'class': 'unifi-wifi-grid' }, wifi.map(function(network) {
						return wifiCard(network, result.siteId);
					})) : E('p', { 'class': 'unifi-empty' }, _('No Wi-Fi networks found')), true),
				sectionPanel(result.siteId, 'aps', _('Access points'), accessPoints.length,
					accessPoints.length ? E('div', { 'class': 'unifi-device-grid' }, accessPoints.map(function(device) {
						return deviceCard(device, deviceStats[(device.macAddress || '').toLowerCase()], counts[device.id], result.siteId, _('Access point'));
					})) : E('p', { 'class': 'unifi-empty' }, _('No adopted access points found')), accessPoints.length <= 4),
				sectionPanel(result.siteId, 'wireless-clients', _('Wi-Fi clients'), wireless.length,
					clientTable(wireless, deviceNames, clientStats, false, result.siteId), wireless.length <= 12),
				switches.length ? sectionPanel(result.siteId, 'switches', _('Switches'), switches.length,
					E('div', { 'class': 'unifi-device-grid' }, switches.map(function(device) {
						return deviceCard(device, deviceStats[(device.macAddress || '').toLowerCase()], counts[device.id], result.siteId, _('Switch'));
					})), switches.length <= 4) : null,
				sectionPanel(result.siteId, 'wired-clients', _('Wired clients'), wired.length,
					clientTable(wired, deviceNames, clientStats, true), wired.length <= 12),
				otherDevices.length ? sectionPanel(result.siteId, 'other-devices', _('Other devices'), otherDevices.length,
					E('div', { 'class': 'unifi-device-grid' }, otherDevices.map(function(device) {
						return deviceCard(device, deviceStats[(device.macAddress || '').toLowerCase()], counts[device.id], result.siteId, _('Device'));
					})), otherDevices.length <= 4) : null
			];
			return E('div', { 'class': 'unifi-dashboard' }, sections.filter(function(section) { return section != null; }));
	}
});
