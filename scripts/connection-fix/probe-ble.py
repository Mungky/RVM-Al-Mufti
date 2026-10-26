"""Discover GATT services on a specified cached device; never write LED commands."""
import json
import re
import sys
import time
import dbus

address = sys.argv[1].upper()
if not re.fullmatch(r'(?:[0-9A-F]{2}:){5}[0-9A-F]{2}', address):
    raise SystemExit('Invalid Bluetooth address')
bus = dbus.SystemBus()
manager = dbus.Interface(bus.get_object('org.bluez', '/'), 'org.freedesktop.DBus.ObjectManager')
objects = manager.GetManagedObjects()
def find_device(objects):
    return next((p for p, v in objects.items() if str(v.get('org.bluez.Device1', {}).get('Address', '')).upper() == address), None)

device_path = find_device(objects)
if not device_path:
    adapter_path = next((p for p, v in objects.items() if v.get('org.bluez.Adapter1', {}).get('Powered')), None)
    if adapter_path:
        adapter = dbus.Interface(bus.get_object('org.bluez', adapter_path), 'org.bluez.Adapter1')
        adapter.StartDiscovery()
        try:
            for _ in range(24):
                time.sleep(0.25)
                objects = manager.GetManagedObjects()
                device_path = find_device(objects)
                if device_path:
                    break
        finally:
            adapter.StopDiscovery()
if not device_path:
    print(json.dumps({'nearby': [{'name': str(v['org.bluez.Device1'].get('Name', '')), 'address': str(v['org.bluez.Device1'].get('Address', ''))} for v in objects.values() if 'org.bluez.Device1' in v]}))
    raise SystemExit('Target device not found during discovery')
properties = objects[device_path]['org.bluez.Device1']
was_connected = bool(properties.get('Connected', False))
print(json.dumps({'name': str(properties.get('Name', '')), 'address': address, 'initiallyConnected': was_connected}), flush=True)
device = dbus.Interface(bus.get_object('org.bluez', device_path), 'org.bluez.Device1')
opened_here = False
try:
    if not was_connected:
        device.Connect(timeout=15)
        opened_here = True
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        objects = manager.GetManagedObjects()
        if objects.get(device_path, {}).get('org.bluez.Device1', {}).get('ServicesResolved'):
            break
        time.sleep(0.25)
    result = {'connected': bool(objects[device_path]['org.bluez.Device1'].get('Connected')), 'servicesResolved': bool(objects[device_path]['org.bluez.Device1'].get('ServicesResolved')), 'services': [], 'characteristics': []}
    for object_path, interfaces in objects.items():
        if not str(object_path).startswith(str(device_path) + '/'):
            continue
        service = interfaces.get('org.bluez.GattService1')
        characteristic = interfaces.get('org.bluez.GattCharacteristic1')
        if service:
            result['services'].append({'path': str(object_path), 'uuid': str(service['UUID'])})
        if characteristic:
            result['characteristics'].append({'path': str(object_path), 'uuid': str(characteristic['UUID']), 'service': str(characteristic['Service']), 'flags': [str(flag) for flag in characteristic['Flags']]})
    print(json.dumps(result, indent=2), flush=True)
finally:
    if opened_here:
        device.Disconnect(timeout=5)
        print('Diagnostic connection closed; no LED commands sent.', flush=True)
