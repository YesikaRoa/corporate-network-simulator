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

class Interface {
    constructor(name, type = 'ethernet', ip = '', mask = '') {
        this.name = name;
        this.type = type; // 'ethernet', 'serial', 'console'
        this.ip = ip;
        this.mask = mask;
        this.connectedDeviceId = null;
        this.connectedInterfaceName = null;
    }
}

class Device {
    constructor(id, type, name, ip, mask, gateway, x = 0, y = 0) {
        this.id = id;
        this.type = type; // 'PC', 'Laptop', 'Server', 'Switch', 'Router'
        this.name = name;

        // For PCs/Servers
        this.ip = ip || '';
        this.mask = mask || '';
        this.gateway = gateway || '';

        // For Routers (and potentially others)
        this.interfaces = [];

        this.x = x;
        this.y = y;
        this.connections = []; // Visual/Physical connections list (IDs)
        this.metadata = {}; // specific icons, etc.
    }

    addInterface(name, type = 'ethernet', ip = '', mask = '') {
        this.interfaces.push(new Interface(name, type, ip, mask));
    }

    getInterface(name) {
        return this.interfaces.find(i => i.name === name);
    }

    // Connect logic now needs to be aware of interfaces for Routers
    // But for physical connection visualization, we keep simple ID tracking
    connect(deviceId) {
        if (!this.connections.includes(deviceId)) {
            this.connections.push(deviceId);
        }
    }

    disconnect(deviceId) {
        this.connections = this.connections.filter(id => id !== deviceId);
        // Also clear interface connection if applicable
        this.interfaces.forEach(iface => {
            if (iface.connectedDeviceId === deviceId) {
                iface.connectedDeviceId = null;
            }
        });
    }
}