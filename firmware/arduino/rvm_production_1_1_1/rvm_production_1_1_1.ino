#include <Arduino.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <HX711.h>
#include <Preferences.h>
#include <driver/gpio.h>
#include <soc/gpio_struct.h>
#include <esp_rom_sys.h>
#include <cmath>
// BEGIN PRODUCTION FLOW
#include <stdint.h>
#include <cmath>

// Hardware-independent production sequence; also exercised by the host tests.
struct ProductionFlow {
  enum State { Standby, Taring, AwaitBottle, Intake, Inspect, AcceptMove,
               ConfirmDrop, Rearm, SafetyPause, ReturnBottle, WaitRemoval, CheckEmpty, Fault };
  enum Action { None, ForwardUntilIR1, BackwardSteps, Pause, Resume, Stop };
  State state = Standby, faultFrom = Standby, pausedFrom = Standby;
  Action action = None;
  uint32_t entered = 0, cycle = 0, sampleCount = 0, bottles = 0, caps = 0;
  double sampleTotal = 0;
  float grams = 0, bottleGrams = 0, refGrams = 0, measuredGrams = 0;
  long offset = 0;
  float factor = 0;
  bool active = false, finished = false, armed = false, releaseOn = false, releasePaused = false;
  uint32_t releaseStarted = 0, releaseRemaining = 0, clearStarted = 0, moveSteps = 12000;
  bool returnSeen = false, clearTiming = false, resetTare = false;
  bool cvReady = false, accepted = false, weighingDone = false, invalidSample = false;
  uint8_t cvSize = 0; // Bottle size named by CV: 0 = not given, 1 = small (9-12 g), 2 = large (15-18 g).
  bool weighActive = false, zeroing = false, shredderStarted = false;
  uint32_t weighStarted = 0, moveRemaining = 0; // moveRemaining is fed from the motor each loop.
  bool capArmed=false, capBusy=false, capCounted=false, capClearTiming=false, capActiveTiming=false;
  uint32_t capStarted=0, capClearStarted=0;
  static constexpr uint32_t RELEASE_MS=20000;
  static constexpr uint32_t RETURN_TIMEOUT_MS=30000;
  static constexpr uint32_t INTAKE_STEPS=12000, ACCEPT_STEPS=20000, SHREDDER_AT_STEPS=10000;
  static constexpr uint32_t SETTLE_MS=300; // Samples at the start of each window are skipped while the belt settles.
  static constexpr uint32_t INSPECT_MS=2000, PAUSE_MS=2000, CONFIRM_MS=1000, CHECK_MS=1000, ZERO_MS=1000;
  static constexpr uint32_t IR1_CLEAR_MS=300;
  static constexpr float TOLERANCE_GRAMS=2.0f, EMPTY_GRAMS=4.5f;
  const char *error = "";
  const char *rejectionReason = "";
  void resetCapGate() { capArmed=false; capBusy=false; capCounted=false; capClearTiming=false; capActiveTiming=false; }
  bool capEnabled() const { return active; }
  void countCaps(uint32_t now, bool ir3) {
    if(!capEnabled()) { resetCapGate(); return; }
    if(!ir3) {
      if(!capClearTiming) { capClearTiming=true; capClearStarted=now; }
      if(now-capClearStarted>=100) { capArmed=true; capBusy=false; capCounted=false; }
      capActiveTiming=false; // Interrupted active debounce cannot accumulate pulses.
      return;
    }
    capClearTiming=false;
    // Independent cap counting throughout the active session, including motor movement.
    if(capArmed && !capBusy) { capArmed=false; capBusy=true; capCounted=false; capStarted=now; }
    if(capBusy && !capCounted) {
      if(!capActiveTiming) { capActiveTiming=true; capStarted=now; }
      if(now-capStarted>=30) { caps++; capCounted=true; }
    }
  }

  static const char *stateName(State s) {
    static const char *names[] = {"standby", "taring", "await_bottle",
      "intake", "inspection", "accept_move", "confirm_drop", "rearm", "safety_pause",
      "return_bottle", "wait_removal", "check_empty", "fault"};
    return names[s];
  }
  const char *name() const { return stateName(state); }
  void enter(State next, uint32_t now) { state = next; entered = now; clearTiming = false; }
  void fail(const char *reason, uint32_t now) {
    if(state==Fault) { action=Stop; return; } // Preserve the original bottle location and error.
    faultFrom = state; error = reason; active = false; releaseOn = false; releasePaused = false;
    weighActive = false; resetCapGate(); action = Stop; enter(Fault, now);
  }
  bool start(float calibration, uint32_t now) {
    if(state != Standby || !std::isfinite(calibration) || fabsf(calibration)<0.01f) return false;
    factor = calibration; grams = 0; bottles = 0; caps = 0; resetCapGate(); bottleGrams = 0; refGrams = 0;
    sampleTotal = 0; sampleCount = 0; invalidSample = false; weighActive = false;
    active = true; finished = false; armed = false; error = ""; releasePaused = false;
    cvReady = false; accepted = false; resetTare = false; moveSteps = INTAKE_STEPS;
    rejectionReason = "";
    enter(Taring, now); return true;
  }
  bool reset(float calibration, uint32_t now) {
    if(state==Standby || !std::isfinite(calibration) || fabsf(calibration)<0.01f) return false;
    resetCapGate(); factor=calibration; active=true; finished=false; releaseOn=false; releasePaused=false; armed=false;
    error=""; rejectionReason=""; cvReady=false; accepted=false; weighingDone=false; resetTare=true;
    sampleTotal=0; sampleCount=0; invalidSample=false; weighActive=false; bottleGrams=0; refGrams=0;
    returnSeen=false;
    cycle++; // Invalidate any camera result still in flight before Reset.
    action=Stop; enter(Taring,now);
    return true;
  }
  void stop(uint32_t now) {
    active = false; finished = true; releaseOn = false; releasePaused = false; weighActive = false;
    action = Stop; armed = false; resetCapGate();
    enter(Standby, now);
  }
  void beginWeigh(uint32_t now) {
    sampleTotal=0; sampleCount=0; invalidSample=false; weighActive=true; zeroing=false; weighStarted=now;
  }
  // Every finished cycle leaves an empty conveyor: re-zero the scale before the next bottle.
  void awaitBottle(uint32_t now, bool arm) { armed=arm; enter(AwaitBottle,now); beginWeigh(now); zeroing=true; }
  // 0 = still weighing, 1 = average ready in g, -1 = no usable samples.
  int weighResult(uint32_t now, uint32_t windowMs, float &g) {
    if(!weighActive || now-weighStarted<windowMs) return 0;
    weighActive=false;
    if(sampleCount<2 || invalidSample) return -1;
    g=(float)(sampleTotal/sampleCount);
    if(!std::isfinite(g)) return -1;
    measuredGrams=g; return 1;
  }
  bool weighing() const { return state==Taring || weighActive; }
  static uint8_t bottleSize(float g) { return g>=9.0f && g<=12.0f ? 1 : g>=15.0f && g<=18.0f ? 2 : 0; }
  static bool knownBottle(float g) { return bottleSize(g)!=0; }
  // IR1 in these states means a hand or a second bottle at the entrance. Intake is excluded:
  // the moving bottle itself still passes IR1 there.
  bool inSafetyZone() const {
    return state==Inspect || state==AcceptMove || state==ConfirmDrop || state==Rearm;
  }
  void sample(long raw, uint32_t now) {
    if(state == Taring) {
      if(raw<=-8388608 || raw>=8388607) { invalidSample = true; return; }
      sampleTotal += (double)raw; sampleCount++;
      if(sampleCount>=10) {
        if(invalidSample) { fail("tare_saturated", now); return; }
        offset = (long)(sampleTotal/sampleCount);
        resetTare = false;
        enter(AwaitBottle, now);
      }
      return;
    }
    if(!weighActive || now-weighStarted<SETTLE_MS) return;
    if(raw<=-8388608 || raw>=8388607) { invalidSample = true; return; }
    sampleTotal += zeroing ? (double)raw : ((double)raw-offset)/factor;
    sampleCount++;
  }
  bool decision(uint32_t id, bool ok, uint8_t size=0) {
    const bool inspecting = state==Inspect || (state==SafetyPause && pausedFrom==Inspect);
    if(!inspecting || id != cycle || cvReady || size>2) return false;
    cvReady = true; accepted = ok; cvSize = size; return true;
  }
  // Every anomaly ends here: no credit, shredder off, conveyor returns until IR1.
  void startReturn(const char *reason, bool ir1, uint32_t now) {
    rejectionReason=reason; releaseOn=false; releasePaused=false; weighActive=false;
    armed=false; returnSeen=ir1;
    action=ir1?Stop:ForwardUntilIR1; enter(ir1?WaitRemoval:ReturnBottle, now);
  }
  void pause(uint32_t now) {
    pausedFrom=state; action=Pause; weighActive=false;
    if(releaseOn) { releaseRemaining=RELEASE_MS-(now-releaseStarted); releaseOn=false; releasePaused=true; }
    enter(SafetyPause, now);
  }
  void resume(uint32_t now) {
    if(releasePaused) { releaseOn=true; releaseStarted=now-(RELEASE_MS-releaseRemaining); releasePaused=false; }
    const State back=pausedFrom;
    action=back==AcceptMove ? Resume : None;
    enter(back, now);
    if(back==ConfirmDrop) beginWeigh(now);
  }
  void tick(uint32_t now, bool ir1, bool moving, bool ir3=false) {
    if(releaseOn && now-releaseStarted>=RELEASE_MS) releaseOn = false;
    countCaps(now,ir3);
    if(inSafetyZone() && ir1) { pause(now); return; }
    float g = 0;
    int result = 0;
    switch(state) {
      case Taring:
        if(now-entered>=9000) fail("tare_timeout", now);
        break;
      case AwaitBottle:
        if(zeroing && ir1) { zeroing=false; weighActive=false; } // A bottle came first: keep the previous zero.
        else if(zeroing && now-weighStarted>=ZERO_MS) {
          zeroing=false; weighActive=false;
          if(sampleCount>=2 && !invalidSample) offset=(long)(sampleTotal/sampleCount);
        }
        if(!ir1) armed = true;
        if(armed && ir1) {
          armed = false; rejectionReason=""; cycle++;
          moveSteps = INTAKE_STEPS; action = BackwardSteps; enter(Intake, now);
        }
        break;
      case Intake:
        if(!moving) {
          cvReady = false; accepted = false; cvSize = 0; weighingDone = false;
          enter(Inspect, now); beginWeigh(now);
        }
        break;
      case Inspect:
        // The inspection weight is the reference for the rest of the cycle.
        if(!weighingDone) {
          result=weighResult(now,INSPECT_MS,g);
          if(result<0) { fail("weighing_invalid", now); break; }
          if(result>0) { weighingDone=true; bottleGrams=g; refGrams=g; }
          if(result>0 && !knownBottle(g)) { startReturn("weight_out_of_range",ir1,now); break; }
        }
        if(weighingDone && cvReady) {
          // The bottle CV recognised must also weigh like that bottle.
          if(accepted && cvSize && cvSize!=bottleSize(bottleGrams)) startReturn("weight_class_mismatch",ir1,now);
          else if(accepted) {
            shredderStarted = false; moveSteps = moveRemaining = ACCEPT_STEPS;
            action = BackwardSteps; enter(AcceptMove, now);
          } else startReturn("cv_rejected",ir1,now);
        } else if(now-entered>=30000) fail("cv_timeout", now);
        break;
      case AcceptMove:
        // The shredder starts halfway through the move and runs 20 s from there.
        if(!shredderStarted && moveRemaining<=moveSteps-SHREDDER_AT_STEPS) {
          shredderStarted = true; releaseOn = true; releaseStarted = now;
        }
        if(!moving) { enter(ConfirmDrop, now); beginWeigh(now); }
        break;
      case ConfirmDrop:
        // Credit only once the scale proves the bottle left the conveyor.
        result=weighResult(now,CONFIRM_MS,g);
        if(result<0) fail("weighing_invalid",now);
        else if(result>0 && g<EMPTY_GRAMS) { grams += bottleGrams; bottles++; refGrams=0; enter(Rearm,now); }
        else if(result>0) startReturn("not_dropped",ir1,now);
        break;
      case Rearm:
        if(!releaseOn) awaitBottle(now, false);
        break;
      case SafetyPause:
        // Wait for a clear entrance, then compare the conveyor weight with the reference.
        if(ir1) { clearTiming=false; weighActive=false; break; }
        if(!clearTiming) { clearTiming=true; clearStarted=now; }
        if(now-clearStarted<IR1_CLEAR_MS) break;
        if(!weighActive) { beginWeigh(now); break; }
        result=weighResult(now,PAUSE_MS,g);
        if(result<0) fail("weighing_invalid",now);
        else if(result>0 && pausedFrom==Inspect && !weighingDone) {
          // No reference yet: the weight after the pause becomes the inspection weight.
          weighingDone=true; bottleGrams=g; refGrams=g; resume(now);
          if(!knownBottle(g)) startReturn("weight_out_of_range",ir1,now);
        }
        else if(result>0 && fabsf(g-refGrams)<=TOLERANCE_GRAMS) resume(now);
        else if(result>0) startReturn("safety_weight_changed",ir1,now);
        break;
      case ReturnBottle:
        // Return until the bottle reaches the entrance, regardless of pulse count.
        if(ir1) { returnSeen=true; action=Stop; enter(WaitRemoval,now); }
        else if(now-entered>=RETURN_TIMEOUT_MS) fail("return_ir_timeout",now);
        break;
      case WaitRemoval:
        // The returned bottle must be seen, then the entrance must stay clear for 300 ms.
        if(ir1) { returnSeen=true; clearTiming=false; }
        else if(returnSeen) {
          if(!clearTiming) { clearTiming=true; clearStarted=now; }
          if(now-clearStarted>=IR1_CLEAR_MS) { enter(CheckEmpty,now); beginWeigh(now); }
        }
        break;
      case CheckEmpty:
        // Keep returning until the conveyor is empty.
        if(ir1) { returnSeen=true; weighActive=false; enter(WaitRemoval,now); break; }
        result=weighResult(now,CHECK_MS,g);
        if(result<0) fail("weighing_invalid",now);
        else if(result>0 && g<EMPTY_GRAMS) { refGrams=0; awaitBottle(now, true); }
        else if(result>0) startReturn(rejectionReason,ir1,now);
        break;
      default: break;
    }
  }
  Action takeAction() { Action value = action; action = None; return value; }
  bool relay1() const { return active && (state != Taring || resetTare); }
  bool relay2() const { return releaseOn; }
  bool standbyLED() const { return state==Standby || state==Taring || state==AwaitBottle || state==Rearm; }
  const char *ledColor() const {
    if(state == Fault || state == SafetyPause || state == ReturnBottle || state == WaitRemoval ||
       state == CheckEmpty) return "#ff0000";
    if(state == AcceptMove || state == ConfirmDrop) return "#ffff00";
    if(standbyLED()) return "#00ff00";
    return "#0000ff";
  }
  uint8_t ledBrightness() const { return standbyLED() ? 30 : 60; }
  const char *ledMode() const {
    return standbyLED() || state == AcceptMove || state == ConfirmDrop || state == SafetyPause ? "blink" : "solid";
  }
};
// WUPA keeps halted cards readable; emit once until removal or explicit home rearm.
struct RFIDScanGate {
  bool armed = true, present = false;
  uint32_t lastSeen = 0;
  void arm() { armed = true; }
  bool seen(bool sameUID, uint32_t now) {
    const bool emit = armed || !present || !sameUID;
    present = true; armed = false; lastSeen = now;
    return emit;
  }
  void absent(uint32_t now) {
    if(now-lastSeen>=300) { present = false; armed = true; }
  }
};
// END PRODUCTION FLOW
ProductionFlow production;
String sessionUID;
bool restartScheduled=false;
uint32_t restartRequested=0;
constexpr uint32_t PRODUCTION_SPEED = 3200;
constexpr uint32_t MOTOR_TIMER_HZ = 3200000; // 1000 ticks = 312.5 us = 3200 steps/s.
void applyProduction();

// Production hardware routines copied from the tested firmware; diagnostic source is untouched.
// ESP32 core 3.3.11; HX711 by Rob Tillaart 0.6.5; MFRC522 1.4.12.
const char *FIRMWARE = "almufti-production-1.1.1";
constexpr uint8_t IR_PINS[] = {14, 26, 27};
constexpr uint8_t RELAY_PINS[] = {15, 33}; // Physical relay 1, then relay 2.
constexpr uint8_t STEP_PIN = 2, DIR_PIN = 4, ENA_PIN = 25;
constexpr uint8_t HX_DATA = 34, HX_CLOCK = 32, RFID_SS = 16, RFID_RST = 17;
constexpr uint32_t LEASE_MS = 3000;
MFRC522 rfid(RFID_SS, RFID_RST);
HX711 scale;
Preferences preferences;

bool ir[3] = {}, irRaw[3] = {}, irPolarity[3] = {true,true,true};
bool relayOn[2] = {};
volatile bool motorRunning = false;
volatile bool motorContinuous = false;
hw_timer_t *motorTimer = nullptr;
bool motorTimerActive = false;
portMUX_TYPE motorLock = portMUX_INITIALIZER_UNLOCKED;
RFIDScanGate rfidGate;
volatile int8_t motorDirection = 1;
volatile int32_t motorPosition = 0, motorTarget = 0;
uint32_t pausedSteps = 0;

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
bool serialOverflow = false;
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
  doc["firmware"]=FIRMWARE; doc["protocol"]=1; doc["productionProtocol"]=1;
  doc["grams"]=production.grams; doc["caps"]=production.caps;
  doc["sessionFinished"]=production.finished; doc["productionState"]=production.name(); doc["diagnostic"]=false;
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
  if(motorTimerActive) { timerStop(motorTimer); motorTimerActive=false; }
  portENTER_CRITICAL(&motorLock);
  motorRunning=false; motorContinuous=false; motorTarget=motorPosition;
  gpio_set_level((gpio_num_t)STEP_PIN,LOW); gpio_set_level((gpio_num_t)ENA_PIN,HIGH);
  portEXIT_CRITICAL(&motorLock);
}
void ARDUINO_ISR_ATTR motorTick() {
  portENTER_CRITICAL_ISR(&motorLock);
  if(motorRunning) {
    GPIO.out_w1ts=1UL<<STEP_PIN;
    esp_rom_delay_us(10); // Match the tested TB6600 pulse width.
    GPIO.out_w1tc=1UL<<STEP_PIN;
    motorPosition+=motorDirection;
    if(!motorContinuous && motorPosition==motorTarget) {
      motorRunning=false; GPIO.out_w1ts=1UL<<ENA_PIN;
    }
  }
  portEXIT_CRITICAL_ISR(&motorLock);
}
void startMotor(int8_t direction, int32_t target, bool continuous=false) {
  stopMotor();
  digitalWrite(DIR_PIN,direction>0?HIGH:LOW);
  digitalWrite(ENA_PIN,LOW); delayMicroseconds(20);
  portENTER_CRITICAL(&motorLock);
  motorDirection=direction; motorTarget=target; motorContinuous=continuous; motorRunning=continuous || target!=motorPosition;
  portEXIT_CRITICAL(&motorLock);
  timerWrite(motorTimer,0);
  timerAlarm(motorTimer,MOTOR_TIMER_HZ/PRODUCTION_SPEED,true,0);
  if(motorRunning) { timerStart(motorTimer); motorTimerActive=true; }
  else stopMotor();
}
uint32_t remainingSteps() {
  portENTER_CRITICAL(&motorLock);
  const int32_t left=motorRunning && !motorContinuous ? motorTarget-motorPosition : 0;
  portEXIT_CRITICAL(&motorLock);
  return left<0 ? -left : left;
}
void pollMotor() {
  if(motorTimerActive && !motorRunning) stopMotor();
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
  rfidStatus=MFRC522::STATUS_TIMEOUT; lastUID=""; rfidCardPresent=false; rfidGate=RFIDScanGate{};
}
void pollRFID() {
  const uint32_t now=millis();
  if(now-lastHealth>=1000) {
    lastHealth=now;
    rfidVersion=rfid.PCD_ReadRegister(MFRC522::VersionReg);
    rfidReady=rfidVersion==0x82 || rfidVersion==0x88 || rfidVersion==0x90 ||
              rfidVersion==0x91 || rfidVersion==0x92 || rfidVersion==0x12;
    rfidAntennaOn=(rfid.PCD_ReadRegister(MFRC522::TxControlReg)&3)==3;
  }
  if(now-lastRFIDPoll<125) return;
  lastRFIDPoll=now;
  if(!rfidReady) return;
  rfid.PCD_StopCrypto1();
  byte atqa[2], size=sizeof(atqa);
  rfidStatus=rfid.PICC_WakeupA(atqa,&size);
  if(rfidStatus!=MFRC522::STATUS_OK && rfidStatus!=MFRC522::STATUS_COLLISION) {
    if(rfidStatus==MFRC522::STATUS_TIMEOUT) rfidGate.absent(now);
    rfidCardPresent=rfidGate.present;
    return;
  }
  if(!rfid.PICC_ReadCardSerial()) { rfidStatus=MFRC522::STATUS_ERROR; return; }
  String uid;
  for(byte i=0;i<rfid.uid.size;i++) {
    if(rfid.uid.uidByte[i]<0x10) uid+="0";
    uid+=String(rfid.uid.uidByte[i],HEX);
  }
  uid.toUpperCase();
  const bool emit=rfidGate.seen(uid==lastUID,millis());
  lastUID=uid; lastCardSeen=millis(); rfidCardPresent=rfidGate.present;
  rfidStatus=MFRC522::STATUS_OK;
  if(emit) {
    totalScan++; StaticJsonDocument<128> doc; doc["type"]="rfid"; doc["uid"]=uid; send(doc);
  }
  rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
}
void pollLoadcell() {
  const uint32_t now=millis();
  if(!loadcellSamples || now-lastSample>1500) loadcellReady=false;
  if(scaleJob.id.length() && now-scaleJob.started>9000) {
    ack(scaleJob.id,false,"HX711 timeout; pengaturan lama dipertahankan."); scaleJob.id="";
  }
  if(now-lastScalePoll<((scaleJob.id.length() || production.weighing())?10:500)) return;
  lastScalePoll=now;
  // Same read() as the basic sketch; never wait for a missing sensor in loop().
  if(!scale.is_ready()) return;
  loadcellRaw=(long)scale.read(); lastSample=millis(); loadcellSamples++;
  production.sample(loadcellRaw, lastSample);
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
  doc["irActiveLow"]=true; doc["caps"]=production.caps;
  doc["grams"]=production.grams;
  doc["liveGrams"]=loadcellReady && loadcellFactor!=0?(loadcellRaw-loadcellOffset)/loadcellFactor:0;
  doc["productionState"]=production.name(); doc["sessionActive"]=production.active;
  doc["sessionFinished"]=production.finished; doc["cycleId"]=production.cycle;
  doc["bottleGrams"]=production.bottleGrams; doc["acceptedBottles"]=production.bottles;
  doc["capCounterEnabled"]=production.capEnabled(); doc["capBusy"]=production.capBusy;
  doc["productionError"]=production.error;
  doc["rejectionReason"]=production.rejectionReason;
  doc["referenceGrams"]=production.refGrams; doc["measuredGrams"]=production.measuredGrams; doc["shredderPaused"]=production.releasePaused;
  doc["pausedFrom"]=production.state==ProductionFlow::SafetyPause?ProductionFlow::stateName(production.pausedFrom):"";
  doc["ledMode"]=production.ledMode(); doc["ledColor"]=production.ledColor();
  doc["ledBrightness"]=production.ledBrightness();
  doc["position"]=motorPosition; doc["motorMoving"]=motorMoving();
  doc["motorContinuous"]=motorContinuous?motorDirection:0; doc["motorSpeed"]=PRODUCTION_SPEED;
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
  doc["diagnostic"]=false; doc["firmware"]=FIRMWARE; send(doc);
}
void handleCommand(const String &line) {
  StaticJsonDocument<1024> doc;
  if(deserializeJson(doc,line)) return;
  const String id=doc["id"] | "", cmd=doc["cmd"] | "";
  if(id.length()==0 || id.length()>64) return;
  lastController=millis();
  if(cmd=="ping") { ack(id,true,"Production controller ready"); return; }
  if(cmd=="controller_reset") {
    if(production.state!=ProductionFlow::Standby) { ack(id,false,"Selesaikan sesi dahulu sebelum reset ESP."); return; }
    stopMotor(); setRelay(0,false); setRelay(1,false);
    ack(id,true,"ESP32 akan restart."); Serial.flush();
    restartRequested=millis(); restartScheduled=true; return;
  }
  if(cmd=="session_reset") {
    if(!motorTimer || scaleJob.id.length()) {
      ack(id,false,"Timer motor belum siap / tunggu pengaturan timbangan."); return;
    }
    if(!production.reset(loadcellFactor,millis())) {
      ack(id,false,"Mulai sesi dan pastikan kalibrasi valid sebelum Reset."); return;
    }
    applyProduction(); ack(id,true,"Reset dimulai; total setoran dipertahankan."); return;
  }
  if(cmd=="rfid_arm") {
    if(production.state!=ProductionFlow::Standby) { ack(id,false,"Akhiri sesi sebelum scan kartu baru."); return; }
    rfidGate.arm(); ack(id,true,"RFID siap untuk sesi berikutnya."); return;
  }
  if(cmd=="session_start") {
    const String uid=doc["uid"] | "";
    // App must resolve the RFID UID against its profile database before authorizing.
    if(uid.length()==0 || uid!=lastUID) {
      ack(id,false,"Scan UID dan validasi profil di app dahulu."); return;
    }
    if(!motorTimer || scaleJob.id.length() || motorMoving() || !loadcellReady || loadcellSaturated ||
       !production.start(loadcellFactor,millis())) {
      ack(id,false,"Belum siap: cek sesi, HX711 dan kalibrasi."); return;
    }
    sessionUID=uid; applyProduction(); ack(id,true,"Session started; zeroing scale."); return;
  }
  if(cmd=="session_stop") {
    production.stop(millis()); applyProduction(); rfidGate.arm();
    ack(id,true,"Session stopped; totals preserved."); return;
  }
  if(cmd=="cv_result") {
    // Optional size: 1 = small bottle, 2 = large bottle; firmware checks it against the weight.
    if(!doc["cycleId"].is<uint32_t>() || !doc["accepted"].is<bool>() ||
       (!doc["size"].isNull() && !doc["size"].is<uint8_t>()) ||
       !production.decision(doc["cycleId"],doc["accepted"],doc["size"] | 0)) {
      ack(id,false,"Hasil CV tidak valid / ID botol kedaluwarsa."); return;
    }
    ack(id,true,"CV decision received."); return;
  }
  if(cmd=="motor_stop") {
    production.fail("operator_stop",millis()); applyProduction(); ack(id,true,"Motor stopped."); return;
  }
  if(production.state!=ProductionFlow::Standby) {
    ack(id,false,"Perintah manual diblokir selama produksi; gunakan session_stop."); return;
  }
  if(cmd=="relay" || cmd=="motor_run" || cmd=="motor_move") {
    ack(id,false,"Gunakan firmware pengujian untuk gerakan/relay manual."); return;
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
  ack(id,false,"Perintah produksi tidak didukung.");
}
void applyProduction() {
  const auto action=production.takeAction();
  if(action==ProductionFlow::Pause) {
    // Remember the unfinished stepped move so Resume can continue it.
    pausedSteps=remainingSteps();
    stopMotor();
  } else if(action==ProductionFlow::Stop) stopMotor();
  else if(action!=ProductionFlow::None) {
    // Reset logical position at each move; positions represent pulses, not an encoder.
    motorPosition=0;
    if(action==ProductionFlow::ForwardUntilIR1) startMotor(1,0,true);
    else if(action==ProductionFlow::BackwardSteps) startMotor(-1,-(int32_t)production.moveSteps);
    else if(action==ProductionFlow::Resume && pausedSteps) startMotor(-1,-(int32_t)pausedSteps);
    if(action==ProductionFlow::Resume) pausedSteps=0;
  }
  setRelay(0,production.relay1()); setRelay(1,production.relay2());
  if(production.state==ProductionFlow::AwaitBottle) loadcellOffset=production.offset;
}
void updateProduction() {
  const auto before=production.state;
  production.moveRemaining=remainingSteps();
  production.tick(millis(),ir[0],motorMoving(),ir[2]); applyProduction();
  if(production.state!=before) {
    StaticJsonDocument<384> event; event["type"]="production";
    event["state"]=production.name(); event["cycleId"]=production.cycle;
    event["error"]=production.error; event["rejectionReason"]=production.rejectionReason;
    event["measuredGrams"]=production.measuredGrams; send(event);
    // Resuming inspection after a safety pause keeps the camera request already sent.
    if(production.state==ProductionFlow::Inspect && before==ProductionFlow::Intake) {
      StaticJsonDocument<192> request; request["type"]="inspection_request";
      request["cycleId"]=production.cycle; request["uid"]=sessionUID;
      request["windowMs"]=2000; send(request);
    }
  }
}
void setup() {
  for(uint8_t pin:RELAY_PINS) initializeOutput(pin,HIGH);
  initializeOutput(STEP_PIN,LOW);
  initializeOutput(DIR_PIN,LOW);
  initializeOutput(ENA_PIN,HIGH);
  for(uint8_t pin:IR_PINS) pinMode(pin,INPUT_PULLUP);
  Serial.begin(115200); delay(1000); serialBuffer.reserve(1024);
  preferences.begin("rvm-diag",true); // Read existing tested calibration, never overwrite it.
  loadcellOffset=preferences.getLong("offset",0); loadcellFactor=preferences.getFloat("factor",0);
  preferences.end(); preferences.begin("rvm-prod",false);
  loadcellOffset=preferences.getLong("offset",loadcellOffset);
  loadcellFactor=preferences.getFloat("factor",loadcellFactor);
  if(!std::isfinite(loadcellFactor) || fabsf(loadcellFactor)<0.01f) loadcellFactor=0;
  // Rob Tillaart HX711: omit begin()'s blocking reset/read when no sensor is ready.
  scale.begin(HX_DATA,HX_CLOCK,false,false); scale.power_down(); scale.power_up();
  pinMode(RFID_RST,OUTPUT); digitalWrite(RFID_RST,HIGH);
  SPI.begin(22,13,21,RFID_SS); initializeRFID();
  motorTimer=timerBegin(MOTOR_TIMER_HZ);
  if(motorTimer) { timerStop(motorTimer); timerAttachInterrupt(motorTimer,&motorTick); }
  else production.fail("motor_timer_unavailable",millis());
  lastController=millis();
}
void loop() {
  if(restartScheduled && millis()-restartRequested>=200) { ESP.restart(); return; }
  while(Serial.available()) {
    const char c=Serial.read();
    if(c=='\n') {
      if(!serialOverflow && serialBuffer.length()) handleCommand(serialBuffer);
      serialBuffer=""; serialOverflow=false;
    } else if(c!='\r' && !serialOverflow) {
      if(serialBuffer.length()<1024) serialBuffer+=c;
      else { serialBuffer=""; serialOverflow=true; }
    }
  }
  if(production.active && millis()-lastController>LEASE_MS) {
    production.fail("controller_disconnected",millis()); applyProduction();
  }
  pollMotor(); pollIR();
  // Keep tested pulse timing: read scale/RFID only with the conveyor stopped.
  if(!motorMoving()) { pollLoadcell(); if(!production.active) pollRFID(); }
  updateProduction();
  if(millis()-lastTelemetry>=500) { lastTelemetry=millis(); telemetry(); }
}
