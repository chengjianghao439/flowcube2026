#!/usr/bin/env bash
set -euo pipefail

: "${FLOWCUBE_WG_PRIVATE_KEY:?缺少发布隧道私钥}"
: "${FLOWCUBE_WG_SERVER_PUBLIC_KEY:?缺少发布隧道服务器公钥}"
: "${FLOWCUBE_WG_ENDPOINT:?缺少发布隧道入口}"
: "${FLOWCUBE_WG_SERVER_IP:?缺少发布隧道服务器地址}"
: "${FLOWCUBE_WG_CLIENT_IP:?缺少发布隧道客户端地址}"

for address in "$FLOWCUBE_WG_SERVER_IP" "$FLOWCUBE_WG_CLIENT_IP"; do
  [[ "$address" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)[0-9.]+$ &&
    "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo '发布隧道须使用私有 IPv4 地址' >&2; exit 1; }
done
[[ "$FLOWCUBE_WG_SERVER_IP" != "$FLOWCUBE_WG_CLIENT_IP" ]]
[[ "$FLOWCUBE_WG_ENDPOINT" =~ ^[A-Za-z0-9.-]+:51820$ ]] || { echo '发布隧道入口须使用 UDP 51820' >&2; exit 1; }
[[ "$FLOWCUBE_WG_SERVER_PUBLIC_KEY" =~ ^[A-Za-z0-9+/]{43}=$ &&
   "$FLOWCUBE_WG_PRIVATE_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo 'WireGuard 密钥格式无效' >&2; exit 1; }

umask 077
key_file=$(mktemp)
created=false
interface=flowcube-wg
cleanup() {
  local result=$?
  rm -f -- "$key_file"
  if (( result != 0 )) && "$created"; then sudo ip link delete dev "$interface"; fi
}
trap cleanup EXIT
printf '%s\n' "$FLOWCUBE_WG_PRIVATE_KEY" > "$key_file"
unset FLOWCUBE_WG_PRIVATE_KEY
if ! command -v wg >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends wireguard-tools
fi

sudo ip link add dev "$interface" type wireguard
created=true
sudo wg set "$interface" private-key "$key_file" peer "$FLOWCUBE_WG_SERVER_PUBLIC_KEY" \
  endpoint "$FLOWCUBE_WG_ENDPOINT" allowed-ips "$FLOWCUBE_WG_SERVER_IP/32"
sudo ip -4 address add "$FLOWCUBE_WG_CLIENT_IP/32" dev "$interface"
sudo ip link set dev "$interface" mtu 1420 up
sudo ip -4 route add "$FLOWCUBE_WG_SERVER_IP/32" dev "$interface" src "$FLOWCUBE_WG_CLIENT_IP"
