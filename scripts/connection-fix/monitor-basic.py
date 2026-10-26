"""Capture boot and sensor telemetry; sends ping only, never actuator commands."""
import json,time,sys
import serial
from pathlib import Path
port=serial.Serial('/dev/ttyUSB0',115200,timeout=0.2)
port.dtr=False
port.rts=True
time.sleep(0.1)
port.rts=False
started=time.monotonic();last=0;scanned=False
lines=[];telemetry=[];cards=[]
while time.monotonic()-started<float(sys.argv[1] if len(sys.argv)>1 else 20):
 now=time.monotonic()-started
 if "--scan" in sys.argv and not scanned and now>2:
  port.write(b'{"id":"basic-scan","cmd":"rfid_scan"}\n');scanned=True
 if now-last>1:
  port.write(b'{"id":"basic-monitor","cmd":"ping"}\n');last=now
 raw=port.readline()
 if not raw:continue
 line=raw.decode('utf-8',errors='replace').strip();lines.append({'seconds':round(now,2),'line':line})
 try:
  d=json.loads(line)
  if d.get('type')=='telemetry':telemetry.append(d)
  if d.get('type')=='rfid':cards.append(d)
 except ValueError:
  
  if len(lines)<25: print(line[:250],flush=True)
port.close()
out=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/basic-reference-live.json');out.write_text(json.dumps({'lines':lines,'telemetry':telemetry,'cards':cards},indent=2))
if telemetry:
 print(json.dumps({'samples':len(telemetry),'cards':cards,'raw_range':[min(x['loadcellRaw'] for x in telemetry),max(x['loadcellRaw'] for x in telemetry)],'last':telemetry[-1]},indent=2))
else:print('NO TELEMETRY')
