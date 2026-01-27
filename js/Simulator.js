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

        if (!source.ip) return { success: false, msg: "Error: Configuración IP faltante en Origen" };
        if (target.type !== 'Router' && !target.ip) return { success: false, msg: "Error: Configuración IP faltante en Destino" };

        let result = { success: false, msg: "Destination Host Unreachable" };

        if (target.type === 'Router') {
            // Check if source and router are in same subnet (direct connection)
            const directlyConnectedInterface = target.interfaces.find(iface =>
                NetworkUtils.isSameSubnet(source.ip, iface.ip, source.mask)
            );

            if (directlyConnectedInterface) {
                result = { success: true, msg: `Reply from ${directlyConnectedInterface.ip}: bytes=32 time=2ms TTL=255` };
            } else if (source.gateway) {
                // Validate gateway is in same subnet as source
                if (!NetworkUtils.isSameSubnet(source.ip, source.gateway, source.mask)) {
                    return { success: false, msg: "Error: Gateway no está en la misma subred que el dispositivo origen" };
                }

                // Check if target router has the gateway IP
                const isGateway = target.interfaces.some(i => i.ip === source.gateway);
                if (isGateway) {
                    result = { success: true, msg: `Reply from ${source.gateway}: bytes=32 time=2ms TTL=255` };
                } else {
                    // Check if gateway exists and can route to target
                    const gatewayRouter = this.devices.find(d => d.type === 'Router' && d.interfaces.some(i => i.ip === source.gateway));
                    if (gatewayRouter && gatewayRouter.id === target.id) {
                        result = { success: true, msg: `Reply from Router: bytes=32 time=3ms TTL=255` };
                    } else {
                        result = { success: false, msg: "Destination Network Unreachable" };
                    }
                }
            } else {
                result = { success: false, msg: "Destination Host Unreachable (No Gateway configurado)" };
            }
        } else {
            // Target is PC/Laptop/Server
            const sameSubnet = NetworkUtils.isSameSubnet(source.ip, target.ip, source.mask);
            if (sameSubnet) {
                result = { success: true, msg: `Reply from ${target.ip}: bytes=32 time=1ms TTL=64` };
            } else if (source.gateway) {
                // Validate gateway is in same subnet as source
                if (!NetworkUtils.isSameSubnet(source.ip, source.gateway, source.mask)) {
                    return { success: false, msg: "Error: Gateway no está en la misma subred que el dispositivo origen" };
                }

                const router = this.devices.find(d => d.type === 'Router' && d.interfaces.some(i => i.ip === source.gateway));
                if (router) {
                    const targetSubnetIface = router.interfaces.find(i => NetworkUtils.isSameSubnet(i.ip, target.ip, i.mask));
                    if (targetSubnetIface) {
                        result = { success: true, msg: `Reply from ${target.ip}: bytes=32 time=15ms TTL=54` };
                    } else {
                        result = { success: false, msg: "Destination Network Unreachable" };
                    }
                } else {
                    result = { success: false, msg: "Request timed out (Gateway unreachable)" };
                }
            } else {
                result = { success: false, msg: "Destination Host Unreachable (No Gateway configurado)" };
            }
        }

        // Append Explicit Success Message
        if (result.success) {
            result.msg += "\n\nPing statistics for " + (target.type === 'Router' ? 'Router' : target.ip) + ":\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)";
        }

        return result;
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
}

// UI Controller
const sim = new NetworkSimulator();

const UI = {
    draggedType: null,
    selectedDeviceId: null,
    currentTool: 'pointer', // 'pointer' | 'connect' | 'text'
    connectStartId: null,
    draggedTextId: null, // For moving text

    init() {
        this.render();
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

        // Render Labels
        sim.textLabels.forEach(lbl => {
            const el = document.createElement('div');
            el.className = 'text-label';
            el.style.position = 'absolute';
            el.style.left = `${lbl.x}px`;
            el.style.top = `${lbl.y}px`;
            el.style.color = 'var(--text-main)';
            el.style.cursor = 'move';
            el.innerText = lbl.text;

            // Allow drag/delete text
            el.draggable = true;
            el.ondragstart = (e) => {
                if (this.currentTool === 'pointer' || this.currentTool === 'text') {
                    e.dataTransfer.setData('moveTextId', lbl.id);
                }
            };
            el.ondblclick = (e) => {
                this.showConfirm('¿Eliminar etiqueta?', () => {
                    sim.textLabels = sim.textLabels.filter(l => l.id !== lbl.id);
                    this.render();
                    this.showToast('Etiqueta eliminada', 'success');
                });
            };

            workspace.appendChild(el);
        });

        // Render Devices
        sim.devices.forEach(d => {
            const el = document.createElement('div');
            el.className = `device ${this.selectedDeviceId === d.id ? 'selected' : ''}`;
            el.style.left = `${d.x}px`;
            el.style.top = `${d.y}px`;
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
                // Important: Stop propagation so we don't drag text if overlapping? 
                // Actually standard drag event handles target.
                if (this.currentTool === 'pointer') e.dataTransfer.setData('moveId', d.id);
                else e.preventDefault();
            };

            // Handle Drop for both devices and text
            // Drop listener is on Workspace, but we need dragend here to update coords
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
                    lbl.x = x;
                    lbl.y = y;
                    this.render();
                }
            } else if (this.draggedType) {
                // New Device Drop
                this.handleDrop(e);
            }
        };


        // Render Connections
        connLayer.innerHTML = '';
        const drawn = new Set();

        sim.devices.forEach(d1 => {
            d1.interfaces.forEach(i1 => {
                if (i1.connectedDeviceId) {
                    const d2 = sim.getDevice(i1.connectedDeviceId);
                    const i2 = d2.getInterface(i1.connectedInterfaceName);

                    if (!d2 || !i2) return;

                    const key = [d1.id, d2.id].sort().join('-');
                    if (drawn.has(key)) return;

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', d1.x); line.setAttribute('y1', d1.y);
                    line.setAttribute('x2', d2.x); line.setAttribute('y2', d2.y);

                    if (i1.type === 'serial') {
                        line.setAttribute('stroke', '#ef4444');
                        line.setAttribute('stroke-dasharray', '5,5');
                        line.setAttribute('stroke-width', '2');
                    } else {
                        line.setAttribute('stroke', '#10b981'); // Cable itself is green/black physics
                        line.setAttribute('stroke-width', '2');
                    }
                    connLayer.appendChild(line);

                    // Link Lights Status - Check Interface Status using internal property
                    const status1 = i1.status || 'up'; // Default 'up' for old devs
                    const status2 = i2.status || 'up';

                    this.drawLinkLight(connLayer, d1.x, d1.y, d2.x, d2.y, status1);
                    this.drawLinkLight(connLayer, d2.x, d2.y, d1.x, d1.y, status2);

                    drawn.add(key);
                }
            });
        });
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

    openPingModal() {
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

        document.getElementById('ping-output').innerHTML = '> Esperando comando...';
        document.getElementById('ping-modal').classList.add('active');
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
