import dns = require('dns');

export function parseAllowedHosts(raw: string | undefined): string[] {
    return raw ? raw.split(/[\n,]/).map(host => host.trim().toLowerCase()).filter(Boolean) : [];
}

export function isRegistryHostAllowed(hostname: string, allowedHosts: string[]): boolean {
    const host = hostname.toLowerCase();
    return allowedHosts.some(allowed => allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed);
}

export function isPrivateOrLinkLocalHost(hostname: string): boolean {
    let host = hostname.toLowerCase();
    if (host.startsWith('[')) {
        const closeBracket = host.indexOf(']');
        host = closeBracket >= 0 ? host.slice(1, closeBracket) : host.slice(1);
    } else if ((host.match(/:/g) || []).length === 1 && /^\d+$/.test(host.slice(host.lastIndexOf(':') + 1))) {
        host = host.slice(0, host.lastIndexOf(':'));
    }
    if (host === 'localhost' || host === '::1' || host === '::') return true;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const a = Number(ipv4[1]);
        const b = Number(ipv4[2]);
        return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    return /^fe[89ab][0-9a-f]:/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host);
}

export async function resolvesToPrivateOrLinkLocalAddress(
    hostname: string,
    lookup: (host: string) => Promise<{ address: string }[]> = host => dns.promises.lookup(host, { all: true }),
): Promise<boolean> {
    const addresses = await lookup(hostname);
    return addresses.some(address => isPrivateOrLinkLocalHost(address.address));
}