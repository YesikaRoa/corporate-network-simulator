const ICON_MAP = {
    'PC': 'fa-desktop',
    'Laptop': 'fa-laptop',
    'Server': 'fa-server',
    'Router': 'fa-wifi',
    'Switch': 'fa-code-branch'
};

class NetworkSimulator {
    constructor() {
        this.devices = [];
        this.nextId = 1;
        this.textLabels = []; // {id, x, y, text}
        this.nextTextId = 1;
        this.logs = []; // Connectivity logs
    }

    addDevice(type, x, y) {
        const id = this.nextId++;
        const name = `${type}-${id.toString().padStart(2, '0')}`;
        let ip = '', mask = '', gw = '';

        const device = new Device(id, type, name, ip, mask, gw, x, y);

        // Initialize Default Interfaces
        if (type === 'Router') {
            device.addInterface('FastEthernet0/0', 'ethernet');
            device.addInterface('FastEthernet0/1', 'ethernet');
            device.addInterface('Serial0/0/0', 'serial');
            device.addInterface('Serial0/0/1', 'serial');
        } else if (type === 'Switch') {
            // 24 Ports
            for (let i = 1; i <= 24; i++) device.addInterface(`FastEthernet0/${i}`, 'ethernet');
        } else {
            // PC, Laptop, Server
            device.addInterface('FastEthernet0', 'ethernet');
        }

        this.devices.push(device);
        return device;
    }

    addTextLabel(x, y, text) {
        this.textLabels.push({ id: this.nextTextId++, x, y, text });
    }

    removeDevice(id) {
        // Disconnect all interfaces
        const d = this.getDevice(id);
        if (d) {
            d.interfaces.forEach(iface => {
                if (iface.connectedDeviceId) {
                    this.disconnectLink(d.id, iface.name, iface.connectedDeviceId, iface.connectedInterfaceName);
                }
            });
        }
        this.devices = this.devices.filter(d => d.id !== id);
    }

    disconnectLink(id1, iface1Name, id2, iface2Name) {
        const d1 = this.getDevice(id1);
        const d2 = this.getDevice(id2);

        if (d1) {
            const i1 = d1.getInterface(iface1Name);
            if (i1) { i1.connectedDeviceId = null; i1.connectedInterfaceName = null; }
            d1.disconnect(id2);
        }
        if (d2) {
            const i2 = d2.getInterface(iface2Name);
            if (i2) { i2.connectedDeviceId = null; i2.connectedInterfaceName = null; }
            d2.disconnect(id1);
        }
    }

    getDevice(id) {
        return this.devices.find(d => d.id === id);
    }

    // Connect specific interfaces
    connectInterfaces(id1, ifName1, id2, ifName2) {
        const d1 = this.getDevice(id1);
        const d2 = this.getDevice(id2);

        if (!d1 || !d2) return false;

        const i1 = d1.getInterface(ifName1);
        const i2 = d2.getInterface(ifName2);

        if (!i1 || !i2) return false;
        if (i1.connectedDeviceId || i2.connectedDeviceId) return false;

        // Validate types usually (Serial-Serial, Eth-Eth), but we allow flexible for now or enforce?
        // Let's enforce roughly
        if (i1.type !== i2.type) {
            // alert? Warning? For now allow but maybe warn in console
            console.warn("Connecting different cable types");
        }

        i1.connectedDeviceId = id2;
        i1.connectedInterfaceName = ifName2;
        i1.status = 'down'; // Start Red

        i2.connectedDeviceId = id1;
        i2.connectedInterfaceName = ifName1;
        i2.status = 'down'; // Start Red

        d1.connect(id2);
        d2.connect(id1);

        // Simulate Link Up negotiation (2 seconds)
        setTimeout(() => {
            i1.status = 'up';
            i2.status = 'up';
            // Trigger re-render if UI is available (this is a bit coupled, but works for this scope)
            if (typeof UI !== 'undefined') UI.render();
        }, 2000);

        return true;
    }

    testConnectivity(sourceId, targetId) {
        const source = this.getDevice(parseInt(sourceId));
        const target = this.getDevice(parseInt(targetId));

        if (!source || !target) return { success: false, msg: "Dispositivo no encontrado" };

        // Prevent self-ping
        if (source.id === target.id) {
            return { success: false, msg: "Error: No se puede hacer ping a sí mismo" };
        }

        if (!this.checkPhysicalPath(source.id, target.id)) {
            return { success: false, msg: "Error: No existe conexión física (cable) entre los dispositivos" };
        }

        if (!source.ip && source.type !== 'Router') return { success: false, msg: "Error: Configuración IP faltante en Origen" };
        // Router might behave without global IP if we ping from an interface, but here we assume general device ping

        let result = { success: false, msg: "Tiempo de espera agotado" };

        if (this.checkRoutingPath(source, target)) {
            // Generate success message with plausible TTL and Time
            // Distance estimation could be improved but constant is fine for now
            let replyIP = target.ip;
            if (target.type === 'Router') {
                // Try to pick an IP that is reachable or just the first one
                const reachableIface = target.interfaces.find(i => i.ip);
                replyIP = reachableIface ? reachableIface.ip : 'Router';
            }
            result = { success: true, msg: `Respuesta desde ${replyIP}: bytes=32 tiempo=5ms TTL=248` };
        } else {
            if (source.gateway && !NetworkUtils.isSameSubnet(source.ip, source.gateway, source.mask)) {
                result = { success: false, msg: "Error: Gateway inalcanzable (fuera de subred)" };
            } else {
                result = { success: false, msg: "Red de destino inalcanzable" };
            }
        }

        // Append Explicit Success Message
        if (result.success) {
            const targetName = target.type === 'Router' ? 'Router' : target.ip;
            result.msg += `\n\nEstadísticas de ping para ${targetName}:\n    Paquetes: Enviados = 4, Recibidos = 4, Perdidos = 0 (0% perdidos)`;
        }

        return result;
    }

    checkRoutingPath(source, target) {
        // 1. Check Direct Connection (Same Subnet)
        const sourceIPs = source.type === 'Router' ? source.interfaces.map(i => i.ip).filter(ip => ip) : (source.ip ? [source.ip] : []);
        const targetIPs = target.type === 'Router' ? target.interfaces.map(i => i.ip).filter(ip => ip) : (target.ip ? [target.ip] : []);

        for (let sip of sourceIPs) {
            let sMask = source.type === 'Router' ? source.interfaces.find(i => i.ip === sip).mask : source.mask;
            if (!sMask) continue;
            for (let tip of targetIPs) {
                if (NetworkUtils.isSameSubnet(sip, tip, sMask)) return true;
            }
        }

        // 2. Identify Start Router for Routing
        let startRouter = null;

        if (source.type === 'Router') {
            startRouter = source;
        } else {
            // PC/Laptop/Server
            if (!source.gateway) return false; // No Gateway

            // Check if Gateway is reachable (same subnet)
            if (!NetworkUtils.isSameSubnet(source.ip, source.gateway, source.mask)) return false;

            // Find Gateway Device
            startRouter = this.devices.find(d => d.type === 'Router' && d.interfaces.some(i => i.ip === source.gateway));
            if (!startRouter) return false; // Gateway device not found or not a Router
        }

        // 3. BFS Routing
        return this.findPathBFS(startRouter, target);
    }

    findPathBFS(startRouter, targetDevice) {
        if (startRouter.id === targetDevice.id) return true;

        let visited = new Set();
        let queue = [startRouter];
        visited.add(startRouter.id);

        while (queue.length > 0) {
            let current = queue.shift();

            // Check if current router can directly reach target
            const targetIPs = targetDevice.type === 'Router' ? targetDevice.interfaces.map(i => i.ip).filter(ip => ip) : [targetDevice.ip];

            for (let iface of current.interfaces) {
                if (!iface.ip || !iface.mask) continue;
                for (let tip of targetIPs) {
                    if (tip && NetworkUtils.isSameSubnet(iface.ip, tip, iface.mask)) {
                        return true; // Target is directly connected to this router
                    }
                }
            }

            // Queue Neighbors
            for (let iface of current.interfaces) {
                if (iface.connectedDeviceId) {
                    const neighbor = this.getDevice(iface.connectedDeviceId);
                    if (neighbor && neighbor.type === 'Router' && !visited.has(neighbor.id)) {
                        // Verify Logical Link (Layer 3 connectivity)
                        const neighborIface = neighbor.getInterface(iface.connectedInterfaceName);
                        // Check strictly if both sides have IP and match subnet
                        if (neighborIface && neighborIface.ip && iface.ip && iface.mask) {
                            if (NetworkUtils.isSameSubnet(iface.ip, neighborIface.ip, iface.mask)) {
                                visited.add(neighbor.id);
                                queue.push(neighbor);
                            }
                        }
                    }
                }
            }
        }
        return false;
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
                // BFS using connections
                // Note: device.connections is simple ID list, acceptable for now
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

    getRoute(sourceId, targetId) {
        const source = this.getDevice(sourceId);
        const target = this.getDevice(targetId);
        if (!source || !target) return null;

        // Path finding logic suitable for this specific simulator (L3 logic)
        // Similar to checkRoutingPath but returns array of Device objects

        // 1. Identify Start Router
        let startRouter = null;
        let prefix = [];

        if (source.type === 'Router') {
            startRouter = source;
            prefix.push(source);
        } else {
            prefix.push(source);
            if (NetworkUtils.isSameSubnet(source.ip, target.ip, source.mask)) {
                // Direct connection (Switch or direct cable)
                // For animation, we should ideally find the physical path (Switches)
                // But for now, direct hop logic: Source -> Target
                return [source, target];
            }
            if (!source.gateway) return null;
            startRouter = this.devices.find(d => d.type === 'Router' && d.interfaces.some(i => i.ip === source.gateway));
            // Add intermediate switches if possible, but for now just logical hops
            if (startRouter) prefix.push(startRouter);
            else return null; // No gateway found
        }

        // BFS with Path Reconstruction
        let queue = [{ node: startRouter, path: [startRouter] }];
        let visited = new Set([startRouter.id]);

        while (queue.length > 0) {
            let { node: current, path } = queue.shift();

            // Check if current can reach target directly
            const targetIPs = target.type === 'Router' ? target.interfaces.map(i => i.ip).filter(ip => ip) : [target.ip];
            let directlyConnected = false;
            for (let iface of current.interfaces) {
                if (!iface.ip || !iface.mask) continue;
                for (let tip of targetIPs) {
                    if (tip && NetworkUtils.isSameSubnet(iface.ip, tip, iface.mask)) {
                        directlyConnected = true;
                        break;
                    }
                }
            }

            if (directlyConnected) {
                // Determine if we need to add the target as the final step
                // If it's the router itself? No, target is destination.
                if (target.id !== current.id) {
                    return [...prefix.slice(0, prefix.indexOf(path[0])), ...path, target];
                }
                return [...prefix.slice(0, prefix.indexOf(path[0])), ...path];
            }

            // Neighbors
            for (let iface of current.interfaces) {
                if (iface.connectedDeviceId) {
                    const neighbor = this.getDevice(iface.connectedDeviceId);
                    if (neighbor && neighbor.type === 'Router' && !visited.has(neighbor.id)) {
                        const neighborIface = neighbor.getInterface(iface.connectedInterfaceName);
                        if (neighborIface && neighborIface.ip && iface.ip && iface.mask) {
                            if (NetworkUtils.isSameSubnet(iface.ip, neighborIface.ip, iface.mask)) {
                                visited.add(neighbor.id);
                                queue.push({ node: neighbor, path: [...path, neighbor] });
                            }
                        }
                    }
                }
            }
        }
        return null;
    }
}

// UI Controller
const sim = new NetworkSimulator();

const UI = {
    draggedType: null,
    selectedDeviceId: null,
    currentTool: 'pointer', // 'pointer' | 'connect' | 'text'
    connectStartId: null,
    draggedTextId: null, // For moving text
    zoomLevel: 1, // Zoom level (1 = 100%)
    sidebarCollapsed: false,

    init() {
        // Check if on mobile/tablet and collapse sidebar by default BEFORE rendering
        if (window.innerWidth <= 1024) {
            this.sidebarCollapsed = true;
            const sidebar = document.querySelector('aside');
            const footer = document.querySelector('.sidebar-footer');
            if (sidebar) {
                sidebar.classList.add('collapsed');
            }
            if (footer) {
                footer.style.width = '0';
            }
        }
        this.render();
        this.updateZoomDisplay();
    },

    setTool(tool) {
        this.currentTool = tool;
        this.connectStartId = null;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`tool-${tool}`);
        if (btn) btn.classList.add('active');

        const ws = document.getElementById('workspace');
        if (tool === 'connect') ws.style.cursor = 'crosshair';
        else if (tool === 'text') ws.style.cursor = 'text';
        else ws.style.cursor = 'default';
    },

    handleDragStart(e, type) {
        this.draggedType = type;
        e.dataTransfer.effectAllowed = 'copy';
    },

    // --- Touch Drag & Drop Implementation ---
    touchDragItem: null,
    touchGhost: null,

    handleTouchDragStart(e, type) {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        this.touchDragItem = type;

        // Create Ghost Element
        this.touchGhost = document.createElement('div');
        this.touchGhost.className = 'ghost-drag';
        this.touchGhost.innerHTML = `<i class="fa-solid ${ICON_MAP[type]}"></i> <span>${type}</span>`;
        this.touchGhost.style.left = `${touch.clientX}px`;
        this.touchGhost.style.top = `${touch.clientY}px`;
        document.body.appendChild(this.touchGhost);

        // Attach global move/end listeners
        document.addEventListener('touchmove', this._touchMoveHandler, { passive: false });
        document.addEventListener('touchend', this._touchEndHandler);
    },

    _touchMoveHandler: (e) => UI.handleTouchMove(e),
    _touchEndHandler: (e) => UI.handleTouchEnd(e),

    handleTouchMove(e) {
        if (!this.touchGhost) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.touchGhost.style.left = `${touch.clientX}px`;
        this.touchGhost.style.top = `${touch.clientY}px`;
    },

    handleTouchEnd(e) {
        if (!this.touchDragItem) return;

        // Clean up listeners
        document.removeEventListener('touchmove', this._touchMoveHandler);
        document.removeEventListener('touchend', this._touchEndHandler);

        // Remove ghost
        if (this.touchGhost) {
            this.touchGhost.remove();
            this.touchGhost = null;
        }

        // Check if dropped on workspace
        const touch = e.changedTouches[0];
        const ws = document.getElementById('workspace');
        const rect = ws.getBoundingClientRect();

        // Check bounds
        if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom) {

            const x = (touch.clientX - rect.left) / this.zoomLevel;
            const y = (touch.clientY - rect.top) / this.zoomLevel;

            sim.addDevice(this.touchDragItem, x, y);
            this.render();
            this.showToast('Dispositivo agregado', 'success');

            // If on mobile, auto-close sidebar after drop
            if (window.innerWidth <= 768 && !this.sidebarCollapsed) {
                this.toggleSidebar();
            }
        }

        this.touchDragItem = null;
    },

    handleDragOver(e) { e.preventDefault(); },
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

    handleWorkspaceClick(e) {
        if (e.target.id === 'workspace' || e.target.id === 'connections-layer') {
            if (this.currentTool === 'text') {
                this.createTextInput(e.clientX, e.clientY);
            } else {
                this.selectedDeviceId = null;
                this.render();
            }
        }
    },

    createTextInput(clientX, clientY) {
        const rect = document.getElementById('workspace').getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const input = document.createElement('input');
        input.type = 'text';
        input.style.position = 'absolute';
        input.style.left = `${x}px`;
        input.style.top = `${y}px`;
        input.style.background = 'var(--bg-card)';
        input.style.color = 'var(--text-main)';
        input.style.border = '1px solid var(--primary)';
        input.style.padding = '4px';
        input.style.zIndex = '1000';
        input.placeholder = 'Etiqueta...';

        input.onblur = () => {
            if (input.value.trim()) {
                sim.addTextLabel(x, y, input.value);
            }
            input.remove();
            this.render();
            this.setTool('pointer');
        };

        input.onkeydown = (k) => {
            if (k.key === 'Enter') input.blur();
        };

        document.getElementById('workspace').appendChild(input);
        input.focus();
    },

    handleDeviceClick(e, id) {
        e.stopPropagation();

        if (this.currentTool === 'connect') {
            if (this.connectStartId === null) {
                this.connectStartId = id;
                this.render();
            } else {
                if (this.connectStartId !== id) {
                    this.openConnectionModal(this.connectStartId, id);
                }
            }
        } else if (this.currentTool === 'delete') {
            this.showConfirm('¿Eliminar dispositivo?', () => {
                sim.removeDevice(id);
                this.selectedDeviceId = null;
                this.render();
                this.showToast('Dispositivo eliminado', 'success');
            });
        } else if (this.currentTool === 'pointer') {
            this.selectedDeviceId = id;
            this.openConfigModal(id);
            this.render();
        }
    },

    deleteSelected() {
        if (this.selectedDeviceId) {
            this.showConfirm('¿Eliminar dispositivo seleccionado?', () => {
                sim.removeDevice(this.selectedDeviceId);
                this.selectedDeviceId = null;
                this.render();
                this.showToast('Dispositivo eliminado', 'success');
            });
        } else {
            // If called from toolbar button, just set the tool
            this.setTool('delete');
        }
    },

    openConnectionModal(sourceId, targetId) {
        const s = sim.getDevice(sourceId);
        const t = sim.getDevice(targetId);

        document.getElementById('conn-src-name').textContent = s.name;
        document.getElementById('conn-target-name').textContent = t.name;

        const renderList = (device, containerId, side) => {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            device.interfaces.forEach(iface => {
                const div = document.createElement('div');
                div.className = `interface-item ${iface.connectedDeviceId ? 'disabled' : ''}`;

                let icon = 'fa-ethernet';
                if (iface.type === 'serial') icon = 'fa-bolt';

                div.innerHTML = `<i class="fa-solid ${icon} interface-icon"></i> ${iface.name}`;

                if (!iface.connectedDeviceId) {
                    div.onclick = () => {
                        document.querySelectorAll(`#${containerId} .interface-item`).forEach(el => el.classList.remove('selected'));
                        div.classList.add('selected');
                        div.dataset.value = iface.name;
                        this.checkAndConnect(sourceId, targetId);
                    };
                }
                container.appendChild(div);
            });
        };

        renderList(s, 'conn-src-list', 'src');
        renderList(t, 'conn-target-list', 'target');

        document.getElementById('connection-modal').classList.add('active');
    },

    checkAndConnect(sId, tId) {
        const sSel = document.querySelector('#conn-src-list .interface-item.selected');
        const tSel = document.querySelector('#conn-target-list .interface-item.selected');

        if (sSel && tSel) {
            const if1 = sSel.dataset.value;
            const if2 = tSel.dataset.value;
            sim.connectInterfaces(sId, if1, tId, if2);
            this.closeModals();
            this.connectStartId = null;
            this.setTool('pointer');
            this.render();
        }
    },

    render() {
        const workspace = document.getElementById('workspace');
        const connLayer = document.getElementById('connections-layer');
        // Clean up but keep input if active
        Array.from(workspace.children).forEach(el => {
            if (el.id !== 'connections-layer' && el.tagName !== 'INPUT' && !el.classList.contains('canvas-toolbar')) {
                el.remove();
            }
        });

        // Render Text Labels
        sim.textLabels.forEach((lbl, idx) => {
            // Create container for label + delete button
            const container = document.createElement('div');
            container.className = 'text-label-container';
            container.style.position = 'absolute';
            container.style.left = `${lbl.x * this.zoomLevel}px`;
            container.style.top = `${lbl.y * this.zoomLevel}px`;
            container.style.transform = `scale(${this.zoomLevel})`;
            container.style.transformOrigin = 'top left';
            container.style.display = 'inline-flex';
            container.style.alignItems = 'center';
            container.style.gap = '8px';

            // Text label element
            const el = document.createElement('div');
            el.className = 'text-label';
            el.style.color = 'var(--text-main)';
            el.style.cursor = 'move';
            el.innerText = lbl.text;

            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'text-label-delete-btn';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';

            const deleteAction = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showConfirm('¿Eliminar etiqueta?', () => {
                    sim.textLabels = sim.textLabels.filter(l => l.id !== lbl.id);
                    this.render();
                    this.showToast('Etiqueta eliminada', 'success');
                });
            };

            deleteBtn.onclick = deleteAction;
            // Touch specific for mobile to avoid drag conflict
            deleteBtn.ontouchstart = deleteAction;

            container.appendChild(el);
            container.appendChild(deleteBtn);

            // Allow drag for desktop
            container.draggable = true;
            container.ondragstart = (e) => {
                if (this.currentTool === 'pointer' || this.currentTool === 'text') {
                    e.dataTransfer.setData('moveTextId', lbl.id);
                }
            };

            // Touch support for mobile
            let touchStartX, touchStartY, labelStartX, labelStartY;
            let isTouchDragging = false;

            container.addEventListener('touchstart', (e) => {
                if (this.currentTool === 'pointer' || this.currentTool === 'text') {
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                    labelStartX = lbl.x;
                    labelStartY = lbl.y;
                    isTouchDragging = true;
                    container.style.opacity = '0.7';
                    e.preventDefault();
                }
            });

            container.addEventListener('touchmove', (e) => {
                if ((this.currentTool === 'pointer' || this.currentTool === 'text') && isTouchDragging) {
                    const touch = e.touches[0];
                    const deltaX = (touch.clientX - touchStartX) / this.zoomLevel;
                    const deltaY = (touch.clientY - touchStartY) / this.zoomLevel;

                    lbl.x = labelStartX + deltaX;
                    lbl.y = labelStartY + deltaY;

                    // Update position in real-time
                    container.style.left = `${lbl.x * this.zoomLevel}px`;
                    container.style.top = `${lbl.y * this.zoomLevel}px`;

                    e.preventDefault();
                }
            });

            container.addEventListener('touchend', (e) => {
                if ((this.currentTool === 'pointer' || this.currentTool === 'text') && isTouchDragging) {
                    container.style.opacity = '1';
                    isTouchDragging = false;
                }
            });

            workspace.appendChild(container);
        });

        // Render Devices
        sim.devices.forEach(d => {
            const el = document.createElement('div');
            el.className = `device ${this.selectedDeviceId === d.id ? 'selected' : ''}`;
            el.dataset.deviceId = d.id;
            el.style.left = `${d.x * this.zoomLevel}px`;
            el.style.top = `${d.y * this.zoomLevel}px`;
            el.style.transform = `translate(-50%, -50%) scale(${this.zoomLevel})`;
            if (this.connectStartId === d.id) el.style.opacity = '0.7';

            let ipLabel = d.ip;
            if (d.type === 'Router') {
                ipLabel = d.interfaces.filter(i => i.ip).map(i => i.ip).join(' | ');
            }

            el.innerHTML = `
                <div class="device-icon-wrapper">
                    <i class="fa-solid ${ICON_MAP[d.type]}"></i>
                </div>
                <div class="device-label">${d.name}</div>
                ${ipLabel ? `<div class="device-ip" style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${ipLabel}</div>` : ''}
            `;

            el.onclick = (e) => this.handleDeviceClick(e, d.id);
            el.draggable = true;
            el.ondragstart = (e) => {
                if (this.currentTool === 'pointer') e.dataTransfer.setData('moveId', d.id);
                else e.preventDefault();
            };

            el.ondragend = (e) => {
                if (this.currentTool === 'pointer') {
                    const rect = workspace.getBoundingClientRect();
                    d.x = (e.clientX - rect.left) / this.zoomLevel;
                    d.y = (e.clientY - rect.top) / this.zoomLevel;
                    this.render();
                }
            }

            // Touch support for mobile
            let touchStartX, touchStartY, deviceStartX, deviceStartY;
            let isTouchDragging = false;
            let hasMoved = false; // Track if valid drag occurred

            el.addEventListener('touchstart', (e) => {
                if (this.currentTool === 'pointer') {
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                    deviceStartX = d.x;
                    deviceStartY = d.y;
                    isTouchDragging = true;
                    hasMoved = false;
                    // Dont reduce opacity immediately so taps look normal
                    // el.style.opacity = '0.7'; 
                    e.preventDefault();
                }
            });

            el.addEventListener('touchmove', (e) => {
                if (this.currentTool === 'pointer' && isTouchDragging) {
                    const touch = e.touches[0];
                    const diffX = Math.abs(touch.clientX - touchStartX);
                    const diffY = Math.abs(touch.clientY - touchStartY);

                    // Threshold to consider it a drag
                    if (diffX > 5 || diffY > 5) {
                        hasMoved = true;
                        el.style.opacity = '0.7'; // Now show drag effect

                        const deltaX = (touch.clientX - touchStartX) / this.zoomLevel;
                        const deltaY = (touch.clientY - touchStartY) / this.zoomLevel;

                        d.x = deviceStartX + deltaX;
                        d.y = deviceStartY + deltaY;

                        // Update position in real-time
                        el.style.left = `${d.x * this.zoomLevel}px`;
                        el.style.top = `${d.y * this.zoomLevel}px`;
                    }
                    e.preventDefault();
                }
            });

            el.addEventListener('touchend', (e) => {
                if (this.currentTool === 'pointer' && isTouchDragging) {
                    el.style.opacity = '1';
                    isTouchDragging = false;

                    if (hasMoved) {
                        this.render(); // Re-render to update connections
                    } else {
                        // It was a tap!
                        this.handleDeviceClick(e, d.id);
                    }
                }
            });

            workspace.appendChild(el);
        });

        // Handle Text Drag End (global or attached to elm)
        // We need to attach drop handler on workspace to distinguish
        workspace.ondrop = (e) => {
            e.preventDefault();
            const rect = workspace.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const moveId = e.dataTransfer.getData('moveId');
            const moveTextId = e.dataTransfer.getData('moveTextId');

            if (moveId) {
                // Device Move (Handled by dragend usually, but for precision drop can work too)
                // Existing logic uses dragend.
            } else if (moveTextId) {
                // Text Move
                const lbl = sim.textLabels.find(l => l.id == moveTextId);
                if (lbl) {
                    lbl.x = x / this.zoomLevel;
                    lbl.y = y / this.zoomLevel;
                    this.render();
                }
            } else if (this.draggedType) {
                // New Device Drop
                this.handleDrop(e);
            }
        };


        // Render Connections
        this.renderConnections();
    },

    drawLinkLight(svg, x1, y1, x2, y2, status) {
        // Calculate position slightly offset from x1,y1 towards x2,y2
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const dist = 60; // distance from center (increased to clear labels)
        const tx = x1 + dist * Math.cos(angle);
        const ty = y1 + dist * Math.sin(angle);

        const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        // Small triangle shape
        const size = 5;
        const p1x = tx + size * Math.cos(angle);
        const p1y = ty + size * Math.sin(angle);
        const p2x = tx + size * Math.cos(angle + 2.5); // approx 120 deg
        const p2y = ty + size * Math.sin(angle + 2.5);
        const p3x = tx + size * Math.cos(angle - 2.5);
        const p3y = ty + size * Math.sin(angle - 2.5);

        triangle.setAttribute('points', `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`);

        // Color based on status
        const color = status === 'down' ? '#ef4444' : '#10b981';
        triangle.setAttribute('fill', color);

        svg.appendChild(triangle);
    },

    // ... (Keep existing Modals: openConfigModal, openPingModal, runPing, closeModals etc) ...
    // Note: I'm replacing the whole file so I should re-paste them simplified or full

    openConfigModal(id) {
        const d = sim.getDevice(id);
        if (!d) return;
        const body = document.querySelector('#config-modal .modal-body');

        let html = `
            <div class="form-group">
                <label class="form-label">Nombre</label>
                <input type="text" class="form-input" id="conf-name" value="${d.name}">
            </div>
        `;

        // Show all interfaces
        if (d.interfaces.length > 0) {
            html += `<div style="max-height: 300px; overflow-y:auto; margin-top:10px;">`;
            d.interfaces.forEach((iface, idx) => {
                html += `
                    <div class="interface-group">
                        <div class="interface-title">${iface.name} (${iface.type})</div>
                        ${iface.type === 'ethernet' || iface.type === 'serial' ? `
                            <div style="display:flex; gap:5px; margin-top:5px;">
                                <input type="text" class="form-input" id="conf-if-ip-${idx}" value="${iface.ip}" placeholder="IP">
                                <input type="text" class="form-input" id="conf-if-mask-${idx}" value="${iface.mask}" placeholder="Mask">
                            </div>
                        ` : ''}
                    </div>
                  `;
            });
            html += `</div>`;

            if (d.type !== 'Router' && d.type !== 'Switch') {
                html += `
                     <div class="form-group" style="margin-top:10px;">
                        <label class="form-label">Gateway</label>
                        <input type="text" class="form-input" id="conf-gw" value="${d.gateway}">
                     </div>
                  `;
            }

            if (d.type === 'Router') {
                html += `
                    <div style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 10px;">
                        <button class="btn" style="width:100%;" onclick="UI.showRoutingTable(${d.id})">
                            <i class="fa-solid fa-table-list"></i> Ver Tabla de Enrutamiento
                        </button>
                    </div>
                `;
            }
        }

        body.innerHTML = html;
        document.getElementById('config-modal').classList.add('active');
    },

    saveConfig() {
        if (this.selectedDeviceId) {
            const d = sim.getDevice(this.selectedDeviceId);
            d.name = document.getElementById('conf-name').value;

            // Collect new IPs to validate
            const newIPs = [];

            d.interfaces.forEach((iface, idx) => {
                const ipEl = document.getElementById(`conf-if-ip-${idx}`);
                const maskEl = document.getElementById(`conf-if-mask-${idx}`);
                if (ipEl && ipEl.value.trim()) {
                    newIPs.push(ipEl.value.trim());
                }
            });

            // Check for duplicate IPs across all devices
            for (const ip of newIPs) {
                if (!ip) continue;

                // Check against other devices
                for (const device of sim.devices) {
                    if (device.id === d.id) continue; // Skip self

                    // Check device main IP
                    if (device.ip === ip) {
                        this.showToast(`Error: La IP ${ip} ya está asignada a ${device.name}`, 'error');
                        return;
                    }

                    // Check all interfaces
                    for (const iface of device.interfaces) {
                        if (iface.ip === ip) {
                            this.showToast(`Error: La IP ${ip} ya está asignada a ${device.name} (${iface.name})`, 'error');
                            return;
                        }
                    }
                }
            }

            // If validation passed, save the configuration
            d.interfaces.forEach((iface, idx) => {
                const ipEl = document.getElementById(`conf-if-ip-${idx}`);
                const maskEl = document.getElementById(`conf-if-mask-${idx}`);
                if (ipEl) iface.ip = ipEl.value;
                if (maskEl) iface.mask = maskEl.value;
            });

            const gwEl = document.getElementById('conf-gw');
            if (gwEl) d.gateway = gwEl.value;

            // Backward compatibility for easy access
            if (d.interfaces.length > 0) {
                d.ip = d.interfaces[0].ip;
                d.mask = d.interfaces[0].mask;
            }

            this.render();
            this.closeModals();
            this.showToast('Configuración guardada correctamente', 'success');
        }
    },

    showRoutingTable(id) {
        const d = sim.getDevice(id);
        if (!d || d.type !== 'Router') return;

        const container = document.getElementById('routing-table-content');

        let html = `
            <div style="margin-bottom: 15px;">
                <strong>Router:</strong> ${d.name}
            </div>
            <table class="routing-table">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Red</th>
                        <th>Interfaz</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // 1. Directly Connected Networks
        d.interfaces.forEach(iface => {
            if (iface.ip && iface.mask && iface.status === 'up') {
                // Calculate Network Address
                const ipLong = NetworkUtils.ipToLong(iface.ip);
                const maskLong = NetworkUtils.ipToLong(iface.mask);
                const netLong = ipLong & maskLong;

                // Convert back to string (Manual implementation or helper needed? 
                // Let's do a quick inline helper or add to NetworkUtils later. 
                // For now, I'll add a helper inside this scope or just assume NetworkUtils can do it if I add it.
                // Actually, let's just do it inline to be safe and quick.)
                const netAddress = [
                    (netLong >>> 24),
                    (netLong >> 16 & 255),
                    (netLong >> 8 & 255),
                    (netLong & 255)
                ].join('.');

                // Count bits for CIDR
                let cidr = 0;
                let m = maskLong;
                while (m !== 0) {
                    if (m & 1) cidr++; // This counts trailing 1s if reversed...
                    // Standard netmask is high bits. 
                    // Actually, a simpler way for standard text masks:
                    // Just count '1's in binary string.
                    m = m >>> 1; // Unsigned right shift prevents infinite loop
                }
                // Correction: The above counts 1s anywhere. For a valid mask (1111...000), it works.
                // Alternative safer approach using split used elsewhere:
                cidr = iface.mask.split('.').reduce((acc, octet) => acc + (parseInt(octet) >>> 0).toString(2).split('1').length - 1, 0);

                html += `
                    <tr>
                        <td><span class="badge badge-success">C</span></td>
                        <td>${netAddress}/${cidr}</td>
                        <td>${iface.name}</td>
                    </tr>
                `;
            }
        });

        html += `
                </tbody>
            </table>
            <div style="margin-top:10px; font-size:0.9em; color:var(--text-muted);">
                <small>C - Conectada, S - Estática, R - RIP, O - OSPF</small>
            </div>
        `;

        container.innerHTML = html;
        this.closeModals(); // Close config modal if open
        document.getElementById('routing-modal').classList.add('active');
    },

    openPingModal(preSelectedSource = null, preSelectedTarget = null) {
        const sourceSelect = document.getElementById('ping-source');
        const targetSelect = document.getElementById('ping-target');
        sourceSelect.innerHTML = '';
        targetSelect.innerHTML = '';

        sim.devices.forEach(d => {
            // Only devices with IPs can ping/be pinged
            const label = `${d.name}`;
            const opt = `<option value="${d.id}">${label}</option>`;
            sourceSelect.innerHTML += opt;
            targetSelect.innerHTML += opt;
        });

        if (preSelectedSource) sourceSelect.value = preSelectedSource;
        if (preSelectedTarget) targetSelect.value = preSelectedTarget;

        // Add Visual Ping Button if not exists
        const body = document.querySelector('#ping-modal .modal-body');
        if (!document.getElementById('btn-visual-ping')) {
            const btnContainer = document.createElement('div');
            btnContainer.style.marginTop = '10px';
            btnContainer.innerHTML = `
                <button id="btn-visual-ping" class="btn" style="width:100%; border-color:var(--accent); color:var(--accent);" onclick="UI.runVisualPing()">
                    <i class="fa-solid fa-eye"></i> Simulación Visual (Animación)
                </button>
            `;
            // Insert before the output console
            const output = document.getElementById('ping-output');
            body.insertBefore(btnContainer, output);
        }

        document.getElementById('ping-output').innerHTML = '> Esperando comando...';
        document.getElementById('ping-modal').classList.add('active');
    },

    runVisualPing() {
        const sId = parseInt(document.getElementById('ping-source').value);
        const tId = parseInt(document.getElementById('ping-target').value);

        // 1. Check basic valid logic
        const s = sim.getDevice(sId);
        const t = sim.getDevice(tId);
        if (!s || !t) return;

        if (sId === tId) {
            this.showToast('Error: Origen y Destino son el mismo dispositivo', 'error');
            return;
        }

        this.closeModals();
        this.showToast('Iniciando rastreo de paquete...', 'info');

        // 2. Calculate Route
        const route = sim.getRoute(sId, tId);

        if (route && route.length >= 2) {
            // Let's use checkPhysicalPath logic but tracking path.
            const physicalPath = this.getPhysicalPath(sId, tId);
            if (physicalPath) {
                this.animatePacket(physicalPath, sId, tId);
            } else {
                this.showToast('Error: No hay ruta física válida para animación', 'error');
                // Fallback to ping
                setTimeout(() => {
                    UI.openPingModal(sId, tId);
                    UI.runPing();
                }, 1000);
            }

        } else {
            // Fallback for simple connections or direct failure
            const physicalPath = this.getPhysicalPath(sId, tId);
            if (physicalPath) this.animatePacket(physicalPath, sId, tId);
            else {
                this.showToast('No se pudo trazar una ruta visual.', 'error');
                setTimeout(() => {
                    UI.openPingModal(sId, tId);
                }, 1000);
            }
        }
    },

    getPhysicalPath(startId, endId) {
        // BFS for physical connections
        let queue = [[startId]];
        let visited = new Set([startId]);

        while (queue.length > 0) {
            let path = queue.shift();
            let curr = path[path.length - 1];

            if (curr === endId) return path;

            const device = sim.getDevice(curr);
            if (device) {
                for (let neighborId of device.connections) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push([...path, neighborId]);
                    }
                }
            }
        }
        return null;
    },

    animatePacket(pathIds, finalSourceId, finalTargetId) {
        const workspace = document.getElementById('workspace');
        const packet = document.createElement('div');
        packet.className = 'packet';
        packet.innerHTML = '<i class="fa-solid fa-envelope"></i>'; // Add icon

        // Start Position
        const startDevice = sim.getDevice(pathIds[0]);
        packet.style.left = `${startDevice.x * this.zoomLevel}px`;
        packet.style.top = `${startDevice.y * this.zoomLevel}px`;

        workspace.appendChild(packet);

        let step = 0;
        const totalSteps = pathIds.length;

        const moveNext = () => {
            step++;
            if (step >= totalSteps) {
                // Done
                packet.remove();
                this.showToast('Paquete entregado con éxito', 'success');
                // Trigger actual successful ping result in modal?
                // Or just show toast. User wanted "Wow effect", toast is okay.
                // Re-open ping modal to show result?
                setTimeout(() => {
                    UI.openPingModal(finalSourceId, finalTargetId);
                    // Auto-run ping to show text result
                    UI.runPing();
                }, 500);
                return;
            }

            const nextId = pathIds[step];
            const nextDevice = sim.getDevice(nextId);

            packet.style.left = `${nextDevice.x * this.zoomLevel}px`;
            packet.style.top = `${nextDevice.y * this.zoomLevel}px`;

            // Wait for transition
            // 1500ms transition + 100ms pause = 1600ms total wait per hop
            setTimeout(moveNext, 1600);
        };

        // Start animation loop
        setTimeout(moveNext, 100);
    },


    runPing() {
        const sId = parseInt(document.getElementById('ping-source').value);
        const tId = parseInt(document.getElementById('ping-target').value);
        const consoleOut = document.getElementById('ping-output');

        consoleOut.innerHTML += `\n> ping...`;
        const res = sim.testConnectivity(sId, tId);

        // Log result
        const sDevice = sim.getDevice(sId);
        const tDevice = sim.getDevice(tId);
        const logEntry = {
            time: new Date().toLocaleTimeString(),
            source: sDevice ? sDevice.name : 'Unknown',
            target: tDevice ? tDevice.name : 'Unknown',
            status: res.success ? 'Success' : 'Fail',
            msg: res.success ? 'Éxito' : res.msg
        };
        sim.logs.unshift(logEntry); // Add to beginning

        const resClass = res.success ? 'ping-success' : 'ping-fail';
        consoleOut.innerHTML += `\n<span class="${resClass}">${res.msg}</span>`;
        consoleOut.scrollTop = consoleOut.scrollHeight;
    },

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    },

    // --- User Menu Features ---
    toggleUserMenu() {
        const menu = document.getElementById('user-menu');
        menu.classList.toggle('active');

        // Close when clicking outside
        if (menu.classList.contains('active')) {
            setTimeout(() => {
                document.addEventListener('click', this.closeUserMenuOutside);
            }, 0);
        }
    },

    closeUserMenuOutside(e) {
        const menu = document.getElementById('user-menu');
        if (!menu.contains(e.target) && !e.target.closest('.btn')) {
            menu.classList.remove('active');
            document.removeEventListener('click', UI.closeUserMenuOutside);
        }
    },

    toggleTheme() {
        document.body.classList.toggle('light-mode');
        this.toggleUserMenu(); // Close menu
    },

    toggleLabels() {
        document.body.classList.toggle('hide-labels');
        this.toggleUserMenu();
    },

    clearCanvas() {
        this.showConfirm('¿Estás seguro de borrar todo el diseño? Esta acción no se puede deshacer.', () => {
            sim.devices = [];
            sim.textLabels = [];
            sim.nextId = 1;
            sim.nextTextId = 1;
            this.render();
            this.toggleUserMenu();
            this.showToast('Lienzo limpiado', 'info');
        });
    },

    // --- Project Features ---
    saveProject() {
        const data = {
            devices: sim.devices,
            textLabels: sim.textLabels,
            nextId: sim.nextId,
            nextTextId: sim.nextTextId,
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ejercicio_red.netsim';
        a.click();
        URL.revokeObjectURL(url);
        this.toggleUserMenu();
    },

    // --- Toast Notifications ---
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'fa-circle-info';
        if (type === 'success') icon = 'fa-circle-check';
        if (type === 'error') icon = 'fa-triangle-exclamation';

        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <div class="toast-content">${message}</div>
        `;

        container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 300);
        }, 3000);
    },

    // Custom Confirmation Modal
    showConfirm(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '10000';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.maxWidth = '400px';

        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-title"><i class="fa-solid fa-circle-question"></i> Confirmación</div>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn" id="confirm-cancel">Cancelar</button>
                <button class="btn btn-primary" id="confirm-ok">Aceptar</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();

        modal.querySelector('#confirm-cancel').onclick = close;
        modal.querySelector('#confirm-ok').onclick = () => {
            close();
            onConfirm();
        };
    },

    loadProject(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                sim.devices = data.devices || [];
                sim.textLabels = data.textLabels || [];
                sim.nextId = data.nextId || 1;
                sim.nextTextId = data.nextTextId || 1;

                // Restore object methods (Device class handling) if needed, 
                // but since we use raw objects mostly, we need to ensure 'Device' instance methods work.
                // Re-instantiate Devices to keep prototype methods active
                sim.devices = sim.devices.map(d => {
                    const dev = new Device(d.id, d.type, d.name, d.ip, d.mask, d.gateway, d.x, d.y);
                    dev.interfaces = d.interfaces; // Restore interfaces
                    dev.connections = d.connections || []; // Restore physical connections
                    return dev;
                });

                this.render();
                this.showToast('Ejercicio cargado correctamente', 'success');
            } catch (err) {
                this.showToast('Error al cargar el archivo de ejercicio', 'error');
                console.error(err);
            }
        };
        reader.readAsText(file);
        this.toggleUserMenu();
        event.target.value = ''; // Reset input
    },

    exportImage() {
        this.toggleUserMenu();
        const workspace = document.getElementById('workspace');
        // Temporarily hide toolbar for screenshot
        document.querySelector('.canvas-toolbar').style.display = 'none';

        // Determine background color based on theme
        const isLight = document.body.classList.contains('light-mode');
        const bgColor = isLight ? '#f1f5f9' : '#0f172a';

        html2canvas(workspace, { backgroundColor: bgColor }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'network_diagram.png';
            link.href = canvas.toDataURL();
            link.click();

            // Restore toolbar
            document.querySelector('.canvas-toolbar').style.display = 'flex';
        });
    },

    // --- Help / Logs ---
    openHelpModal() {
        document.getElementById('help-modal').classList.add('active');
        this.toggleUserMenu();
    },

    showLogs() {
        const container = document.getElementById('logs-container');
        if (sim.logs.length === 0) {
            container.innerHTML = 'No hay registros aún.';
        } else {
            container.innerHTML = sim.logs.map(l => `
                <div style="border-bottom:1px solid #333; padding:5px 0;">
                    <span style="color:var(--text-muted); font-size:0.8em;">[${l.time}]</span>
                    <strong style="color:var(--primary)">${l.source}</strong> &rarr; 
                    <strong style="color:var(--primary)">${l.target}</strong> : 
                    <span style="${l.status === 'Success' ? 'color:var(--accent)' : 'color:#ef4444'}">${l.msg}</span>
                </div>
            `).join('');
        }
        document.getElementById('logs-modal').classList.add('active');
        this.toggleUserMenu();
    },

    clearLogs() {
        sim.logs = [];
        this.showLogs();
    },

    // --- Uptime Counter ---
    startUptime() {
        const startTime = Date.now();
        setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
            const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            const display = document.getElementById('uptime-display');
            if (display) {
                display.textContent = `${hours}:${minutes}:${seconds}`;
            }
        }, 1000);
    },

    // --- Sidebar Toggle ---
    toggleSidebar() {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        const sidebar = document.querySelector('aside');
        const footer = document.querySelector('.sidebar-footer');

        if (this.sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            if (footer) footer.style.width = '0';
        } else {
            sidebar.classList.remove('collapsed');
            const sidebarWidth = window.innerWidth <= 768 ? '220px' : '250px';
            if (footer) footer.style.width = sidebarWidth;

            // Add click outside listener for mobile
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    document.addEventListener('click', this.closeSidebarOutside);
                }, 0);
            }
        }
    },

    closeSidebarOutside(e) {
        const sidebar = document.querySelector('aside');
        const toggleBtn = document.querySelector('.sidebar-toggle');

        // Ignore clicks inside sidebar or on the toggle button
        if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
            if (!sidebar.classList.contains('collapsed')) {
                UI.toggleSidebar();
                document.removeEventListener('click', UI.closeSidebarOutside);
            }
        }
    },

    // --- Zoom Controls ---
    zoomIn() {
        if (this.zoomLevel < 2) {
            this.zoomLevel += 0.1;
            this.applyZoom();
        }
    },

    zoomOut() {
        if (this.zoomLevel > 0.3) {
            this.zoomLevel -= 0.1;
            this.applyZoom();
        }
    },

    resetZoom() {
        this.zoomLevel = 1;
        this.applyZoom();
    },

    applyZoom() {
        const workspace = document.getElementById('workspace');
        workspace.style.backgroundSize = `${30 * this.zoomLevel}px ${30 * this.zoomLevel}px`;

        // Apply zoom to all devices and connections
        const devices = workspace.querySelectorAll('.device');
        devices.forEach(device => {
            const id = parseInt(device.dataset.deviceId);
            const d = sim.getDevice(id);
            if (d) {
                device.style.left = `${d.x * this.zoomLevel}px`;
                device.style.top = `${d.y * this.zoomLevel}px`;
                device.style.transform = `translate(-50%, -50%) scale(${this.zoomLevel})`;
            }
        });

        // Apply zoom to text labels
        const labels = workspace.querySelectorAll('.text-label');
        labels.forEach((label, idx) => {
            const lbl = sim.textLabels[idx];
            if (lbl) {
                label.style.left = `${lbl.x * this.zoomLevel}px`;
                label.style.top = `${lbl.y * this.zoomLevel}px`;
                label.style.transform = `scale(${this.zoomLevel})`;
                label.style.transformOrigin = 'top left';
            }
        });

        // Redraw connections with zoom
        this.renderConnections();
        this.updateZoomDisplay();
    },

    updateZoomDisplay() {
        const display = document.getElementById('zoom-level');
        if (display) {
            display.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    },

    renderConnections() {
        const connLayer = document.getElementById('connections-layer');
        connLayer.innerHTML = '';
        const drawn = new Set();

        sim.devices.forEach(d1 => {
            d1.interfaces.forEach(i1 => {
                if (i1.connectedDeviceId) {
                    const d2 = sim.getDevice(i1.connectedDeviceId);
                    const i2 = d2?.getInterface(i1.connectedInterfaceName);

                    if (!d2 || !i2) return;

                    const key = [d1.id, d2.id].sort().join('-');
                    if (drawn.has(key)) return;

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', d1.x * this.zoomLevel);
                    line.setAttribute('y1', d1.y * this.zoomLevel);
                    line.setAttribute('x2', d2.x * this.zoomLevel);
                    line.setAttribute('y2', d2.y * this.zoomLevel);

                    if (i1.type === 'serial') {
                        line.setAttribute('stroke', '#ef4444');
                        line.setAttribute('stroke-dasharray', '5,5');
                        line.setAttribute('stroke-width', '2');
                    } else {
                        line.setAttribute('stroke', '#10b981');
                        line.setAttribute('stroke-width', '2');
                    }
                    connLayer.appendChild(line);

                    const status1 = i1.status || 'up';
                    const status2 = i2.status || 'up';

                    this.drawLinkLight(connLayer, d1.x * this.zoomLevel, d1.y * this.zoomLevel,
                        d2.x * this.zoomLevel, d2.y * this.zoomLevel, status1);
                    this.drawLinkLight(connLayer, d2.x * this.zoomLevel, d2.y * this.zoomLevel,
                        d1.x * this.zoomLevel, d1.y * this.zoomLevel, status2);

                    drawn.add(key);
                }
            });
        });
    }
};

document.getElementById('workspace').addEventListener('click', (e) => UI.handleWorkspaceClick(e));

// Global Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    // Delete / Backspace to remove selected device
    if ((e.key === 'Delete' || e.key === 'Backspace') && UI.selectedDeviceId) {
        // Prevent backspace from navigating back if not in input
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            UI.deleteSelected();
        }
    }
});

UI.init();
UI.startUptime();

// Set current year in footer
document.getElementById('current-year').textContent = new Date().getFullYear();
