#!/bin/sh

unifi_error() {
	printf 'UNIFI_ERROR:%s\n' "$1" >&2
	return 1
}

unifi_config() {
	UNIFI_URL="$(uci -q get unifi.main.url)"
	UNIFI_KEY="$(uci -q get unifi.main.api_key)"
	# LuCI may omit flags whose value matches the default. Keep verification
	# enabled when the option is absent, including in callers using set -e.
	UNIFI_VERIFY="$(uci -q get unifi.main.verify_tls)" || UNIFI_VERIFY=1
	UNIFI_VERIFY="${UNIFI_VERIFY:-1}"
	UNIFI_PIN="$(uci -q get unifi.main.tls_pin)" || UNIFI_PIN=''
	UNIFI_SNI="$(uci -q get unifi.main.sni)" || UNIFI_SNI=''
	UNIFI_CONNECT_TO=''

	case "$UNIFI_URL" in
		*[[:space:]]*) unifi_error url; return 1 ;;
		https://*) UNIFI_URL="${UNIFI_URL%/}" ;;
		*) unifi_error url; return 1 ;;
	esac
	case "$UNIFI_KEY" in
		''|*[!a-zA-Z0-9._~-]*) unifi_error key; return 1 ;;
	esac
	case "$UNIFI_PIN" in
		'') ;;
		*[!a-zA-Z0-9+/=]*) unifi_error pin_config; return 1 ;;
		*)
			printf '%s\n' "$UNIFI_PIN" | grep -Eq '^sha256//[A-Za-z0-9+/]{43}=$' || {
				unifi_error pin_config
				return 1
			}
			;;
	esac
	case "$UNIFI_VERIFY" in
		1) ;;
		0) [ -n "$UNIFI_PIN" ] || {
			unifi_error verify
			return 1
		} ;;
		*) unifi_error verify; return 1 ;;
	esac

	if [ -n "$UNIFI_SNI" ]; then
		case "$UNIFI_SNI" in
			*[!A-Za-z0-9.-]*) unifi_error sni; return 1 ;;
		esac
		[ "${#UNIFI_SNI}" -le 253 ] && printf '%s\n' "$UNIFI_SNI" | \
			grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$' || {
			unifi_error sni
			return 1
		}
		authority="${UNIFI_URL#https://}"
		printf '%s\n' "$authority" | \
			grep -Eq '^(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)(:[0-9]{1,5})?$' || {
			unifi_error url
			return 1
		}
		case "$authority" in
			\[*\]) host="$authority"; port=443 ;;
			*:*) host="${authority%:*}"; port="${authority##*:}" ;;
			*) host="$authority"; port=443 ;;
		esac
		[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { unifi_error url; return 1; }
		UNIFI_CONNECT_TO="$UNIFI_SNI:$port:$host:$port"
		UNIFI_URL="https://$UNIFI_SNI:$port"
	fi
}

unifi_uuid() {
	case "$1" in
		????????-????-????-????-????????????)
			case "$1" in *[!0-9a-fA-F-]*) return 1 ;; esac ;;
		*) return 1 ;;
	esac
}

unifi_mac() {
	case "$1" in *[!0-9a-fA-F:]*|'') return 1 ;; esac
	printf '%s\n' "$1" | grep -Eq '^[[:xdigit:]]{2}(:[[:xdigit:]]{2}){5}$'
}

unifi_curl() (
	if [ "$UNIFI_VERIFY" = 0 ]; then
		set -- --insecure "$@"
	fi
	if [ -n "$UNIFI_PIN" ]; then
		set -- --pinnedpubkey "$UNIFI_PIN" "$@"
	fi
	if [ -n "$UNIFI_CONNECT_TO" ]; then
		set -- --connect-to "$UNIFI_CONNECT_TO" "$@"
	fi
	# Buffer the body so a failed transfer cannot expose partial JSON to LuCI.
	if response="$(printf 'header = "X-API-KEY: %s"\n' "$UNIFI_KEY" | \
		curl --config - --silent --fail --connect-timeout 5 --max-time 20 \
		--max-filesize 8388608 --write-out '\n%{http_code}' "$@")"; then
		status=0
	else
		status=$?
	fi
	http_code="${response##*
}"
	case "$status" in
		0) ;;
		5|6) unifi_error dns; exit 1 ;;
		7) unifi_error connect; exit 1 ;;
		28) unifi_error timeout; exit 1 ;;
		35) unifi_error tls; exit 1 ;;
		51|60|77|83) unifi_error certificate; exit 1 ;;
		90) unifi_error pin; exit 1 ;;
		52) unifi_error empty; exit 1 ;;
		22) unifi_error "http_$http_code"; exit 1 ;;
		*) unifi_error transfer; exit 1 ;;
	esac
	case "$http_code" in
		204) printf '{}\n'; exit 0 ;;
		2??) ;;
		*) unifi_error "http_$http_code"; exit 1 ;;
	esac
	body="${response%
*}"
	[ -n "$body" ] || { unifi_error empty; exit 1; }
	printf '%s' "$body" | jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1 || {
		unifi_error invalid
		exit 1
	}
	printf '%s\n' "$body"
)

unifi_request() {
	method="$1"
	path="$2"
	if [ "$method" = POST ]; then
		unifi_curl --header 'Accept: application/json' \
			--header 'Content-Type: application/json' --data '{"action":"RESTART"}' \
			"$UNIFI_URL/proxy/network/integration/v1/$path"
	else
		unifi_curl --header 'Accept: application/json' \
			"$UNIFI_URL/proxy/network/integration/v1/$path"
	fi
}

unifi_legacy_request() {
	path="$1"
	unifi_curl --header 'Accept: application/json' \
		"$UNIFI_URL/proxy/network/$path"
}

unifi_legacy_post() {
	path="$1"
	payload="$2"
	unifi_curl --header 'Accept: application/json' \
		--header 'Content-Type: application/json' --data "$payload" \
		"$UNIFI_URL/proxy/network/$path"
}

unifi_legacy_site() {
	local response
	response="$(unifi_legacy_request 'api/self/sites')" || return 1
	printf '%s' "$response" | \
		jq -er --arg id "$1" '.data[] | select(.external_id == $id) | .name'
}
