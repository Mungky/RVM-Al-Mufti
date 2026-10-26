// Host test of the ProductionFlow embedded in rvm_production.ino (1.1.2): normal flow and user anomalies.
#include <cassert>
#include <cstring>
#include <iostream>
#include "production-flow-under-test.h"
using F = ProductionFlow;

// 10 ms ticks; motor 3200 steps/s; scale factor 10 raw/g with zero at raw 1000; scale read only while stopped.
struct Sim {
  F f; uint32_t now=0; double grams=0; bool ir1=false, ir3=false, forward=false;
  int32_t remaining=0, paused=0;
  bool moving() const { return remaining>0 || forward; }
  void tick() {
    now+=10;
    if(remaining>0) remaining=remaining>32?remaining-32:0;
    f.moveRemaining=remaining;
    if(!moving()) f.sample((long)(1000+grams*10),now);
    f.tick(now,ir1,moving(),ir3);
    switch(f.takeAction()) {
      case F::BackwardSteps: remaining=f.moveSteps; forward=false; break;
      case F::ForwardUntilIR1: forward=true; break;
      case F::Pause: paused=remaining; remaining=0; forward=false; break;
      case F::Resume: remaining=paused; paused=0; break;
      case F::Stop: remaining=0; forward=false; break;
      default: break;
    }
  }
  void wait(uint32_t ms) { for(uint32_t t=0;t<ms;t+=10) tick(); }
  bool is(F::State s) const { return f.state==s; }
  void start() { assert(f.start(10,now)); wait(200); assert(is(F::AwaitBottle)); wait(1100); }
  // A bottle is pushed past IR1 and pulled in; returns once it is under the camera.
  void insert(double g) {
    ir1=true; tick(); assert(is(F::Intake)); wait(300); ir1=false; grams=g;
    while(is(F::Intake)) tick();
  }
};
static bool reason(const Sim &s, const char *r) { return !strcmp(s.f.rejectionReason,r); }

int main() {
  { // Normal: accepted bottle, shredder from step 10000 for 20 s, credit only once the scale is empty.
    Sim s; s.start(); s.insert(10); assert(s.is(F::Inspect));
    assert(s.f.decision(s.f.cycle,true,1)); s.wait(2100); assert(s.is(F::AcceptMove) && !s.f.relay2());
    s.wait(2900); assert(!s.f.relay2()); s.wait(400); assert(s.f.relay2());
    s.grams=0; while(s.is(F::AcceptMove)) s.tick(); assert(s.is(F::ConfirmDrop));
    s.wait(1100); assert(s.is(F::Rearm) && s.f.grams==10 && s.f.bottles==1);
    assert(s.f.shredderRemaining(s.now)>10000);
    s.wait(17000); assert(s.is(F::AwaitBottle) && !s.f.relay2() && s.f.shredderRemaining(s.now)==0);
  }
  { // CV rejects: bottle returned to IR1, taken, belt checked empty, ready again. No credit.
    Sim s; s.start(); s.insert(10); assert(s.f.decision(s.f.cycle,false,0)); s.wait(2100);
    assert(s.is(F::ReturnBottle) && s.forward && reason(s,"cv_rejected"));
    s.ir1=true; s.tick(); assert(s.is(F::WaitRemoval) && !s.forward);
    s.ir1=false; s.grams=0; s.wait(1500); assert(s.is(F::AwaitBottle) && s.f.grams==0);
  }
  { // CV says Aqua (size 1) but the weight is a Le Minerale (size 2): returned.
    Sim s; s.start(); s.insert(16); s.f.decision(s.f.cycle,true,1); s.wait(2100);
    assert(s.is(F::ReturnBottle) && reason(s,"weight_class_mismatch"));
  }
  { // Full / unknown bottle: weight out of range, returned even before CV answers.
    Sim s; s.start(); s.insert(25); s.wait(2100); assert(s.is(F::ReturnBottle) && reason(s,"weight_out_of_range"));
  }
  { // A: bottle pulled back before/while it was pulled in: empty belt is not a fault, just ready again.
    Sim s; s.start(); s.insert(0); s.wait(2100);
    assert(s.is(F::AwaitBottle) && reason(s,"no_bottle") && s.f.error[0]==0);
    s.wait(1100); s.insert(10); assert(s.is(F::Inspect));
  }
  { // A: hand reaches in during inspection and takes the bottle back.
    Sim s; s.start(); s.insert(10); s.wait(500); s.ir1=true; s.tick(); assert(s.is(F::SafetyPause));
    s.grams=0; s.wait(500); s.ir1=false; s.wait(2500); assert(s.is(F::AwaitBottle) && reason(s,"no_bottle"));
    assert(!s.f.decision(s.f.cycle,true,1)); // A late CV result is ignored.
  }
  { // Hand at the entrance during inspection, bottle left alone: resumes and finishes normally.
    Sim s; s.start(); s.insert(10); s.wait(2100); s.ir1=true; s.tick(); assert(s.is(F::SafetyPause));
    s.wait(300); s.ir1=false; s.wait(2500); assert(s.is(F::Inspect));
    s.f.decision(s.f.cycle,true,1); s.tick(); assert(s.is(F::AcceptMove));
  }
  { // Second bottle dropped onto the belt during inspection: everything returned.
    Sim s; s.start(); s.insert(10); s.wait(2100); s.ir1=true; s.tick(); s.grams=20; s.wait(300); s.ir1=false; s.wait(2500);
    assert(s.is(F::ReturnBottle) && reason(s,"safety_weight_changed"));
  }
  { // A/AcceptMove: bottle snatched while moving to the shredder: no credit, no return, shredder off.
    Sim s; s.start(); s.insert(10); s.f.decision(s.f.cycle,true,1); s.wait(2100); s.wait(3500); assert(s.f.relay2());
    s.ir1=true; s.tick(); assert(s.is(F::SafetyPause) && !s.f.relay2()); s.grams=0; s.ir1=false; s.wait(2500);
    assert(s.is(F::AwaitBottle) && s.f.bottles==0 && !s.f.relay2());
  }
  // C: something at the entrance while the accepted bottle is being confirmed.
  for(int c=0;c<3;c++) {
    Sim s; s.start(); s.insert(16); s.f.decision(s.f.cycle,true,2); s.wait(2100);
    s.grams=0; while(s.is(F::AcceptMove)) s.tick(); assert(s.is(F::ConfirmDrop));
    s.ir1=true; s.tick(); assert(s.is(F::SafetyPause));
    s.grams=c==0?0:c==1?10:16; s.wait(300); s.ir1=false; s.wait(2500);
    if(c==0) { s.wait(1100); assert(s.is(F::Rearm) && s.f.grams==16); }                            // hand only: credited
    if(c==1) assert(s.f.grams==16 && s.is(F::ReturnBottle) && reason(s,"safety_weight_changed")); // lighter 2nd: credit 1st, return 2nd
    if(c==2) { s.wait(1100); assert(s.f.grams==0 && s.is(F::ReturnBottle) && reason(s,"not_dropped")); } // can't tell: no credit
  }
  { // E: caps are short IR3 pulses; a lingering hand is not a cap; at most one per second.
    Sim s; s.start();
    auto pulse=[&](uint32_t width){ s.ir3=true; s.wait(width); s.ir3=false; s.wait(150); };
    pulse(80); assert(s.f.caps==1);
    pulse(80); assert(s.f.caps==1);   // 230 ms after the previous cap
    s.wait(1000); pulse(80); assert(s.f.caps==2);
    s.wait(1000); pulse(900); assert(s.f.caps==2); // hand held in front of IR3
    s.wait(1000); pulse(10); assert(s.f.caps==2);  // glitch
    s.f.stop(s.now); pulse(80); assert(s.f.caps==2); // no counting outside a session
  }
  { // No CV answer at all: fault after 30 s (Reset needed).
    Sim s; s.start(); s.insert(10); s.wait(31000); assert(s.is(F::Fault) && !strcmp(s.f.error,"cv_timeout"));
  }
  { // Re-zero after each cycle; a bottle arriving during re-zero keeps the previous zero.
    Sim s; s.start(); const long zero=s.f.offset; s.grams=3; s.ir1=true; s.tick(); assert(s.is(F::Intake) && s.f.offset==zero);
  }
  std::cout << "production flow 1.1.2 tests passed\n";
}
