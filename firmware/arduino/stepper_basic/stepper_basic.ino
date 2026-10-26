#include <Arduino.h>

#define PUL_PIN 2
#define DIR_PIN 4
#define ENA_PIN 25
#define RELAY_1 15
#define RELAY_2 33

const unsigned long STEP_INTERVAL_US = 2000; // 500 pulsa/detik
bool running = false;
int direction = 1;
long position = 0;
unsigned long lastStep = 0;
unsigned long lastReport = 0;

void reportPosition() {
  Serial.print(running ? (direction > 0 ? "FORWARD" : "BACKWARD") : "STOP");
  Serial.print(" | Posisi pulsa: ");
  Serial.println(position);
}

void stopMotor() {
  running = false;
  digitalWrite(PUL_PIN, LOW);
  digitalWrite(ENA_PIN, HIGH);
}

void startMotor(int newDirection) {
  stopMotor();
  direction = newDirection;
  digitalWrite(DIR_PIN, direction > 0 ? HIGH : LOW);
  digitalWrite(ENA_PIN, LOW);
  delayMicroseconds(20);
  lastStep = micros();
  running = true;
}

void setup() {
  digitalWrite(RELAY_1, HIGH); pinMode(RELAY_1, OUTPUT);
  digitalWrite(RELAY_2, HIGH); pinMode(RELAY_2, OUTPUT);
  digitalWrite(PUL_PIN, LOW); pinMode(PUL_PIN, OUTPUT);
  digitalWrite(DIR_PIN, LOW); pinMode(DIR_PIN, OUTPUT);
  digitalWrite(ENA_PIN, HIGH); pinMode(ENA_PIN, OUTPUT);
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== TES DASAR STEPPER ===");
  Serial.println("f = forward | b = backward | s = stop");
  Serial.println("Posisi = hitungan pulsa dari boot, bukan encoder.");
  reportPosition();
}

void loop() {
  while (Serial.available()) {
    char command = Serial.read();
    if (command == 'f' || command == 'F') { startMotor(1); reportPosition(); }
    else if (command == 'b' || command == 'B') { startMotor(-1); reportPosition(); }
    else if (command == 's' || command == 'S') { stopMotor(); reportPosition(); }
  }

  unsigned long now = micros();
  if (running && now - lastStep >= STEP_INTERVAL_US) {
    lastStep = now;
    if ((direction > 0 && position == INT32_MAX) ||
        (direction < 0 && position == INT32_MIN)) {
      stopMotor();
    } else {
      digitalWrite(PUL_PIN, HIGH);
      delayMicroseconds(10);
      digitalWrite(PUL_PIN, LOW);
      position += direction;
    }
  }

  if (millis() - lastReport >= 500) {
    lastReport = millis();
    reportPosition();
  }
}
