"""Force the two known Active LOW relays OFF without resetting the ESP."""
import serial,time,json
p=serial.Serial(port=None,baudrate=115200,timeout=0.2)
p.dtr=False;p.rts=False;p.port='/dev/ttyUSB0';p.open();time.sleep(1.5)
for pin in [15,33,15,33]:
 p.write((json.dumps({'id':f'relay-off-{pin}','cmd':'relay','pin':pin,'on':False,'activeLow':True})+'\n').encode());p.flush();time.sleep(0.15)
end=time.monotonic()+2
while time.monotonic()<end:
 line=p.readline().decode(errors='replace').strip()
 if 'relay-off-' in line:print(line)
p.close()
