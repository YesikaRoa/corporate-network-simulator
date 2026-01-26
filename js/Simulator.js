const ICON_MAP = {
    'PC': 'fa-desktop',
    'Server': 'fa-server',
    'Router': 'fa-wifi',
    'Switch': 'fa-code-branch'
};

class NetworkSimulator {
    constructor() {
        this.devices = [];
        this.nextId = 1;
    }

    addDevice(type, x, y) {
        const id = this.nextId++;
        const name = `${type}-${id.toString().padStart(2, '0')}`;
        // Default IP config based on type for convenience
        let ip = '', mask = '', gw = '';
        if (type === 'Router') {
            ip = '192.168.1.1';
            mask = '255.255.255.0';
        }

        const device = new Device(id, type, name, ip, mask, gw, x, y);
        this.devices.push(device);
        return device;
    }

    removeDevice(id) {
        this.devices = this.devices.filter(d => d.id !== id);
        // Also remove connections
        this.devices.forEach(d => {
            d.disconnect(id);
        });
    }

    getDevice(id) {
        return this.devices.find(d => d.id === id);
    }

    connectDevices(id1, id2) {
        const d1 = this.getDevice(id1);
        const d2 = this.getDevice(id2);
        if (d1 && d2) {
            d1.connect(id2);
            d2.connect(id1);
        }
    }

    // Advanced Connectivity Test
    testConnectivity(sourceId, targetId) {
        const source = this.getDevice(parseInt(sourceId));
        const target = this.getDevice(parseInt(targetId));

        if (!source || !target) return { success: false, msg: "Dispositivo no encontrado" };
        if (!source.ip || !target.ip) return { success: false, msg: "Error: Configuración IP faltante" };

        // BFS to find if physical path exists
        const pathExists = this.checkPhysicalPath(source.id, target.id);
        if (!pathExists) {
            return { success: false, msg: "Error: No existe conexión física (cable) entre los dispositivos" };
        }

        // Logic Check
        const sameSubnet = NetworkUtils.isSameSubnet(source.ip, target.ip, source.mask);

        if (sameSubnet) {
            return {
                success: true,
                msg: `PING ${target.ip} (${target.name}): 56 bytes data\nReply from ${target.ip}: bytes=32 time=1ms TTL=64\nSUCCESS: Conectividad Local establecida`
            };
        } else {
            // Check Gateway
            if (!source.gateway) {
                return { success: false, msg: `PING ${target.ip}: Destination Host Unreachable\n(No Gateway configured)` };
            }
            // Simple logic: if gateway configured, checking if gateway is physically reachable would be next step
            // For this simulation, we assume if physical path exists to A Router, we can route.
            return {
                success: true,
                msg: `PING ${target.ip} (${target.name}): 56 bytes data\nReply from ${target.ip}: bytes=32 time=12ms TTL=54\nSUCCESS: Conectividad vía Gateway ${source.gateway}`
            };
        }
    }

    checkPhysicalPath(startId, endId) {
        let visited = new Set();
        let queue = [startId];
        visited.add(startId);

        while (queue.length > 0) {
            let curr = queue.shift();
            if (curr === endId) return true;

            const device = this.getDevice(curr);
            if (device) {
                for (let neighborId of device.connections) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push(neighborId);
                    }
                }
            }
        }
        return false;
    }
}

// UI Controller
const sim = new NetworkSimulator();

const UI = {
    draggedType: null,
    selectedDeviceId: null,
    currentTool: 'pointer', // 'pointer' | 'connect'
    connectStartId: null,

    init() {
        this.render();
    },

    handleDragStart(e, type) {
        this.draggedType = type;
        e.dataTransfer.effectAllowed = 'copy';
    },

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    },

    handleDrop(e) {
        e.preventDefault();
        const rect = document.getElementById('workspace').getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.draggedType) {
            sim.addDevice(this.draggedType, x, y);
            this.draggedType = null;
            this.render();
        }
    },

    setTool(tool) {
        this.currentTool = tool;
        this.connectStartId = null;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tool-${tool}`).classList.add('active');

        // Visual feedback for cursor
        const ws = document.getElementById('workspace');
        if (tool === 'connect') ws.style.cursor = 'crosshair';
        else ws.style.cursor = 'default';
    },

    handleDeviceClick(e, id) {
        e.stopPropagation(); // Prevent workspace click

        if (this.currentTool === 'connect') {
            if (this.connectStartId === null) {
                this.connectStartId = id;
                // Highlight source
                this.render();
            } else {
                if (this.connectStartId !== id) {
                    sim.connectDevices(this.connectStartId, id);
                    this.connectStartId = null;
                    this.setTool('pointer'); // Reset tool after connect
                    this.render();
                }
            }
        } else {
            // Pointer Mode - Select
            this.selectedDeviceId = id;
            this.openConfigModal(id);
            this.render();
        }
    },

    deleteSelected() {
        if (this.selectedDeviceId) {
            if (confirm('¿Eliminar dispositivo?')) {
                sim.removeDevice(this.selectedDeviceId);
                this.selectedDeviceId = null;
                this.render();
            }
        }
    },

    render() {
        const workspace = document.getElementById('workspace');
        const connLayer = document.getElementById('connections-layer');

        // Clear existing devices (keep static elements like svg/toolbar)
        // A cleaner way is to remove elements with class 'device'
        document.querySelectorAll('.device').forEach(el => el.remove());

        // Render Devices
        sim.devices.forEach(d => {
            const el = document.createElement('div');
            el.className = `device ${this.selectedDeviceId === d.id ? 'selected' : ''}`;
            el.style.left = `${d.x}px`;
            el.style.top = `${d.y}px`;
            if (this.connectStartId === d.id) el.style.opacity = '0.7'; // Visual cue for connection source

            el.innerHTML = `
                <div class="device-icon-wrapper">
                    <i class="fa-solid ${ICON_MAP[d.type]}"></i>
                </div>
                <div class="device-label">${d.name}</div>
                ${d.ip ? `<div class="device-ip">${d.ip}</div>` : ''}
            `;

            el.onclick = (e) => this.handleDeviceClick(e, d.id);

            // Allow dragging (simple implementation)
            el.draggable = true;
            el.ondragstart = (e) => {
                if (this.currentTool === 'pointer') {
                    // Store ID to move
                    e.dataTransfer.setData('moveId', d.id);
                } else {
                    e.preventDefault();
                }
            };
            el.ondragend = (e) => {
                if (this.currentTool === 'pointer') {
                    const rect = workspace.getBoundingClientRect();
                    d.x = e.clientX - rect.left;
                    d.y = e.clientY - rect.top;
                    this.render();
                }
            }

            workspace.appendChild(el);
        });

        // Render Connections
        connLayer.innerHTML = '';
        const drawnConnections = new Set();

        sim.devices.forEach(d1 => {
            d1.connections.forEach(id2 => {
                // specific key to avoid double drawing
                const key = [d1.id, id2].sort().join('-');
                if (drawnConnections.has(key)) return;

                const d2 = sim.getDevice(id2);
                if (d2) {
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', d1.x);
                    line.setAttribute('y1', d1.y);
                    line.setAttribute('x2', d2.x);
                    line.setAttribute('y2', d2.y);
                    connLayer.appendChild(line);
                    drawnConnections.add(key);
                }
            });
        });
    },

    // Modal Handling
    openConfigModal(id) {
        const d = sim.getDevice(id);
        if (!d) return;

        document.getElementById('conf-name').value = d.name;
        document.getElementById('conf-ip').value = d.ip;
        document.getElementById('conf-mask').value = d.mask;
        document.getElementById('conf-gw').value = d.gateway;

        document.getElementById('config-modal').classList.add('active');
    },

    saveConfig() {
        if (this.selectedDeviceId) {
            const d = sim.getDevice(this.selectedDeviceId);
            d.name = document.getElementById('conf-name').value;
            d.ip = document.getElementById('conf-ip').value;
            d.mask = document.getElementById('conf-mask').value;
            d.gateway = document.getElementById('conf-gw').value;
            this.render();
            this.closeModals();
        }
    },

    openPingModal() {
        const sourceSelect = document.getElementById('ping-source');
        const targetSelect = document.getElementById('ping-target');
        sourceSelect.innerHTML = '';
        targetSelect.innerHTML = '';

        sim.devices.forEach(d => {
            const opt = `<option value="${d.id}">${d.name} (${d.ip || 'No IP'})</option>`;
            sourceSelect.innerHTML += opt;
            targetSelect.innerHTML += opt;
        });

        document.getElementById('ping-output').innerHTML = '> Esperando comando...';
        document.getElementById('ping-modal').classList.add('active');
    },

    runPing() {
        const sId = document.getElementById('ping-source').value;
        const tId = document.getElementById('ping-target').value;
        const consoleOut = document.getElementById('ping-output');

        consoleOut.innerHTML += `\n> ping ${sId} -> ${tId}...`;

        const res = sim.testConnectivity(sId, tId);

        const resClass = res.success ? 'ping-success' : 'ping-fail';
        consoleOut.innerHTML += `\n<span class="${resClass}">${res.msg}</span>`;
        consoleOut.scrollTop = consoleOut.scrollHeight;
    },

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    }
};

// Handle clicks on workspace to deselect
document.getElementById('workspace').addEventListener('click', (e) => {
    if (e.target.id === 'workspace' || e.target.id === 'connections-layer') {
        UI.selectedDeviceId = null;
        UI.render();
    }
});

// Initialize
UI.init();
