#include <cassert>
#include <cstdint>
#include <iostream>
#include "production-flow-under-test.h"
#define ARDUINO_ISR_ATTR
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(x) ((void)(x))
#define portEXIT_CRITICAL(x) ((void)(x))
#define portENTER_CRITICAL_ISR(x) ((void)(x))
#define portEXIT_CRITICAL_ISR(x) ((void)(x))
using gpio_num_t = int;
using portMUX_TYPE = int;
constexpr int LOW=0, HIGH=1;
constexpr uint8_t STEP_PIN=2, DIR_PIN=4, ENA_PIN=25;
struct hw_timer_t { bool running=false; uint64_t alarm=0; } timer;
uint32_t pinLevels=0;
uint32_t pulses=0, forwardPulses=0, backwardPulses=0;
struct Register {
  bool set;
  void operator=(uint32_t value) {
    if(set) {
      if((value&(1UL<<STEP_PIN)) && !(pinLevels&(1UL<<STEP_PIN))) {
        pulses++;
        if(pinLevels&(1UL<<DIR_PIN)) forwardPulses++; else backwardPulses++;
      }
      pinLevels|=value;
    } else pinLevels&=~value;
  }
};
struct { Register out_w1ts{true},out_w1tc{false}; } GPIO;
void gpio_set_level(gpio_num_t pin,int level) {
  if(level)pinLevels|=1UL<<pin;else pinLevels&=~(1UL<<pin);
}
void digitalWrite(int pin,int level) { gpio_set_level(pin,level); }
void delayMicroseconds(int) {}
void esp_rom_delay_us(int us) { assert(us==10); }
void timerStop(hw_timer_t *t) { t->running=false; }
void timerStart(hw_timer_t *t) { t->running=true; }
void timerWrite(hw_timer_t *,uint64_t value) { assert(value==0); }
void timerAlarm(hw_timer_t *t,uint64_t interval,bool repeat,uint64_t reload) {
  assert(repeat && reload==0); t->alarm=interval;
}
ProductionFlow production;
long loadcellOffset=0;
bool relays[2]={};
void setRelay(uint8_t index,bool on) { relays[index]=on; }
#include "motor-under-test.h"
void runMove() {
  const uint32_t before=pulses;
  for(int i=0;i<12000;i++) {
    assert(timer.running); motorTick();
    if(i<11999)assert(motorMoving());
  }
  assert(pulses-before==12000 && !motorMoving());
  assert((pinLevels&(1UL<<STEP_PIN))==0);
  assert((pinLevels&(1UL<<ENA_PIN))!=0);
  assert(timer.alarm*12000==uint64_t(MOTOR_TIMER_HZ)*15/4); // Exactly 3.75 seconds.
  pollMotor(); assert(!timer.running && !motorTimerActive);
}
int main() {
  motorTimer=&timer;
  assert(PRODUCTION_SPEED==3200 && MOTOR_TIMER_HZ==3200000);
  production.action=ProductionFlow::BackwardSteps;applyProduction();
  assert(timer.alarm==1000 && motorTarget==-12000);runMove();
  production.action=ProductionFlow::BackwardSteps;applyProduction();runMove();
  assert(backwardPulses==24000);
  production.active=true; production.state=ProductionFlow::ReturnBottle;
  production.action=ProductionFlow::ForwardUntilIR1;applyProduction();
  assert(motorContinuous && motorMoving() && relays[0] && !relays[1]);
  // Rejection must continue past the old 12000-pulse limit until IR1 is reached.
  for(int i=0;i<16000;i++)motorTick();
  assert(motorMoving() && motorPosition==16000 && forwardPulses==16000);
  production.tick(5000,true,motorMoving());applyProduction();
  assert(!motorMoving() && !motorContinuous && production.state==ProductionFlow::WaitRemoval);
  const auto returned=pulses;
  for(int i=0;i<100;i++)motorTick();
  assert(pulses==returned);
  assert(relays[0] && !relays[1] && (pinLevels&(1UL<<ENA_PIN))!=0);
  production.tick(5100,false,false);applyProduction();
  production.tick(5399,false,false);applyProduction();assert(production.state==ProductionFlow::WaitRemoval);
  production.tick(5400,false,false);applyProduction();assert(production.state==ProductionFlow::CheckEmpty);
  // Reset during a moving rejection stops immediately and cannot emit further pulses.
  production.action=ProductionFlow::ForwardUntilIR1;applyProduction();
  for(int i=0;i<100;i++)motorTick();
  assert(production.reset(10,6000));applyProduction();const auto resetPulses=pulses;
  for(int i=0;i<100;i++)motorTick();
  assert(pulses==resetPulses && !motorMoving() && !timer.running && !motorContinuous);
  assert(relays[0] && !relays[1] && production.state==ProductionFlow::Taring);
  production.action=ProductionFlow::BackwardSteps;applyProduction();
  for(int i=0;i<100;i++)motorTick();
  production.stop(0);applyProduction();const uint32_t stopped=pulses;
  for(int i=0;i<100;i++)motorTick();
  assert(pulses==stopped && !timer.running && !relays[0] && !relays[1]);
  std::cout<<"PASS actual motor routines: 3200 steps/s timer, 12000 backward/backward pulses, forward past 12000 until IR1, immediate Reset, exact stop, pulse low and ENA disabled\n";
}
