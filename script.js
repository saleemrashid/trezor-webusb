document.addEventListener("DOMContentLoaded", async () => {
    const proto = await protobuf.load("trezor-common/protob/messages.proto");

    window.proto = proto;

    const write = async (device, ep, buffer) => {
        for (let i = 0; i < buffer.length; i += ep.packetSize - 1) {
            const packet = new Uint8Array(ep.packetSize);
            packet[0] = "?".charCodeAt(0);
            packet.set(buffer.slice(i, i + ep.packetSize - 1), 1);

            await device.transferOut(ep.endpointNumber, packet);
        }
    };

    class ProtocolError extends Error {}

    const packetRead = async (device, ep) => {
        const transfer = await device.transferIn(ep.endpointNumber, ep.packetSize);
        const view = transfer.data;

        if (view.getUint8(0) != "?".charCodeAt(0)) throw new ProtocolError("Invalid magic");

        return new Uint8Array(view.buffer.slice(1));
    }

    const read = async (device, ep) => {
        const packet = await packetRead(device, ep);
        const view = new DataView(packet.buffer);

        let offset = 0;

        if (view.getUint8(offset++) != "#".charCodeAt(0)) throw new ProtocolError("Invalid header");
        if (view.getUint8(offset++) != "#".charCodeAt(0)) throw new ProtocolError("Invalid header");

        const type = view.getUint16(offset);
        offset += 2;

        const length = view.getUint32(offset);
        offset += 4;

        const buffer = new Uint8Array(length);
        buffer.set(packet.slice(offset, offset + length));

        offset = packet.length - offset;

        while (offset < length) {
            const packet = await packetRead(device, ep);

            buffer.set(packet.slice(0, length - offset), offset);
            offset += packet.length;
        }

        const name = proto.lookupEnum("MessageType").valuesById[type].replace(/^MessageType_/, "");
        return proto.lookupType(name).decode(buffer.slice(0, length));
    }

    const call = async (name, data) => {
        const device = await navigator.usb.requestDevice({ filters: [] });
        await device.open();
        await device.reset();

        const interface = device.configuration.interfaces[0];
        await device.claimInterface(interface.interfaceNumber);

        const alternate = interface.alternate;

        const epIn = alternate.endpoints.filter((ep) => ep.direction == "in")[0];
        const epOut = alternate.endpoints.filter((ep) => ep.direction == "out")[0];

        const type = proto.MessageType[`MessageType_${name}`];
        const message = proto.lookupType(name).encode(data).finish();

        const buffer = new Uint8Array(8 + message.length);
        const view = new DataView(buffer.buffer);

        let offset = 0;
        view.setUint8(offset++, "#".charCodeAt(0));
        view.setUint8(offset++, "#".charCodeAt(0));

        view.setUint16(offset, type);
        offset += 2;

        view.setUint32(offset, message.length);
        offset += 4;

        buffer.set(message, offset);

        await write(device, epOut, buffer);
        return await read(device, epIn);
    }

    for (let name of ["Initialize", "GetAddress"]) {
        const button = document.createElement("button");
        button.textContent = name;

        button.addEventListener("click", async () => {
            const response = await call(name, {});

            console.log(response);
            alert(JSON.stringify(response));
        });

        document.body.appendChild(button);
    };
});
