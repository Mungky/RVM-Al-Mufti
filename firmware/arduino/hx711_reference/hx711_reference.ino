#include "HX711.h"

#define DT_PIN   34
#define SCK_PIN  32

HX711 scale;

unsigned long lastRead = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=========================");
  Serial.println(" HX711 BASIC RAW TEST");
  Serial.println("=========================");

  scale.begin(DT_PIN, SCK_PIN);

  if (!scale.wait_ready_timeout(3000)) {
    Serial.println("HX711 TIDAK READY!");
    Serial.println("Cek power dan wiring.");
    return;
  }

  Serial.println("HX711 READY");
  Serial.println("Mulai membaca RAW...");
}

void loop() {

  if (millis() - lastRead >= 500) {
    lastRead = millis();

    if (!scale.wait_ready_timeout(1000)) {
      Serial.println("ERROR: HX711 NOT READY");
      return;
    }

    long raw = scale.read();

    Serial.print("RAW: ");
    Serial.println(raw);
  }
}