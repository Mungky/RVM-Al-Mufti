#include <Arduino.h>
#define MFRC522_SPICLOCK 1000000UL   // mulai 1 MHz

#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN    16
#define RST_PIN   17
#define SCK_PIN   22
#define MISO_PIN  13
#define MOSI_PIN  21

MFRC522 rfid(SS_PIN, RST_PIN);

unsigned long lastHealth = 0;
unsigned long totalScan = 0;
byte lastVersion = 0;

void initRFID() {
  Serial.println("Init RC522...");

  digitalWrite(RST_PIN, LOW);
  delay(10);
  digitalWrite(RST_PIN, HIGH);
  delay(50);

  rfid.PCD_Init();
  delay(100);

  rfid.PCD_AntennaOn();

  lastVersion = rfid.PCD_ReadRegister(MFRC522::VersionReg);

  Serial.print("Version = 0x");
  if (lastVersion < 0x10) Serial.print("0");
  Serial.println(lastVersion, HEX);
}

void setup() {
  for(int pin:{33,15}) { pinMode(pin,OUTPUT); digitalWrite(pin,HIGH); }
  pinMode(2,OUTPUT); digitalWrite(2,LOW);
  pinMode(25,OUTPUT); digitalWrite(25,HIGH);
  Serial.begin(115200);
  delay(1000);

  pinMode(RST_PIN, OUTPUT);
  digitalWrite(RST_PIN, HIGH);

  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);

  Serial.println();
  Serial.println("============================");
  Serial.println(" RC522 SCAN + HEALTH TEST");
  Serial.println("============================");

  initRFID();

  Serial.println("Tempel kartu...");
}

void loop() {

  // ==========================
  // HEALTH CHECK SETIAP 1 DETIK
  // ==========================
  if (millis() - lastHealth >= 1000) {

    lastHealth = millis();

    byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);

    Serial.print("[HEALTH] Version: 0x");

    if (version < 0x10) {
      Serial.print("0");
    }

    Serial.print(version, HEX);

    Serial.print(" | Total scan: ");
    Serial.println(totalScan);

    // Modulmu sejauh ini menunjukkan 0x82 saat sehat.
    if (version != 0x82) {

      Serial.println("!!! SPI/RC522 ERROR !!!");
      Serial.println("Mencoba re-init RC522...");

      initRFID();
    }
  }


  // ==========================
  // CEK KARTU
  // ==========================
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }


  // ==========================
  // KARTU BERHASIL DIBACA
  // ==========================
  totalScan++;

  Serial.println();
  Serial.println(">>> RFID TERBACA <<<");

  Serial.print("UID: ");

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print("0");
    }

    Serial.print(rfid.uid.uidByte[i], HEX);

    if (i < rfid.uid.size - 1) {
      Serial.print(":");
    }
  }

  Serial.println();

  Serial.print("Scan ke: ");
  Serial.println(totalScan);


  // ==========================
  // AKHIRI TRANSAKSI
  // ==========================
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(300);
}