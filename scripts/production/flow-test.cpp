#include <cassert>
#include <cstring>
#include <iostream>
#include "production-flow-under-test.h"
using F = ProductionFlow;
void ready(F &f, uint32_t now=0) {
  assert(f.start(10,now));
  for(int i=0;i<10;i++) f.sample(1000,now+i*100);
  assert(f.state==F::AwaitBottle && f.offset==1000 && f.relay1());
}
void inspect(F &f, uint32_t base=1000, long low=1200, long high=1400) {
  f.tick(base,false,false); f.tick(base+1,true,false);
  assert(f.takeAction()==F::Backward12000 && f.state==F::Intake);
  f.tick(base+2,false,true); assert(f.state==F::Intake);
  f.tick(base+100,false,false); assert(f.state==F::Inspect);
  for(int i=0;i<20;i++) f.sample(i%2?low:high,base+100+i*100);
}
int main() {
  F f; assert(!f.start(0,0)); ready(f);
  // A held IR does not cause an automatic insertion at session start.
  f.tick(950,true,false); assert(f.state==F::AwaitBottle);
  inspect(f); assert(!f.decision(f.cycle+1,true)); assert(f.decision(f.cycle,true));
  assert(!f.decision(f.cycle,true));
  f.tick(3099,false,false); assert(f.state==F::Inspect && f.grams==0);
  f.tick(3100,false,false); assert(f.state==F::AcceptMove);
  assert(f.takeAction()==F::Backward12000 && f.grams==30 && f.bottles==1 && f.relay2());
  f.tick(15100,false,false); assert(f.relay2() && f.state==F::AcceptMove); // Old 12s deadline must not release.
  f.tick(23099,false,true); assert(f.relay2());
  f.tick(23100,false,true); assert(!f.relay2() && f.state==F::AcceptMove);
  f.tick(32000,false,false); assert(f.state==F::Rearm);
  f.tick(32001,false,false); assert(f.state==F::AwaitBottle);
  inspect(f,33000); assert(f.decision(f.cycle,false)); f.tick(35100,false,false);
  assert(f.state==F::ReturnBottle && f.grams==30 && !f.relay2());
  assert(f.takeAction()==F::ForwardUntilIR1);
  f.tick(35110,true,true); assert(f.state==F::WaitRemoval && f.takeAction()==F::Stop);
  f.tick(35115,true,false); assert(f.state==F::WaitRemoval);
  f.tick(35120,true,false); assert(f.state==F::WaitRemoval);
  f.tick(35130,false,false); assert(f.state==F::WaitRemoval);
  f.tick(35430,false,false); assert(f.state==F::AwaitBottle);
  f.stop(36000); assert(f.state==F::Standby && f.grams==30 && !f.relay1() && !f.relay2());
  ready(f,37000); assert(f.grams==0); inspect(f,39000);
  assert(!f.decision(1,true)); f.tick(41100,false,false); f.tick(69100,false,false);
  assert(f.state==F::Fault && !strcmp(f.error,"cv_timeout") && !f.relay1());
  F missing; assert(missing.start(10,0)); missing.tick(9000,false,false);
  assert(missing.state==F::Fault);
  F saturated; ready(saturated); inspect(saturated); saturated.sample(8388607,3050);
  saturated.tick(3100,false,false); assert(saturated.state==F::Fault && saturated.grams==0);
  F empty; ready(empty); empty.tick(1000,false,false); empty.tick(1001,true,false);
  empty.takeAction(); empty.tick(1100,false,false); empty.tick(3100,false,false);
  assert(empty.state==F::Fault && !strcmp(empty.error,"weighing_invalid"));
  F disconnected; ready(disconnected); disconnected.fail("controller_disconnected",1000);
  assert(!disconnected.relay1() && disconnected.takeAction()==F::Stop);
  F quick; ready(quick); inspect(quick); quick.decision(quick.cycle,true); quick.tick(3100,false,false);
  quick.takeAction(); quick.tick(3101,false,false); assert(quick.state==F::AcceptMove && quick.relay2());
  quick.tick(23100,false,false); assert(quick.state==F::Rearm && !quick.relay2());
  // Accepted release lasts exactly 20 seconds, including after movement stops.
  F release; ready(release); inspect(release); release.decision(release.cycle,true); release.tick(3100,false,false);
  release.takeAction(); const auto releaseCycle=release.cycle;
  release.tick(3101,true,false,true); release.tick(23099,true,false,true);
  assert(release.state==F::AcceptMove && release.relay2() && release.cycle==releaseCycle && release.caps==1);
  assert(!strcmp(release.ledColor(),"#ffff00"));
  release.tick(23100,true,false,true); assert(!release.relay2() && release.state==F::Rearm);
  release.tick(23101,true,false,true); assert(release.state==F::Rearm); // Early bottle held at IR1 cannot queue.
  release.tick(23102,false,false,true); assert(release.state==F::AwaitBottle);
  release.tick(23250,false,false,true); assert(release.caps==1); // Held IR3 counts once during accepted release.
  release.tick(23251,false,false,false); release.tick(23351,false,false,false);
  release.tick(23352,false,false,true); release.tick(23382,false,false,true); assert(release.caps==2);
  // Caps are independent of bottle admission, motor movement and relay release.
  F caps; ready(caps); caps.tick(1000,false,false,false); caps.tick(1100,false,false,false);
  caps.tick(1101,true,false,true); assert(caps.state==F::Intake);
  caps.tick(1131,false,true,true); assert(caps.caps==1 && caps.capBusy);
  caps.tick(1200,false,true,true); assert(caps.caps==1);
  caps.tick(1201,false,true,false); caps.tick(1301,false,true,false);
  caps.tick(1302,false,true,true); caps.tick(1332,false,true,true); assert(caps.caps==2);
  caps.tick(1400,false,false,true); assert(caps.state==F::Inspect && caps.caps==2);
  caps.tick(1401,false,false,false); caps.tick(1501,false,false,false);
  caps.tick(1502,false,false,true); caps.tick(1532,false,false,true); assert(caps.caps==3);
  caps.fail("operator_stop",1800); assert(caps.caps==3 && !caps.capBusy);
  assert(caps.reset(10,1801)); assert(caps.caps==3); caps.stop(1802); assert(caps.caps==3);
  ready(caps,2000); assert(caps.caps==0);
  // Every active state permits caps; held sensors cannot count again on state changes.
  for(auto state : {F::Taring,F::AwaitBottle,F::Intake,F::Inspect,F::AcceptMove,F::ReturnBottle,F::WaitRemoval,F::Rearm}) {
    F counter; counter.active=true; counter.state=state; counter.entered=1000;
    counter.tick(1000,false,true,false); counter.tick(1100,false,true,false);
    counter.tick(1101,false,true,true); counter.tick(1131,false,true,true);
    assert(counter.caps==1);
    counter.tick(1200,false,true,true); assert(counter.caps==1);
  }
  F bounce; ready(bounce); bounce.tick(1000,false,false,false); bounce.tick(1100,false,false,false);
  bounce.tick(1101,false,false,true); bounce.tick(1120,false,false,false); bounce.tick(1130,false,false,true);
  bounce.tick(1159,false,false,true); assert(bounce.caps==0); bounce.tick(1160,false,false,true); assert(bounce.caps==1);
  bounce.tick(1200,false,false,false); bounce.tick(1250,false,false,true); bounce.tick(1500,false,false,true); assert(bounce.caps==1);
  bounce.tick(1501,false,false,false); bounce.tick(1601,false,false,false); bounce.tick(1602,false,false,true); bounce.tick(1632,false,false,true); assert(bounce.caps==2);
  bounce.stop(1700); bounce.tick(1800,false,false,true); assert(bounce.caps==2 && !bounce.capEnabled());
  F wrap; ready(wrap); inspect(wrap); wrap.decision(wrap.cycle,true); wrap.tick(0xfffff000u,false,false); wrap.takeAction();
  wrap.tick(0xfffff000u+19999u,false,false); assert(wrap.relay2()); wrap.tick(0xfffff000u+20000u,false,false); assert(!wrap.relay2());
  RFIDScanGate gate;
  assert(gate.seen(false,100)); // First scan emits.
  assert(!gate.seen(true,200)); // WUPA can read a held card without event spam.
  gate.arm(); assert(gate.seen(true,300)); // Home screen allows the same card again.
  assert(!gate.seen(true,400));
  gate.absent(500); assert(gate.present); // Short timeout cannot invent removal.
  gate.absent(700); assert(!gate.present && gate.armed);
  assert(gate.seen(true,800)); // Remove and retap also works.
  assert(gate.seen(false,900)); // A different card may arrive without an empty poll.
  assert(!strcmp(f.ledColor(),"#ff0000")); // Fault stays red.
  F lights; assert(!strcmp(lights.ledColor(),"#00ff00"));
  assert(!strcmp(lights.ledMode(),"blink"));
  ready(lights); assert(!strcmp(lights.ledColor(),"#00ff00") && !strcmp(lights.ledMode(),"blink"));
  inspect(lights); assert(!strcmp(lights.ledColor(),"#0000ff"));
  lights.decision(lights.cycle,true); lights.tick(3100,false,false);
  assert(!strcmp(lights.ledColor(),"#ffff00") && !strcmp(lights.ledMode(),"blink"));
  F rejected; ready(rejected); inspect(rejected); rejected.decision(rejected.cycle,false);
  rejected.tick(3100,false,false); assert(!strcmp(rejected.ledColor(),"#ff0000"));
  rejected.tick(4000,true,true); assert(rejected.state==F::WaitRemoval && rejected.takeAction()==F::Stop);
  assert(!strcmp(rejected.ledColor(),"#ff0000"));
  rejected.tick(6850,true,false); assert(rejected.state==F::WaitRemoval);
  assert(!strcmp(rejected.ledColor(),"#ff0000"));
  const auto rejectedCycle=rejected.cycle;
  for(uint32_t now=6851;now<8000;now+=50) rejected.tick(now,true,false);
  assert(rejected.cycle==rejectedCycle && rejected.state==F::WaitRemoval);
  rejected.tick(8000,false,false); rejected.tick(8100,true,false); // IR chatter cannot rearm.
  assert(rejected.state==F::WaitRemoval && !strcmp(rejected.ledColor(),"#ff0000"));
  rejected.tick(8200,false,false); rejected.tick(8499,false,false);
  assert(rejected.state==F::WaitRemoval);
  rejected.tick(8500,false,false); assert(rejected.state==F::AwaitBottle);
  assert(!strcmp(rejected.ledColor(),"#00ff00") && !strcmp(rejected.ledMode(),"blink"));
  rejected.tick(8501,true,false); assert(rejected.state==F::Intake && rejected.cycle==rejectedCycle+1);
  F notSeen; ready(notSeen); inspect(notSeen); notSeen.decision(notSeen.cycle,false);
  notSeen.tick(3100,false,false); notSeen.takeAction(); notSeen.tick(6850,false,false);
  notSeen.tick(8000,false,false); assert(notSeen.state==F::ReturnBottle); // No step limit can complete a sensor-based return.
  notSeen.tick(33100,false,true); assert(notSeen.state==F::Fault && !strcmp(notSeen.error,"return_ir_timeout") && notSeen.takeAction()==F::Stop);
  F recovery; ready(recovery); inspect(recovery); recovery.decision(recovery.cycle,true);
  recovery.tick(3100,false,false); recovery.takeAction(); recovery.tick(23100,false,false);
  recovery.tick(23101,false,false); inspect(recovery,24000,500,700);
  const auto stale=recovery.cycle; recovery.decision(stale,true); recovery.tick(26100,false,false);
  assert(recovery.state==F::Fault && recovery.faultFrom==F::Inspect && recovery.grams==30);
  assert(!strcmp(recovery.error,"weight_not_positive"));
  recovery.fail("operator_stop",26150);
  assert(recovery.faultFrom==F::Inspect && !strcmp(recovery.error,"weight_not_positive"));
  const auto recoveryCycle=recovery.cycle;
  assert(recovery.reset(10,26200));
  assert(recovery.grams==30 && recovery.bottles==1 && recovery.takeAction()==F::Stop);
  assert(recovery.state==F::Taring && recovery.relay1() && !recovery.relay2());
  assert(recovery.cycle!=recoveryCycle && !recovery.decision(stale,true));
  assert(!strcmp(recovery.ledColor(),"#00ff00") && !strcmp(recovery.ledMode(),"blink"));
  for(int i=0;i<10;i++) recovery.sample(900,26300+i*100);
  assert(recovery.state==F::AwaitBottle && recovery.offset==900 && recovery.grams==30);
  inspect(recovery,32000,1100,1300); recovery.decision(recovery.cycle,true); recovery.tick(34100,false,false);
  assert(recovery.grams==60 && recovery.bottles==2);
  // Reset is also available during a successful release, not only in Fault.
  assert(recovery.reset(10,35000) && recovery.takeAction()==F::Stop);
  assert(recovery.relay1() && !recovery.relay2() && recovery.grams==60);
  // Reset never returns the bottle, even when the entrance is occupied.
  for(auto state : {F::Taring,F::AwaitBottle,F::Intake,F::Inspect,F::AcceptMove,F::ReturnBottle,F::WaitRemoval,F::Rearm,F::Fault}) {
    F reset; reset.state=state; reset.active=state!=F::Fault; reset.grams=40; reset.bottles=2; reset.caps=3; reset.releaseOn=true;
    assert(reset.reset(10,1000));
    assert(reset.state==F::Taring && reset.takeAction()==F::Stop && reset.relay1() && !reset.relay2());
    reset.tick(1001,true,false); assert(reset.state==F::Taring);
    assert(reset.grams==40 && reset.bottles==2 && reset.caps==3);
    for(int i=0;i<10;i++) reset.sample(2000,1100+i*100);
    assert(reset.offset==2000 && reset.state==F::AwaitBottle);
    reset.tick(2100,true,false); assert(reset.state==F::AwaitBottle && !reset.armed);
    reset.tick(2200,false,false); reset.tick(2201,true,false); assert(reset.state==F::Intake);
  }
  F inactive; assert(!inactive.reset(10,0));
  F invalidReset; ready(invalidReset); assert(!invalidReset.reset(0,1000));
  // Exactly 50g is accepted if CV agrees. Any larger positive mean is rejected without waiting for CV.
  F boundary; ready(boundary); inspect(boundary,1000,1500,1500); boundary.decision(boundary.cycle,true); boundary.tick(3100,false,false);
  assert(boundary.state==F::AcceptMove && boundary.grams==50 && boundary.bottles==1);
  for(long raw : {1501L,2000L}) {
    F heavy; ready(heavy); inspect(heavy,1000,raw,raw); heavy.tick(3100,false,false);
    assert(heavy.state==F::ReturnBottle && heavy.grams==0 && heavy.bottles==0);
    assert(!strcmp(heavy.rejectionReason,"weight_over_50g") && heavy.takeAction()==F::ForwardUntilIR1);
    assert(!heavy.decision(heavy.cycle,true));
    heavy.tick(8000,false,true); assert(heavy.state==F::ReturnBottle && heavy.relay1() && !heavy.relay2());
    heavy.tick(9000,true,true); assert(heavy.state==F::WaitRemoval && heavy.takeAction()==F::Stop);
    heavy.tick(9500,true,false); assert(heavy.state==F::WaitRemoval && heavy.relay1());
    heavy.tick(9600,false,false); heavy.tick(9899,false,false); assert(heavy.state==F::WaitRemoval);
    heavy.tick(9900,true,false); // New trigger cancels the 300ms clear interval.
    heavy.tick(10000,false,false); heavy.tick(10299,false,false); assert(heavy.state==F::WaitRemoval);
    heavy.tick(10300,false,false); assert(heavy.state==F::AwaitBottle && heavy.relay1() && !heavy.relay2());
    assert(!strcmp(heavy.ledColor(),"#00ff00") && !strcmp(heavy.ledMode(),"blink"));
  }
  F heavyCV; ready(heavyCV); inspect(heavyCV,1000,1600,1600); heavyCV.decision(heavyCV.cycle,true); heavyCV.tick(3100,false,false);
  assert(heavyCV.state==F::ReturnBottle && heavyCV.grams==0);
  F occupied; ready(occupied); inspect(occupied); occupied.decision(occupied.cycle,false); occupied.tick(3100,true,false);
  assert(occupied.state==F::WaitRemoval && occupied.takeAction()==F::Stop && occupied.relay1());
  std::cout << "PASS production: backward intake/accept, IR1-controlled forward rejection, return/removal lockout and IR chatter, immediate Reset preserving totals and 50g boundary, RFID rearm, tare/2s mean, CV IDs, relay, stop/fault\n";
}
