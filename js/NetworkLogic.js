class NetworkUtils {
    // Convierte IP "192.168.1.1" a número de 32 bits
    static ipToLong(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    // Verifica si dos IPs están en la misma red
    static isSameSubnet(ip1, ip2, mask) {
        const longIp1 = this.ipToLong(ip1);
        const longIp2 = this.ipToLong(ip2);
        const longMask = this.ipToLong(mask);
        return (longIp1 & longMask) === (longIp2 & longMask);
    }
}

class Device {
    constructor(id, type, name, ip, mask, gateway, x = 0, y = 0) {
        this.id = id;
        this.type = type; // 'PC', 'Server', 'Switch', 'Router'
        this.name = name;
        this.ip = ip || '';
        this.mask = mask || '';
        this.gateway = gateway || '';
        this.x = x;
        this.y = y;
        this.connections = []; // List of connected device IDs
    }

    connect(deviceId) {
        if (!this.connections.includes(deviceId)) {
            this.connections.push(deviceId);
        }
    }

    disconnect(deviceId) {
        this.connections = this.connections.filter(id => id !== deviceId);
    }
}