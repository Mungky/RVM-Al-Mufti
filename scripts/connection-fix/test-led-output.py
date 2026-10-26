"""Send only power, static RGB and brightness to the user's LEDDMX-01.
No pixel configuration, pairing, reset, persistent chip settings or effects.
"""
import sys,time,dbus,json
address='25:07:27:00:00:1F'
bus=dbus.SystemBus()
manager=dbus.Interface(bus.get_object('org.bluez','/'),'org.freedesktop.DBus.ObjectManager')
objects=manager.GetManagedObjects()
path=next((p for p,v in objects.items() if str(v.get('org.bluez.Device1',{}).get('Address',''))==address),None)
if path is None:
 adapter_path=next(p for p,v in objects.items() if v.get('org.bluez.Adapter1',{}).get('Powered'))
 adapter=dbus.Interface(bus.get_object('org.bluez',adapter_path),'org.bluez.Adapter1')
 adapter.StartDiscovery()
 try:
  for _ in range(40):
   objects=manager.GetManagedObjects()
   path=next((p for p,v in objects.items() if str(v.get('org.bluez.Device1',{}).get('Address',''))==address),None)
   if path:break
   time.sleep(.25)
 finally:adapter.StopDiscovery()
 if path is None:raise SystemExit('Controller not found')
device=dbus.Interface(bus.get_object('org.bluez',path),'org.bluez.Device1')
if objects[path]['org.bluez.Device1'].get('Connected'):raise SystemExit('Controller still connected; disconnect app first')
try:
 device.Connect(timeout=15)
 for _ in range(40):
  objects=manager.GetManagedObjects()
  if objects[path]['org.bluez.Device1'].get('ServicesResolved'):break
  time.sleep(.25)
 charpath=next(p for p,v in objects.items() if str(p).startswith(str(path)+'/') and str(v.get('org.bluez.GattCharacteristic1',{}).get('UUID',''))=='0000ffe1-0000-1000-8000-00805f9b34fb')
 char=dbus.Interface(bus.get_object('org.bluez',charpath),'org.bluez.GattCharacteristic1')
 def send(frame):
  char.WriteValue(dbus.Array(frame,signature='y'),dbus.Dictionary({'type':'command'},signature='sv'),timeout=5)
  print(bytes(frame).hex(' '),flush=True);time.sleep(.15)
 send([0x7b,0xff,4,3,0xff,0xff,0xff,0xff,0xbf])
 send([0x7b,0xff,1,9,30,0,0xff,0xff,0xbf])
 for label,rgb in [('RED',[255,0,0]),('GREEN',[0,255,0])]:
  for _ in range(3):send([0x7b,0xff,7,*rgb,0,0xff,0xbf])
  print(label+' at 30 percent requested',flush=True);time.sleep(3)
finally:
 device.Disconnect(timeout=5)
 print('Connection closed; final requested color GREEN at 30 percent.',flush=True)
