#include <Arduino.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <HX711.h>
#include <Preferences.h>
#include <driver/gpio.h>
#include <cmath>

// Built from the working sketches in Desktop/Basic Program.
// ESP32 core 3.3.11; HX711 by Rob Tillaart 0.6.5; MFRC522 1.4.12.
const char *FIRMWARE = "almufti-diag-2.0.2";
constexpr uint8_t IR_PINS[] = {14, 26, 27};
constexpr uint8_t RELAY_PINS[] = {15, 33}; // Physical relay 1, then relay 2.
constexpr uint8_t STEP_PIN = 2, DIR_PIN = 4, ENA_PIN = 25;
constexpr uint8_t HX_DATA = 34, HX_CLOCK = 32, RFID_SS = 16, RFID_RST = 17;
constexpr uint32_t LEASE_MS = 3000;
MFRC522 rfid(RFID_SS, RFID_RST);
HX711 scale;
Preferences preferences;

bool ir[3] = {}, irRaw[3] = {}, irPolarity[3] = {true,true,true};
bool relayOn[2] = {}, motorEnabled = false, motorRunning = false, motorContinuous = false;
int8_t motorDirection = 1;
int32_t motorPosition = 0, motorTarget = 0;
uint32_t motorPeriod = 2000, lastStep = 0;
bool loadcellReady = false, loadcellSaturated = false, loadcellStable = false;
long loadcellRaw = 0, loadcellOffset = 0, loadcellSpread = 0;
float loadcellFactor = 0;
long scaleWindow[10] = {};
uint8_t scaleCount = 0, scaleIndex = 0;
uint32_t loadcellSamples = 0, lastSample = 0, lastScalePoll = 0;
bool rfidReady = false, rfidCardPresent = false, rfidAntennaOn = false;
byte rfidVersion = 0, rfidStatus = MFRC522::STATUS_TIMEOUT;
uint32_t totalScan = 0, lastHealth = 0, lastCardSeen = 0, lastRFIDPoll = 0;
String lastUID, serialBuffer;
bool serialOverflow = false, manualControl = false;
uint32_t lastController = 0, lastTelemetry = 0;
struct ScaleJob {
  String id;
  bool calibrate = false;
  float grams = 0;
  int64_t total = 0;
  long minimum = 0, maximum = 0;
  uint8_t count = 0;
  uint32_t started = 0;
} scaleJob;

void send(JsonDocument &doc) { serializeJson(doc, Serial); Serial.println(); }
void ack(const String &id, bool ok, const char *message) {
  StaticJsonDocument<384> doc;
  doc["type"]="ack"; doc["id"]=id; doc["ok"]=ok; doc["message"]=message;
  doc["firmware"]=FIRMWARE; doc["protocol"]=1; doc["diagnostic"]=true;
  send(doc);
}
// Core 3.x digitalWrite() ignores pins until pinMode() registers GPIO ownership.
void initializeOutput(uint8_t pin, uint8_t level) {
  gpio_set_level((gpio_num_t)pin,level); // Preload output latch without the Arduino guard.
  pinMode(pin,OUTPUT);
  digitalWrite(pin,level);
}
void setRelay(uint8_t index, bool on) {
  relayOn[index]=on;
  digitalWrite(RELAY_PINS[index],on?LOW:HIGH);
}
bool motorMoving() { return motorRunning; }
void stopMotor() {
  motorRunning=false; motorContinuous=false; motorTarget=motorPosition;
  digitalWrite(STEP_PIN,LOW); digitalWrite(ENA_PIN,HIGH);
}
void setMotorEnabled(bool enabled) {
  stopMotor(); motorEnabled=enabled;
  digitalWrite(ENA_PIN,enabled?LOW:HIGH);
}
void startMotor(int8_t direction, uint32_t speed, bool continuous, int32_t target) {
  if(!motorEnabled) return;
  stopMotor();
  motorDirection=direction; motorPeriod=1000000UL/speed;
  motorContinuous=continuous; motorTarget=target;
  digitalWrite(DIR_PIN,direction>0?HIGH:LOW);
  digitalWrite(ENA_PIN,LOW); delayMicroseconds(20);
  lastStep=micros(); motorRunning=continuous || target!=motorPosition;
  if(!motorRunning) stopMotor();
}
void pollMotor() {
  const uint32_t now=micros();
  if(!motorRunning || now-lastStep<motorPeriod) return;
  lastStep=now;
  if((motorDirection>0 && motorPosition==INT32_MAX) ||
     (motorDirection<0 && motorPosition==INT32_MIN)) { stopMotor(); return; }
  digitalWrite(STEP_PIN,HIGH); delayMicroseconds(10); digitalWrite(STEP_PIN,LOW);
  motorPosition+=motorDirection;
  if(!motorContinuous && motorPosition==motorTarget) stopMotor();
}
void pollIR() {
  for(uint8_t i=0;i<3;i++) {
    irRaw[i]=digitalRead(IR_PINS[i])==HIGH;
    ir[i]=irPolarity[i]?!irRaw[i]:irRaw[i];
  }
}
void initializeRFID() {
  digitalWrite(RFID_RST,LOW); delay(10);
  digitalWrite(RFID_RST,HIGH); delay(50);
  rfid.PCD_Init(); delay(100); rfid.PCD_AntennaOn();
  rfidVersion=rfid.PCD_ReadRegister(MFRC522::VersionReg);
  rfidReady=rfidVersion==0x82 || rfidVersion==0x88 || rfidVersion==0x90 ||
            rfidVersion==0x91 || rfidVersion==0x92 || rfidVersion==0x12;
  rfidAntennaOn=(rfid.PCD_ReadRegister(MFRC522::TxControlReg)&3)==3;
  rfidStatus=MFRC522::STATUS_TIMEOUT; lastUID=""; rfidCardPresent=false;
}
void pollRFID() {
  const uint32_t now=millis();
  if(rfidCardPresent && now-lastCardSeen>800) rfidCardPresent=false;
  if(now-lastHealth>=1000) {
    lastHealth=now;
    rfidVersion=rfid.PCD_ReadRegister(MFRC522::VersionReg);
    rfidReady=rfidVersion==0x82 || rfidVersion==0x88 || rfidVersion==0x90 ||
              rfidVersion==0x91 || rfidVersion==0x92 || rfidVersion==0x12;
    rfidAntennaOn=(rfid.PCD_ReadRegister(MFRC522::TxControlReg)&3)==3;
  }
  if(now-lastRFIDPoll<50 || now-lastCardSeen<300) return;
  lastRFIDPoll=now;
  if(!rfidReady || !rfid.PICC_IsNewCardPresent()) return;
  if(!rfid.PICC_ReadCardSerial()) { rfidStatus=MFRC522::STATUS_ERROR; return; }
  String uid;
  for(byte i=0;i<rfid.uid.size;i++) {
    if(rfid.uid.uidByte[i]<0x10) uid+="0";
    uid+=String(rfid.uid.uidByte[i],HEX);
  }
  uid.toUpperCase(); lastUID=uid; totalScan++; lastCardSeen=millis();
  rfidCardPresent=true; rfidStatus=MFRC522::STATUS_OK;
  StaticJsonDocument<128> doc; doc["type"]="rfid"; doc["uid"]=uid; send(doc);
  rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
}
void pollLoadcell() {
  const uint32_t now=millis();
  if(!loadcellSamples || now-lastSample>1500) loadcellReady=false;
  if(scaleJob.id.length() && now-scaleJob.started>9000) {
    ack(scaleJob.id,false,"HX711 timeout; pengaturan lama dipertahankan."); scaleJob.id="";
  }
  if(now-lastScalePoll<(scaleJob.id.length()?100:500)) return;
  lastScalePoll=now;
  // Same read() as the basic sketch; never wait for a missing sensor in loop().
  if(!scale.is_ready()) return;
  loadcellRaw=(long)scale.read(); lastSample=millis(); loadcellSamples++;
  loadcellReady=true; loadcellSaturated=loadcellRaw<=-8388608 || loadcellRaw>=8388607;
  scaleWindow[scaleIndex]=loadcellRaw; scaleIndex=(scaleIndex+1)%10;
  if(scaleCount<10) scaleCount++;
  long minimum=scaleWindow[0], maximum=minimum;
  for(uint8_t i=1;i<scaleCount;i++) {
    minimum=std::min(minimum,scaleWindow[i]); maximum=std::max(maximum,scaleWindow[i]);
  }
  loadcellSpread=maximum-minimum;
  loadcellStable=scaleCount==10 && !loadcellSaturated &&
    loadcellSpread<=std::max(2000.0f,fabsf(loadcellFactor)*2.0f);
  if(!scaleJob.id.length()) return;
  if(loadcellSaturated) {
    ack(scaleJob.id,false,"ADC HX711 saturasi. Pengaturan lama dipertahankan."); scaleJob.id=""; return;
  }
  if(scaleJob.count==0) scaleJob.minimum=scaleJob.maximum=loadcellRaw;
  scaleJob.minimum=std::min(scaleJob.minimum,loadcellRaw);
  scaleJob.maximum=std::max(scaleJob.maximum,loadcellRaw);
  scaleJob.total+=loadcellRaw;
  if(++scaleJob.count<10) return;
  const long average=scaleJob.total/10;
  const float delta=(float)average-loadcellOffset;
  const long spread=scaleJob.maximum-scaleJob.minimum;
  if(spread>50000 || (scaleJob.calibrate && fabsf(delta)<std::max(100.0f,spread*3.0f))) {
    ack(scaleJob.id,false,"Sampel terlalu berubah / beban belum berbeda dari zero."); scaleJob.id=""; return;
  }
  if(scaleJob.calibrate) {
    const float factor=delta/scaleJob.grams;
    if(!std::isfinite(factor) || fabsf(factor)<0.01f) {
      ack(scaleJob.id,false,"Faktor kalibrasi tidak valid."); scaleJob.id=""; return;
    }
    loadcellFactor=factor; preferences.putFloat("factor",factor);
  } else { loadcellOffset=average; preferences.putLong("offset",average); }
  ack(scaleJob.id,true,"Pengaturan timbangan disimpan dari rata-rata 10 sampel."); scaleJob.id="";
}
void telemetry() {
  StaticJsonDocument<2048> doc;
  doc["type"]="telemetry";
  JsonArray inputs=doc.createNestedArray("ir"); for(bool value:ir) inputs.add(value);
  JsonArray raw=doc.createNestedArray("irRaw"); for(bool value:irRaw) raw.add(value);
  JsonArray polarity=doc.createNestedArray("irPolarity"); for(bool value:irPolarity) polarity.add(value);
  doc["irActiveLow"]=true; doc["caps"]=0;
  doc["grams"]=loadcellReady && loadcellFactor!=0?(loadcellRaw-loadcellOffset)/loadcellFactor:0;
  doc["motorEnabled"]=motorEnabled; doc["position"]=motorPosition; doc["motorMoving"]=motorMoving();
  doc["motorContinuous"]=motorContinuous?(int)motorDirection:0;
  JsonArray relays=doc.createNestedArray("relayOn");
  JsonArray relayLevels=doc.createNestedArray("relayRaw");
  for(uint8_t pin:RELAY_PINS) { const bool high=digitalRead(pin)==HIGH; relays.add(!high); relayLevels.add(high); }
  doc["loadcellReady"]=loadcellReady && !motorMoving();
  doc["scaleBusy"]=scaleJob.id.length()>0;
  if(!motorMoving()) {
    doc["loadcellRaw"]=loadcellRaw; doc["loadcellFiltered"]=loadcellRaw;
    doc["loadcellOffset"]=loadcellOffset; doc["loadcellFactor"]=loadcellFactor;
    doc["loadcellDelta"]=loadcellRaw-loadcellOffset;
    doc["loadcellCalibrated"]=loadcellFactor!=0;
    doc["loadcellSaturated"]=loadcellSaturated; doc["loadcellStable"]=loadcellStable;
    doc["loadcellSpread"]=loadcellSpread;
    doc["loadcellSpreadGrams"]=loadcellFactor!=0?loadcellSpread/fabsf(loadcellFactor):0;
    doc["loadcellSamples"]=loadcellSamples;
    doc["loadcellAgeMs"]=loadcellSamples?millis()-lastSample:-1;
    doc["loadcellDout"]=digitalRead(HX_DATA)==HIGH;
    doc["rfidReady"]=rfidReady; doc["rfidVersion"]=rfidVersion;
    doc["rfidUid"]=lastUID; doc["rfidCardPresent"]=rfidCardPresent;
    doc["rfidStatus"]=rfidStatus; doc["rfidAntennaOn"]=rfidAntennaOn;
    doc["rfidSpiHz"]=MFRC522_SPICLOCK; doc["rfidTotalScan"]=totalScan;
  }
  doc["diagnostic"]=true; doc["firmware"]=FIRMWARE; send(doc);
}
void handleCommand(const String &line) {
  StaticJsonDocument<1024> doc;
  if(deserializeJson(doc,line)) return;
  const String id=doc["id"] | "", cmd=doc["cmd"] | "";
  if(id.length()==0 || id.length()>64) return;
  manualControl=false; lastController=millis();
  if(cmd=="ping") { ack(id,true,"Basic component test ready"); return; }
  if(cmd=="motor_enable") {
    if(!doc["on"].is<bool>()) { ack(id,false,"on harus boolean."); return; }
    setMotorEnabled(doc["on"]); ack(id,true,motorEnabled?"Stepper enabled":"Stepper disabled"); return;
  }
  if(cmd=="motor_stop") { stopMotor(); ack(id,true,"Motor stopped"); return; }
  if(cmd=="relay") {
    if(!doc["pin"].is<int>() || !doc["on"].is<bool>() ||
       (doc.containsKey("activeLow") && (!doc["activeLow"].is<bool>() || !doc["activeLow"].as<bool>()))) {
      ack(id,false,"Relay menggunakan Active LOW."); return;
    }
    const int pin=doc["pin"], index=pin==15?0:pin==33?1:-1;
    if(index<0) { ack(id,false,"Pin relay harus 15 atau 33."); return; }
    setRelay(index,doc["on"]); ack(id,true,"Relay applied"); return;
  }
  if(cmd=="motor_run" || cmd=="motor_move") {
    if(!motorEnabled) { ack(id,false,"Nyalakan toggle stepper sebelum menguji conveyor."); return; }
    if(!doc["speed"].is<int>()) { ack(id,false,"Speed harus 100-3200 pulsa/detik."); return; }
    const int speed=doc["speed"];
    if(speed<100 || speed>3200 || scaleJob.id.length()) { ack(id,false,"Speed tidak valid / tunggu timbangan."); return; }
    if(cmd=="motor_run") {
      if(!doc["direction"].is<int>() || (doc["direction"]!=1 && doc["direction"]!=-1)) {
        ack(id,false,"Arah harus 1 atau -1."); return;
      }
      startMotor(doc["direction"],speed,true,motorPosition);
    } else {
      if(!doc["target"].is<int32_t>()) { ack(id,false,"Target posisi tidak valid."); return; }
      const int32_t target=doc["target"];
      startMotor(target>=motorPosition?1:-1,speed,false,target);
    }
    ack(id,true,"Motor started"); return;
  }
  if(cmd=="ir_config") {
    if(!doc["activeLow"].is<bool>()) { ack(id,false,"activeLow harus boolean."); return; }
    if(doc.containsKey("sensor")) {
      if(!doc["sensor"].is<int>() || doc["sensor"].as<int>()<0 || doc["sensor"].as<int>()>2) {
        ack(id,false,"Sensor harus 0-2."); return;
      }
      irPolarity[doc["sensor"].as<int>()]=doc["activeLow"];
    } else for(bool &value:irPolarity) value=doc["activeLow"];
    ack(id,true,"Infrared polarity applied"); return;
  }
  if(cmd=="rfid_reset" || cmd=="rfid_scan") {
    if(motorMoving() || scaleJob.id.length()) { ack(id,false,"Stop motor / tunggu timbangan."); return; }
    initializeRFID(); ack(id,true,"Reader initialized; tempelkan kartu."); return;
  }
  if(cmd=="tare" || cmd=="calibrate") {
    const float grams=doc["grams"] | 0.0f;
    if(motorMoving() || scaleJob.id.length()) { ack(id,false,"Stop motor / tunggu timbangan."); return; }
    if(!loadcellReady || loadcellSaturated) { ack(id,false,"HX711 belum siap / ADC saturasi."); return; }
    if(cmd=="calibrate" && (!std::isfinite(grams) || grams<=0 || grams>10000)) {
      ack(id,false,"Berat referensi harus >0 sampai 10000 gram."); return;
    }
    scaleJob.id=id; scaleJob.calibrate=cmd=="calibrate"; scaleJob.grams=grams;
    scaleJob.count=0; scaleJob.total=0; scaleJob.started=millis(); return;
  }
  ack(id,false,"Firmware pengujian komponen; perintah tidak didukung.");
}
void manualCommand(char command) {
  manualControl=true;
  if(String("fFbB").indexOf(command)>=0 && !motorEnabled) {
    ack("manual",false,"Aktifkan stepper dengan e sebelum menjalankan motor."); return;
  }
  if(command=='e' || command=='E') setMotorEnabled(true);
  else if(command=='d' || command=='D') setMotorEnabled(false);
  else
  if(command=='f' || command=='F') startMotor(1,500,true,motorPosition);
  else if(command=='b' || command=='B') startMotor(-1,500,true,motorPosition);
  else if(command=='s' || command=='S') stopMotor();
  else if(command=='1') setRelay(0,true);
  else if(command=='2') setRelay(0,false);
  else if(command=='3') setRelay(1,true);
  else if(command=='4') setRelay(1,false);
  else if(command=='0') { setRelay(0,false); setRelay(1,false); setMotorEnabled(false); }
  ack("manual",true,"Manual command applied");
}
void setup() {
  for(uint8_t pin:RELAY_PINS) initializeOutput(pin,HIGH);
  initializeOutput(STEP_PIN,LOW);
  initializeOutput(DIR_PIN,LOW);
  initializeOutput(ENA_PIN,HIGH);
  for(uint8_t pin:IR_PINS) pinMode(pin,INPUT_PULLUP);
  Serial.begin(115200); delay(1000); serialBuffer.reserve(1024);
  preferences.begin("rvm-diag",false);
  loadcellOffset=preferences.getLong("offset",0); loadcellFactor=preferences.getFloat("factor",0);
  if(!std::isfinite(loadcellFactor) || fabsf(loadcellFactor)<0.01f) loadcellFactor=0;
  // Rob Tillaart HX711: omit begin()'s blocking reset/read when no sensor is ready.
  scale.begin(HX_DATA,HX_CLOCK,false,false); scale.power_down(); scale.power_up();
  pinMode(RFID_RST,OUTPUT); digitalWrite(RFID_RST,HIGH);
  SPI.begin(22,13,21,RFID_SS); initializeRFID();
  lastController=millis();
}
void loop() {
  while(Serial.available()) {
    const char c=Serial.read();
    if(serialBuffer.length()==0 && !serialOverflow && String("eEdDfFbBsS12340").indexOf(c)>=0) manualCommand(c);
    else if(c=='\n') {
      if(!serialOverflow && serialBuffer.length()) handleCommand(serialBuffer);
      serialBuffer=""; serialOverflow=false;
    } else if(c!='\r' && !serialOverflow) {
      if(serialBuffer.length()<1024) serialBuffer+=c;
      else { serialBuffer=""; serialOverflow=true; }
    }
  }
  if(!manualControl && millis()-lastController>LEASE_MS) {
    setMotorEnabled(false); for(uint8_t i=0;i<2;i++) if(relayOn[i]) setRelay(i,false);
  }
  pollMotor(); pollIR();
  // Per-module testing: slow sensor transactions pause while the motor runs.
  if(!motorMoving()) { pollLoadcell(); pollRFID(); }
  if(millis()-lastTelemetry>=500) { lastTelemetry=millis(); telemetry(); }
}
