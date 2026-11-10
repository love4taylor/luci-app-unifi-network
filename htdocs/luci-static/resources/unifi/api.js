'use strict';
'require baseclass';
'require fs';

function errorMessage(code) {
	var messages = {
		connect: _('Cannot connect to the UniFi console. It may be powered off or unreachable; check its address, port and network connection.'),
		dns: _('Cannot resolve the UniFi console address. Check the hostname and DNS settings.'),
		timeout: _('The UniFi console request timed out. Check whether the console is online and reachable.'),
		tls: _('TLS handshake with the UniFi console failed. Check the HTTPS port and SNI hostname.'),
		certificate: _('UniFi console certificate verification failed. Check the certificate, SNI hostname and router clock.'),
		pin: _('The UniFi console TLS public key does not match the configured pin. Verify the certificate before updating the pin.'),
		empty: _('The UniFi console returned an empty response. It may be restarting or unavailable.'),
		invalid: _('The UniFi console returned an invalid response. Check the console URL and reverse proxy settings.'),
		transfer: _('The UniFi console connection was interrupted. Check the console and network connection.'),
		url: _('Enter an HTTPS console URL without a path'),
		key: _('Configure a valid UniFi API key'),
		sni: _('Enter a valid SNI hostname without a scheme, port or path'),
		pin_config: _('Enter a SHA-256 public key pin in sha256//...= format'),
		verify: _('TLS verification requires a trusted certificate or a public key pin')
	};
	if (messages[code])
		return messages[code];
	if (code === 'http_401' || code === 'http_403')
		return _('UniFi API authentication failed. Check the API key and its permissions.');
	if (code === 'http_404')
		return _('UniFi API endpoint not found. Check the console URL and Network Integration API availability.');
	if (code === 'http_429')
		return _('The UniFi console is receiving too many requests. Try again later.');
	if (/^http_5\d\d$/.test(code))
		return _('The UniFi console or reverse proxy is unavailable (HTTP %s). Try again when the service is running.').format(code.slice(5));
	if (/^http_\d{3}$/.test(code))
		return _('The UniFi console returned HTTP %s. Check the console and reverse proxy settings.').format(code.slice(5));
	return _('UniFi request failed. Check the connection settings and try again.');
}

return baseclass.extend({
	exec: function(command, args, allowEmpty) {
		return fs.exec_direct(command, args, 'text', false, true).then(function(output) {
			var error = /(?:^|\n)UNIFI_ERROR:([a-z0-9_]+)(?:\n|$)/.exec(output);
			if (error)
				throw new Error(errorMessage(error[1]));
			if (!allowEmpty && !output.trim())
				throw new Error(errorMessage('empty'));
			return output;
		});
	},

	json: function(command, args) {
		return this.exec(command, args).then(function(output) {
			try {
				var result = JSON.parse(output);
			}
			catch (error) {
				throw new Error(errorMessage('invalid'));
			}
			if (!result || typeof result !== 'object' || Array.isArray(result))
				throw new Error(errorMessage('invalid'));
			return result;
		});
	}
});
