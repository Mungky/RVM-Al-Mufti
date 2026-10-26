"""Run the rebuilt firmware's actual motor, relay and IR code without hardware."""
from pathlib import Path
import subprocess
import tempfile
import re
root=Path(__file__).resolve().parents[2]
source=(root/'firmware/arduino/rvm_diag/rvm_diag.ino').read_text()
logic=source[source.index('void initializeOutput('):source.index('void initializeRFID()')]
pins='\n'.join(re.findall(r'constexpr uint8_t [^;]+;',source))
harness=r'''
#include <cstdint>
#include <climits>
#include <cassert>
constexpr int HIGH=1,LOW=0,OUTPUT=1;
using gpio_num_t=int;
'''+pins+r'''
int levels[40]={},initialOutputLevels[40]={}; bool configured[40]={}; uint32_t clockUs=0; int pulses=0;
void gpio_set_level(int pin,int level) {levels[pin]=level;}
void pinMode(int pin,int) {initialOutputLevels[pin]=levels[pin];configured[pin]=true;}
void digitalWrite(int pin,int level) { if(!configured[pin])return; if(pin==STEP_PIN&&level==HIGH) pulses++; levels[pin]=level; }
int digitalRead(int pin) { return levels[pin]; }
uint32_t micros() { return clockUs; }
void delayMicroseconds(uint32_t us) {clockUs+=us;}
bool relayOn[2]={},motorEnabled=false,motorRunning=false,motorContinuous=false;
int8_t motorDirection=1;
int32_t motorPosition=0,motorTarget=0;
uint32_t motorPeriod=2000,lastStep=0;
bool ir[3]={},irRaw[3]={},irPolarity[3]={true,true,true};
'''+logic+r'''
int main() {
  // Reproduce core 3.x: Arduino writes before pinMode are ignored.
  digitalWrite(15,HIGH);assert(levels[15]==LOW);
  for(uint8_t pin:RELAY_PINS)initializeOutput(pin,HIGH);
  initializeOutput(STEP_PIN,LOW);initializeOutput(DIR_PIN,LOW);initializeOutput(ENA_PIN,HIGH);
  assert(initialOutputLevels[15]==HIGH&&initialOutputLevels[33]==HIGH&&levels[ENA_PIN]==HIGH);
  setRelay(0,false);setRelay(1,false);
  assert(levels[15]==HIGH&&levels[33]==HIGH);
  setRelay(0,true);assert(levels[15]==LOW&&levels[33]==HIGH&&relayOn[0]);
  setRelay(0,false);setRelay(1,true);assert(levels[15]==HIGH&&levels[33]==LOW);
  levels[14]=HIGH;levels[26]=LOW;levels[27]=HIGH;pollIR();
  assert(!ir[0]&&ir[1]&&!ir[2]);assert(irRaw[0]&&!irRaw[1]&&irRaw[2]);
  stopMotor();assert(!motorMoving()&&levels[STEP_PIN]==LOW&&levels[ENA_PIN]==HIGH);
  startMotor(1,500,true,0);assert(!motorMoving()&&levels[ENA_PIN]==HIGH);
  setMotorEnabled(true);assert(motorEnabled&&levels[ENA_PIN]==LOW);
  startMotor(1,500,true,0);assert(motorPeriod==2000&&levels[DIR_PIN]==HIGH&&levels[ENA_PIN]==LOW);
  for(int i=0;i<10;i++){clockUs=lastStep+motorPeriod;pollMotor();}
  assert(motorPosition==10&&pulses==10&&levels[STEP_PIN]==LOW);
  setMotorEnabled(false);assert(!motorEnabled&&!motorMoving()&&levels[ENA_PIN]==HIGH);
  clockUs+=50000;pollMotor();assert(pulses==10);
  startMotor(-1,500,true,10);assert(!motorMoving());
  setMotorEnabled(true);
  stopMotor();clockUs+=50000;pollMotor();assert(motorPosition==10&&pulses==10);
  startMotor(-1,500,true,10);
  for(int i=0;i<15;i++){clockUs=lastStep+motorPeriod;pollMotor();}
  assert(motorPosition==-5&&levels[DIR_PIN]==LOW);
  startMotor(1,500,false,0);
  for(int i=0;i<10;i++){clockUs=lastStep+motorPeriod;pollMotor();}
  assert(motorPosition==0&&!motorMoving()&&levels[ENA_PIN]==HIGH);
  startMotor(1,500,false,0);assert(!motorMoving());
  motorPosition=INT32_MAX;startMotor(1,500,true,0);clockUs=lastStep+motorPeriod;pollMotor();
  assert(motorPosition==INT32_MAX&&!motorMoving());
  motorPosition=INT32_MIN;startMotor(-1,500,true,0);clockUs=lastStep+motorPeriod;pollMotor();
  assert(motorPosition==INT32_MIN&&!motorMoving());
  motorPosition=0;clockUs=UINT32_MAX-100;startMotor(1,500,true,0);
  clockUs=lastStep+motorPeriod;pollMotor();assert(motorPosition==1);
}
'''
with tempfile.TemporaryDirectory(prefix='rvm-basic-check-') as folder:
    cpp=Path(folder)/'check.cpp';binary=Path(folder)/'check';cpp.write_text(harness)
    subprocess.run(['g++','-std=c++11','-fsanitize=undefined','-o',str(binary),str(cpp)],check=True)
    subprocess.run([str(binary)],check=True)
print('Actual firmware: relay 1=15/2=33, Active LOW IR, forward/reverse/stop, target, signed limits and micros rollover passed.')
