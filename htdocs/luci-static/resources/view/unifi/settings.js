'use strict';
'require view';
'require form';
'require unifi.api as unifiApi';

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(unifiApi.exec('/usr/libexec/unifi-network/unifi-status', ['site'], true), ''),
			unifiApi.json('/usr/libexec/unifi-network/unifi-status', ['sites']).catch(function(error) {
				return { data: [], error: error.message || String(error) };
			})
		]);
	},

	render: function(data) {
		var map = new form.Map('unifi', _('UniFi Network'),
			_('Connect to the UniFi Network Integration API. Create an API key in the UniFi console and enter it here.'));
		var section = map.section(form.NamedSection, 'main', 'unifi', _('Connection'));
		var option;

		option = section.option(form.Value, 'url', _('Console URL'));
		option.rmempty = false;
		option.placeholder = 'https://192.168.1.1';
		option.validate = function(section_id, value) {
			return /^https:\/\/[^\s/?#]+\/?$/.test(value) || _('Enter an HTTPS console URL without a path');
		};

		option = section.option(form.Value, 'sni', _('SNI hostname'));
		option.placeholder = 'unifi.example.com';
		option.validate = function(section_id, value) {
			return !value || (value.length <= 253 && /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value)) ||
				_('Enter a valid SNI hostname without a scheme, port or path');
		};
		option.description = _('Optional. Connect to the console URL address using this hostname for TLS SNI, certificate verification and the HTTP Host header. Leave empty to use the URL hostname.');

		option = section.option(form.Value, 'api_key', _('API key'));
		option.password = true;
		option.rmempty = false;

		option = section.option(form.ListValue, 'site_id', _('Site'));
		option.value('', _('First available site'));
		(data[1].data || []).forEach(function(site) {
			option.value(site.id, site.name || site.id);
		});
		if (data[0] && !(data[1].data || []).some(function(site) { return site.id === data[0].trim(); }))
			option.value(data[0].trim(), data[0].trim());
		option.description = _('Save the connection settings, then reopen this page to choose a site.');
		if (data[1].error)
			option.description += ' ' + _('UniFi API request failed: ') + data[1].error;

		option = section.option(form.Flag, 'verify_tls', _('Verify TLS certificate'));
		option.default = '1';
		option.rmempty = false;
		option.description = _('Keep enabled when the console certificate is trusted by OpenWrt.');

		option = section.option(form.Value, 'tls_pin', _('TLS public key pin'));
		option.placeholder = 'sha256//...=';
		option.validate = function(section_id, value) {
			return !value || /^sha256\/\/[A-Za-z0-9+/]{43}=$/.test(value) || _('Enter a SHA-256 public key pin in sha256//...= format');
		};
		option.description = _('Required when certificate verification is disabled. A certificate change may require updating this pin.');

		return map.render();
	}
});
