// Finds the address phones should use to reach this computer on the local network.
import os from 'node:os';

// Adapters that are never the Wi-Fi or cable phones are on: virtual switches, VPNs, containers, Bluetooth.
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vboxnet|Tailscale|ZeroTier|Loopback|Bluetooth|TAP|TUN|Npcap|Pseudo|utun|veth|br-/i;
const privateRank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 9);
const nameRank = (n) => (/wi-?fi|wlan|wireless/i.test(n) ? 0 : /ethernet|eth\d|en\d/i.test(n) ? 1 : 2);

/** Usable IPv4 addresses, best guess first: [{ name, address }]. */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.') || privateRank(i.address) === 9) continue;
      out.push({ name, address: i.address });
    }
  }
  return out.sort((a, b) => nameRank(a.name) - nameRank(b.name) || privateRank(a.address) - privateRank(b.address));
}
